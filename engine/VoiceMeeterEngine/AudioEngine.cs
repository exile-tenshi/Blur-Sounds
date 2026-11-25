using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal sealed class AudioEngine : IDisposable
{
    private readonly MMDeviceEnumerator enumerator = new();
    private readonly WaveFormat defaultMixFormat = EngineAudioFormat.MixFormat;
    private WaveFormat mixFormat;
    private readonly ConcurrentDictionary<string, RouteConfig> routeConfigs = new();
    private readonly Dictionary<string, AppLoopbackSource> appLoopbackSources = new(StringComparer.Ordinal);
    private readonly object mixLock = new();
    private readonly object gate = new();

    private MixingSampleProvider mixer;
    private ISampleProvider? masterStream;
    private MixPullMeterSampleProvider? mixMeter;
    private MixOutputRouter? outputBroadcast;
    private HifiCableOutputActivator? hifiOutputActivator;
    private readonly Dictionary<string, MicSource> microphoneSources = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MicMixEntry> microphoneMixEntries = new(StringComparer.Ordinal);
    private DeviceSelection selection = new();
    private string? boundInputSelectionId;
    private readonly Dictionary<string, string> routeErrors = new(StringComparer.Ordinal);
    private string state = "stopped";
    private string? message;
    private bool voicemeeterRouteEnabled;

    private readonly Dictionary<string, AppMixEntry> appMixEntries = new(StringComparer.Ordinal);

    private sealed class MicMixEntry
    {
        public required PausedAwareMixInput MixInput { get; init; }
    }

    private sealed class AppMixEntry
    {
        public required PausedAwareMixInput MixInput { get; init; }
        public required EqualizerSampleProvider Equalizer { get; init; }
    }

    private static string ExtractBindableDeviceName(string? selectionId)
    {
        if (string.IsNullOrWhiteSpace(selectionId))
        {
            return string.Empty;
        }

        var parts = selectionId.Split("::", 2, StringSplitOptions.None);
        return parts.Length == 2 ? parts[1] : selectionId;
    }

    public AudioEngine()
    {
        mixFormat = defaultMixFormat;
        AudioDiagnostics.SetMixFormat(mixFormat);
        mixer = CreateMixer();
        mixMeter = new MixPullMeterSampleProvider(mixer);
        masterStream = mixMeter;
    }

    private ISampleProvider GetMixedSource()
    {
        lock (mixLock)
        {
            return (ISampleProvider?)masterStream ?? mixer;
        }
    }

    public async Task ApplyRoutesAsync(DeviceSelection nextSelection, IReadOnlyCollection<RouteConfig> routes)
    {
        var inputChanged =
            !string.Equals(selection.InputDeviceId, nextSelection.InputDeviceId, StringComparison.Ordinal);
        var microphoneChanged = SelectionNormalizer.MicrophonesChanged(selection, nextSelection);

        if (inputChanged || !IsInputBound())
        {
            await ApplyAsync(nextSelection, routes);
            return;
        }

        selection = nextSelection;
        routeConfigs.Clear();
        foreach (var route in routes)
        {
            routeConfigs[route.RouteId] = route;
        }

        if (microphoneChanged)
        {
            await EnsureMicrophonesAsync();
        }

        ApplyMicrophoneMix();
        await SyncAppLoopbackSourcesAsync(routes);
    }

    public async Task ApplyAsync(DeviceSelection nextSelection, IReadOnlyCollection<RouteConfig> routes)
    {
        var wasActive = state is "running" or "starting";

        selection = nextSelection;
        routeConfigs.Clear();
        foreach (var route in routes)
        {
            routeConfigs[route.RouteId] = route;
        }

        await EnsureOutputsAsync();
        await EnsureMicrophonesAsync();
        ApplyMicrophoneMix();
        await SyncAppLoopbackSourcesAsync(routes);

        if (wasActive && outputBroadcast is not null)
        {
            StartSources();
        }
    }

    public async Task StartAsync()
    {
        await EnsureOutputsAsync();
        await EnsureMicrophonesAsync();
        ApplyMicrophoneMix();

        if (outputBroadcast is null)
        {
            state = "error";
            message ??= string.IsNullOrWhiteSpace(selection.InputDeviceId)
                ? "Select Hi-Fi Cable Input and start the stream again."
                : "Unable to bind the selected Input device. Try Refresh, then Start stream again.";
            return;
        }

        StartSources();
    }

    public Task StopAsync()
    {
        lock (gate)
        {
            outputBroadcast?.Stop();
            outputBroadcast?.Dispose();
            outputBroadcast = null;
            hifiOutputActivator?.Dispose();
            hifiOutputActivator = null;
            foreach (var source in microphoneSources.Values)
            {
                source.Stop();
            }

            state = "stopped";
            message = "Engine stopped.";
            boundInputSelectionId = null;
        }

        return Task.CompletedTask;
    }

    public Task RebindOutputIfRunningAsync()
    {
        if (state is not ("running" or "starting") || string.IsNullOrWhiteSpace(selection.InputDeviceId))
        {
            return Task.CompletedTask;
        }

        var inputDevice = FindAudioEndpoint(DataFlow.Render, selection.InputDeviceId);
        if (inputDevice is null)
        {
            return Task.CompletedTask;
        }

        MixOutputRouter? nextBroadcast = null;
        try
        {
            nextBroadcast = new MixOutputRouter(GetMixedSource, mixFormat);
            nextBroadcast.Bind(inputDevice);
        }
        catch
        {
            nextBroadcast?.Dispose();
            return Task.CompletedTask;
        }

        MixOutputRouter? previous;
        lock (gate)
        {
            previous = outputBroadcast;
            outputBroadcast = nextBroadcast;
            boundInputSelectionId = selection.InputDeviceId;
        }

        previous?.Stop();
        previous?.Dispose();
        nextBroadcast.Play();

        // Format rebind can invalidate the VB-Audio Output keep-alive client.
        if (UsesHifiCableInput())
        {
            hifiOutputActivator ??= new HifiCableOutputActivator();
            hifiOutputActivator.Start();
        }

        foreach (var source in microphoneSources.Values)
        {
            source.Start();
        }
        foreach (var source in appLoopbackSources.Values)
        {
            source.Start();
        }

        return Task.CompletedTask;
    }

    public async Task RecoverLoopbackSourcesAsync()
    {
        if (state is not ("running" or "starting"))
        {
            return;
        }

        // Only recover hard failures (dead process / real error). Peak-based recreation
        // was re-scanning every audio endpoint and rebinding loopbacks every few seconds.
        var needsRecovery = false;
        foreach (var route in routeConfigs.Values.Where(route =>
                     string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase)))
        {
            if (!appLoopbackSources.TryGetValue(route.AppId, out var source))
            {
                needsRecovery = true;
                break;
            }

            if (!AudioProcessResolver.IsProcessRunning(source.CaptureProcessId))
            {
                needsRecovery = true;
                break;
            }

            if (!string.Equals(source.State, "error", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(source.LastError) ||
                source.LastError.Contains("Buffer full", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            needsRecovery = true;
            break;
        }

        if (!needsRecovery)
        {
            return;
        }

        await SyncAppLoopbackSourcesAsync(routeConfigs.Values.ToList());
        StartSources();
    }

    public void RefreshSessionPeaksInBackground()
    {
        AudioSessionMonitor.RefreshInBackground();
    }

    /// <summary>
    /// VB-Audio only loops Input→Output while Output capture is open. If the keep-alive
    /// client dies mid-stream, restart it so Discord/OBS do not stay silent.
    /// </summary>
    public void EnsureHifiOutputKeepAlive()
    {
        if (!UsesHifiCableInput())
        {
            return;
        }

        lock (gate)
        {
            if (!string.Equals(state, "running", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(state, "starting", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }
        }

        if (hifiOutputActivator?.IsActive == true)
        {
            return;
        }

        try
        {
            hifiOutputActivator ??= new HifiCableOutputActivator();
            hifiOutputActivator.Start();
            if (hifiOutputActivator.IsActive)
            {
                lock (gate)
                {
                    message = "Streaming mix to input. Hi-Fi Cable Output is active.";
                }
            }
        }
        catch (Exception ex)
        {
            lock (gate)
            {
                message =
                    $"Hi-Fi Cable Output keep-alive failed ({ex.Message}) — listeners hear silence.";
            }
        }
    }

    public EngineTelemetry GetTelemetry()
    {
        var routeTelemetry = routeConfigs.Values
            .Where(route => string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase))
            .GroupBy(route => route.AppId)
            .OrderBy(group => group.Key)
            .Select(group =>
            {
                if (appLoopbackSources.TryGetValue(group.Key, out var source))
                {
                    var route = group.OrderByDescending(item => item.Volume).First();
                    return new RouteTelemetry
                    {
                        AppId = group.Key,
                        Level = route.Muted ? 0f : source.Level,
                        State = source.State,
                        LastError = string.Equals(source.State, "error", StringComparison.OrdinalIgnoreCase)
                            ? source.LastError ?? GetRouteWarning(group.Key, source.CaptureProcessId)
                            : null,
                    };
                }

                if (routeErrors.TryGetValue(group.Key, out var routeError))
                {
                    return new RouteTelemetry
                    {
                        AppId = group.Key,
                        Level = 0,
                        State = "error",
                        LastError = routeError,
                    };
                }

                return new RouteTelemetry
                {
                    AppId = group.Key,
                    Level = 0,
                    State = "attaching",
                };
            })
            .ToList();

        return new EngineTelemetry
        {
            State = state,
            HelperConnected = true,
            Message = message,
            LatencyMs = LatencyTuning.MicCaptureBufferMilliseconds
                + LatencyTuning.MicCaptureMaxMilliseconds
                + LatencyTuning.OutputStageBufferMilliseconds
                + LatencyTuning.HiFiOutputLatencyMilliseconds,
            UnderrunCount = CaptureDiagnostics.TotalUnderruns,
            SelectedMicrophoneReady = microphoneSources.Values.Any(source => source.IsReady),
            SelectedInputReady = outputBroadcast is not null &&
                !string.IsNullOrWhiteSpace(selection.InputDeviceId) &&
                string.Equals(boundInputSelectionId, selection.InputDeviceId, StringComparison.Ordinal),
            HifiOutputActive = !UsesHifiCableInput() || hifiOutputActivator?.IsActive == true,
            HifiOutputError = UsesHifiCableInput() ? hifiOutputActivator?.LastError : null,
            OutputLevel = ComputeMixedOutputLevel(),
            OutputPullLevel = OutputPullMeter.Peak,
            MixPullLevel = mixMeter?.Peak ?? 0f,
            MicrophoneLevel = ComputeMicrophoneOutputLevel(),
            // Never COM-scan on the fast meter tick — App Library peaks refresh in background.
            SessionLevels = AudioSessionMonitor.PeekCached()
                .Select(session => new SessionLevelTelemetry
                {
                    ProcessId = session.ProcessId,
                    Peak = session.Peak,
                })
                .ToList(),
            Routes = routeTelemetry,
            AudioFormat = MapAudioFormatTelemetry(AudioDiagnostics.GetSnapshot()),
        };
    }

    private static AudioFormatTelemetry MapAudioFormatTelemetry(AudioDiagnosticsSnapshot snapshot) => new()
    {
        MixSampleRate = snapshot.MixSampleRate,
        StreamSampleRate = snapshot.StreamSampleRate,
        DeviceSampleRate = snapshot.DeviceSampleRate,
        DeviceBitsPerSample = snapshot.DeviceBitsPerSample,
        OutputBinding = snapshot.OutputBinding,
        RenderError = snapshot.RenderError,
        UnderrunCount = snapshot.UnderrunCount,
        Policy = snapshot.Policy,
    };

    private float ComputeMicrophoneOutputLevel()
    {
        var peak = 0f;

        foreach (var slot in SelectionNormalizer.GetMicrophoneSlotSettings(selection))
        {
            if (slot.Muted || string.IsNullOrWhiteSpace(slot.MicrophoneId))
            {
                continue;
            }

            if (microphoneSources.TryGetValue(slot.SlotId, out var source))
            {
                peak = Math.Max(peak, source.Level);
            }
        }

        return peak;
    }

    private float ComputeMixedOutputLevel()
    {
        var peak = 0f;

        foreach (var slot in SelectionNormalizer.GetMicrophoneSlotSettings(selection))
        {
            if (slot.Muted || string.IsNullOrWhiteSpace(slot.MicrophoneId))
            {
                continue;
            }

            if (microphoneSources.TryGetValue(slot.SlotId, out var source))
            {
                peak = Math.Max(peak, source.Level);
            }
        }

        foreach (var route in routeConfigs.Values)
        {
            if (!string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase) || route.Muted)
            {
                continue;
            }

            if (appLoopbackSources.TryGetValue(route.AppId, out var source))
            {
                peak = Math.Max(peak, source.Level);
            }
        }

        return peak;
    }

    private MixingSampleProvider CreateMixer()
    {
        return new MixingSampleProvider(mixFormat)
        {
            ReadFully = true,
        };
    }

    private void InvalidateCaptureSources()
    {
        foreach (var source in microphoneSources.Values)
        {
            source.Stop();
            source.Dispose();
        }

        microphoneSources.Clear();

        foreach (var source in appLoopbackSources.Values)
        {
            source.Dispose();
        }

        appLoopbackSources.Clear();
        ProcessLoopbackPool.DisposeAll();
    }

    private void RebuildMixerChain()
    {
        lock (mixLock)
        {
            mixer = CreateMixer();
            microphoneMixEntries.Clear();
            appMixEntries.Clear();
            mixMeter = new MixPullMeterSampleProvider(mixer);
            masterStream = mixMeter;
        }

        foreach (var (slotId, mic) in microphoneSources.ToList())
        {
            AttachMicrophoneToMixer(slotId, mic);
        }

        foreach (var (appId, source) in appLoopbackSources.ToList())
        {
            AttachAppToMixer(appId, source);
        }

        ApplyAppEqualizers();
    }

    private int WarmupSampleTarget(int captureSampleRate, string? deviceName = null)
    {
        var warmupMs = CaptureDeviceTuning.GetCaptureWarmupMilliseconds(deviceName);
        return Math.Max(
            mixFormat.Channels,
            captureSampleRate * mixFormat.Channels * warmupMs / 1000);
    }

    private static async Task WarmupCaptureAsync(Func<int> getBufferedSamples, int minSamples, int deadlineMilliseconds = 200)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(deadlineMilliseconds);
        while (DateTime.UtcNow < deadline)
        {
            if (getBufferedSamples() >= minSamples)
            {
                return;
            }

            await Task.Delay(10);
        }
    }

    private void AttachMicrophoneToMixer(string slotId, MicSource mic)
    {
        var block = new FullBlockSampleProvider(mic.SampleProvider);
        var input = new PausedAwareMixInput(() => mic.IsMuted, block);

        lock (mixLock)
        {
            if (microphoneMixEntries.TryGetValue(slotId, out var existing))
            {
                mixer.RemoveMixerInput(existing.MixInput);
            }

            mixer.AddMixerInput(input);
            microphoneMixEntries[slotId] = new MicMixEntry
            {
                MixInput = input,
            };
        }
    }

    private async Task AttachMicrophoneToMixerAsync(string slotId, MicSource mic)
    {
        mic.Start();
        await WarmupCaptureAsync(
            () => mic.BufferedSamples,
            WarmupSampleTarget(mic.CaptureSampleRate, mic.DeviceName),
            CaptureDeviceTuning.GetCaptureWarmupDeadlineMilliseconds(mic.DeviceName));
        AttachMicrophoneToMixer(slotId, mic);
    }

    private async Task RemoveMicrophoneFromMixerAsync(string slotId)
    {
        lock (mixLock)
        {
            if (microphoneMixEntries.Remove(slotId, out var removed))
            {
                mixer.RemoveMixerInput(removed.MixInput);
            }
        }

        await Task.CompletedTask;
    }

    private AppMixEntry AttachAppToMixer(string appId, AppLoopbackSource source)
    {
        var block = new FullBlockSampleProvider(source.SampleProvider);
        var equalizer = new EqualizerSampleProvider(block);
        source.MixEqualizer = equalizer;
        var input = new PausedAwareMixInput(() => source.IsMuted, equalizer);
        var entry = new AppMixEntry
        {
            MixInput = input,
            Equalizer = equalizer,
        };

        lock (mixLock)
        {
            if (appMixEntries.TryGetValue(appId, out var existing))
            {
                mixer.RemoveMixerInput(existing.MixInput);
            }

            mixer.AddMixerInput(input);
            appMixEntries[appId] = entry;
        }

        return entry;
    }

    private async Task AttachAppToMixerAsync(string appId, AppLoopbackSource source)
    {
        source.Start();
        var minSamples = Math.Max(
            mixFormat.Channels,
            source.CaptureSampleRate * mixFormat.Channels * LatencyTuning.AppLoopbackWarmupMilliseconds / 1000);
        await WarmupCaptureAsync(() => source.BufferedSamples, minSamples, 80);
        AttachAppToMixer(appId, source);
    }

    private async Task RemoveAppFromMixerAsync(string appId)
    {
        lock (mixLock)
        {
            if (appMixEntries.Remove(appId, out var removed))
            {
                mixer.RemoveMixerInput(removed.MixInput);
            }
        }

        if (appLoopbackSources.TryGetValue(appId, out var source))
        {
            source.MixEqualizer = null;
        }

        await Task.CompletedTask;
    }

    private void ApplyAppEqualizers()
    {
        foreach (var route in routeConfigs.Values.Where(route =>
                     string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase)))
        {
            EqualizerSampleProvider? equalizer = null;
            if (appMixEntries.TryGetValue(route.AppId, out var entry))
            {
                equalizer = entry.Equalizer;
            }
            else if (appLoopbackSources.TryGetValue(route.AppId, out var source))
            {
                equalizer = source.MixEqualizer;
            }

            ApplyEqualizer(equalizer, route);
        }
    }

    private static RouteConfig NormalizeRoute(RouteConfig route)
    {
        return new RouteConfig
        {
            RouteId = route.RouteId,
            AppId = route.AppId,
            Target = route.Target,
            Volume = route.Volume,
            Muted = route.Muted,
            EqEnabled = route.EqEnabled,
            Band60Db = Math.Clamp(route.Band60Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
            Band150Db = Math.Clamp(route.Band150Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
            Band400Db = Math.Clamp(route.Band400Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
            Band1000Db = Math.Clamp(route.Band1000Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
            Band2400Db = Math.Clamp(route.Band2400Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
            Band15000Db = Math.Clamp(route.Band15000Db, EqualizerSampleProvider.MinBandDb, EqualizerSampleProvider.MaxBandDb),
        };
    }

    private static void ApplyEqualizer(EqualizerSampleProvider? equalizer, RouteConfig route)
    {
        if (equalizer is null)
        {
            return;
        }

        equalizer.SetEqualizer(
            route.EqEnabled,
            route.Band60Db,
            route.Band150Db,
            route.Band400Db,
            route.Band1000Db,
            route.Band2400Db,
            route.Band15000Db);
    }

    private async Task EnsureOutputsAsync()
    {
        if (string.IsNullOrWhiteSpace(selection.InputDeviceId))
        {
            state = "error";
            message = "Select an input device.";
            return;
        }

        if (IsInputBound() && state != "error")
        {
            if (!voicemeeterRouteEnabled)
            {
                var boundDevice = FindAudioEndpoint(DataFlow.Render, selection.InputDeviceId);
                if (boundDevice is not null)
                {
                    TryRefreshVoicemeeterRoute(boundDevice.FriendlyName);
                }
            }

            return;
        }

        voicemeeterRouteEnabled = false;

        lock (gate)
        {
            outputBroadcast?.Dispose();
            outputBroadcast = null;
            boundInputSelectionId = null;
        }

        try
        {
            var inputDevice = FindAudioEndpoint(DataFlow.Render, selection.InputDeviceId);
            if (inputDevice is null)
            {
                state = "error";
                message = $"Input device was not found: {ExtractBindableDeviceName(selection.InputDeviceId)}";
                return;
            }

            var targetName = inputDevice.FriendlyName;
            var nextMixFormat = EngineAudioFormat.GetMixFormat(targetName);
            var sampleRateChanged = mixFormat.SampleRate != nextMixFormat.SampleRate;
            if (sampleRateChanged)
            {
                mixFormat = nextMixFormat;
                AudioDiagnostics.SetMixFormat(mixFormat);
                InvalidateCaptureSources();
                RebuildMixerChain();
            }
            else
            {
                mixFormat = nextMixFormat;
                AudioDiagnostics.SetMixFormat(mixFormat);
            }

            MixOutputRouter? nextBroadcast = null;
            Exception? lastBindError = null;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    if (attempt > 0)
                    {
                        await Task.Delay(120 * attempt);
                    }

                    var candidate = new MixOutputRouter(GetMixedSource, mixFormat);
                    candidate.Bind(inputDevice);
                    nextBroadcast = candidate;
                    break;
                }
                catch (Exception ex)
                {
                    lastBindError = ex;
                }
            }

            if (nextBroadcast is null)
            {
                state = "error";
                message =
                    $"Unable to bind input device: {DescribeAudioError(lastBindError ?? new InvalidOperationException("Unknown bind failure."))}";
                return;
            }

            var routeNote = string.Empty;
            if (TryRefreshVoicemeeterRoute(targetName, out var routeMessage))
            {
                routeNote = $" · {routeMessage}";
            }
            else if (VoicemeeterRoutingMap.ParseInputDeviceName(targetName) is not null &&
                     TryRefreshVoicemeeterRoute(targetName, out var voicemeeterRouteMessage) &&
                     !string.IsNullOrWhiteSpace(voicemeeterRouteMessage))
            {
                routeNote = $" · {voicemeeterRouteMessage}";
            }

            lock (gate)
            {
                outputBroadcast = nextBroadcast;
                boundInputSelectionId = selection.InputDeviceId;
                state = "starting";
                message = $"Bound input: {targetName} ({nextBroadcast.BindingDescription}){routeNote}";
                AudioDiagnostics.SetOutputBinding(nextBroadcast.BindingDescription, mixFormat);
            }
        }
        catch (Exception ex)
        {
            state = "error";
            message = $"Unable to bind input device: {DescribeAudioError(ex)}";
        }

        await Task.CompletedTask;
    }

    private bool IsInputBound()
    {
        return outputBroadcast is not null &&
               !string.IsNullOrWhiteSpace(selection.InputDeviceId) &&
               string.Equals(boundInputSelectionId, selection.InputDeviceId, StringComparison.Ordinal);
    }

    private async Task EnsureOutputAsync()
    {
        await EnsureOutputsAsync();
    }

    private async Task EnsureMicrophonesAsync()
    {
        var desired = SelectionNormalizer.GetMicrophoneSlots(selection)
            .ToDictionary(slot => slot.SlotId, StringComparer.Ordinal);

        foreach (var slotId in microphoneSources.Keys.Except(desired.Keys).ToList())
        {
            await RemoveMicrophoneFromMixerAsync(slotId);
            microphoneSources[slotId].Stop();
            microphoneSources[slotId].Dispose();
            microphoneSources.Remove(slotId);
        }

        var wasRunning = state is "running" or "starting";

        foreach (var (slotId, config) in desired)
        {
            if (microphoneSources.TryGetValue(slotId, out var existing) &&
                string.Equals(existing.SelectionId, config.MicrophoneId, StringComparison.Ordinal) &&
                existing.MixSampleRate == mixFormat.SampleRate)
            {
                continue;
            }

            if (microphoneSources.TryGetValue(slotId, out var previous))
            {
                await RemoveMicrophoneFromMixerAsync(slotId);
                previous.Stop();
                previous.Dispose();
                microphoneSources.Remove(slotId);
            }

            if (wasRunning)
            {
                await Task.Delay(30);
            }

            try
            {
                var device = FindAudioEndpoint(DataFlow.Capture, config.MicrophoneId!);
                if (device is null)
                {
                    message = $"Microphone was not found: {ExtractBindableDeviceName(config.MicrophoneId)}";
                    continue;
                }

                var newMic = await CreateMicSourceWithRetryAsync(device, config.MicrophoneId!);
                newMic.SetVolume(Math.Clamp(config.Volume, 0f, 4f));
                newMic.SetMuted(config.Muted);
                ApplyNoiseSuppressionSettings(newMic, config);
                microphoneSources[slotId] = newMic;
                await AttachMicrophoneToMixerAsync(slotId, newMic);
                message = $"Bound microphone: {device.FriendlyName}";
            }
            catch (Exception ex)
            {
                message = $"Unable to bind microphone: {DescribeAudioError(ex)}";
            }
        }
    }

    private async Task<MicSource> CreateMicSourceWithRetryAsync(MMDevice device, string selectionId)
    {
        var isHiFi = UsesHifiCableInput();
        var micBufferMilliseconds = CaptureDeviceTuning.GetMicCaptureBufferMilliseconds(device.FriendlyName, isHiFi);

        try
        {
            return await MicSource.CreateAsync(
                device,
                mixFormat,
                selectionId,
                micBufferMilliseconds,
                isHiFi);
        }
        catch (COMException ex) when ((ex.ErrorCode & 0xFFFFFFFF) == 0x88890002)
        {
            await Task.Delay(100);
            return await MicSource.CreateAsync(
                device,
                mixFormat,
                selectionId,
                micBufferMilliseconds,
                isHiFi);
        }
    }

    private bool UsesHifiCableInput() =>
        AudioTuningPolicy.AlwaysUseHiFiBuffers ||
        HifiCableFormat.IsHifiCableDevice(ExtractBindableDeviceName(selection.InputDeviceId));

    private static bool IsRecoverableBufferMessage(string? message)
    {
        return !string.IsNullOrWhiteSpace(message) &&
               message.Contains("Buffer full", StringComparison.OrdinalIgnoreCase);
    }

    private static string DescribeAudioError(Exception ex)
    {
        if (ex is COMException comException)
        {
            return $"{comException.Message} ({comException.ErrorCode & 0xFFFFFFFF:X8})";
        }

        return ex.Message;
    }

    public Task UpdateRouteMixAsync(DeviceSelection nextSelection, IReadOnlyCollection<RouteConfig> routes)
    {
        if (nextSelection.Microphones.Count > 0)
        {
            selection.Microphones = nextSelection.Microphones
                .Select(slot => new MicrophoneSlotConfig
                {
                    SlotId = slot.SlotId,
                    MicrophoneId = slot.MicrophoneId,
                    Muted = slot.Muted,
                    Volume = Math.Clamp(slot.Volume, 0f, 4f),
                    NoiseSuppression = slot.NoiseSuppression || (slot.NoiseSuppressionSettings?.Enabled ?? false),
                    NoiseSuppressionSettings = slot.NoiseSuppressionSettings,
                })
                .ToList();
        }
        else
        {
            selection.MicrophoneMuted = nextSelection.MicrophoneMuted;
            selection.MicrophoneVolume = Math.Clamp(nextSelection.MicrophoneVolume, 0f, 4f);
        }

        ApplyMicrophoneMix();

        foreach (var route in routes.Where(route =>
                     string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase)))
        {
            var normalizedRoute = NormalizeRoute(route);
            routeConfigs[normalizedRoute.RouteId] = normalizedRoute;

            if (appLoopbackSources.TryGetValue(route.AppId, out var source))
            {
                source.SetVolume(normalizedRoute.Volume);
                source.SetMuted(normalizedRoute.Muted);
                ApplyEqualizer(source.MixEqualizer, normalizedRoute);
            }
        }

        return Task.CompletedTask;
    }

    private void ApplyMicrophoneMix()
    {
        foreach (var slot in SelectionNormalizer.GetMicrophoneSlotSettings(selection))
        {
            if (string.IsNullOrWhiteSpace(slot.MicrophoneId))
            {
                continue;
            }

            if (!microphoneSources.TryGetValue(slot.SlotId, out var source))
            {
                continue;
            }

            source.SetVolume(Math.Clamp(slot.Volume, 0f, 4f));
            source.SetMuted(slot.Muted);
            ApplyNoiseSuppressionSettings(source, slot);
        }
    }

    private static void ApplyNoiseSuppressionSettings(MicSource source, MicrophoneSlotConfig slot)
    {
        var settings = slot.NoiseSuppressionSettings;
        if (settings is null)
        {
            source.SetNoiseSuppression(slot.NoiseSuppression);
            return;
        }

        source.SetNoiseSuppressionSettings(
            settings.Enabled || slot.NoiseSuppression,
            settings.Strength,
            settings.Threshold,
            settings.HighPassHz,
            settings.Attack,
            settings.Release,
            settings.NoiseGateEnabled,
            settings.NoiseGateThreshold);
    }

    private async Task SyncAppLoopbackSourcesAsync(IReadOnlyCollection<RouteConfig> routes)
    {
        var desiredApps = routes
            .Where(route => string.Equals(route.Target, "hifi-cable", StringComparison.OrdinalIgnoreCase))
            .GroupBy(route => route.AppId)
            .ToDictionary(
                group => group.Key,
                group =>
                {
                    var route = group.OrderByDescending(item => item.Volume).First();
                    return (route.Volume, route.Muted, route.ProcessName);
                },
                StringComparer.Ordinal);

        foreach (var appId in appLoopbackSources.Keys.Except(desiredApps.Keys).ToList())
        {
            await RemoveAppFromMixerAsync(appId);
            appLoopbackSources[appId].Dispose();
            appLoopbackSources.Remove(appId);
            routeErrors.Remove(appId);
        }

        foreach (var (appId, mix) in desiredApps)
        {
            if (appLoopbackSources.TryGetValue(appId, out var existing))
            {
                if (string.Equals(existing.State, "error", StringComparison.OrdinalIgnoreCase))
                {
                    if (IsRecoverableBufferMessage(existing.LastError))
                    {
                        await RemoveAppFromMixerAsync(appId);
                        existing.Dispose();
                        appLoopbackSources.Remove(appId);
                        ProcessLoopbackPool.Evict(existing.CaptureProcessId);
                    }
                    else
                    {
                        await RemoveAppFromMixerAsync(appId);
                        existing.Dispose();
                        appLoopbackSources.Remove(appId);
                        if (int.TryParse(appId, out var failedProcessId))
                        {
                            ProcessLoopbackPool.Evict(failedProcessId);
                        }
                    }
                }
                else if (int.TryParse(appId, out var routeProcessId) &&
                         AudioProcessResolver.ShouldRecreateLoopbackCapture(
                             enumerator,
                             routeProcessId,
                             existing.CaptureProcessId,
                             existing.Level,
                             mix.ProcessName))
                {
                    if (!AudioProcessResolver.IsProcessRunning(existing.CaptureProcessId))
                    {
                        await RemoveAppFromMixerAsync(appId);
                        existing.Dispose();
                        appLoopbackSources.Remove(appId);
                        ProcessLoopbackPool.Evict(existing.CaptureProcessId);
                    }
                    else
                    {
                        existing.NoteStaleCaptureCandidate();
                        if (existing.StaleCaptureChecks < 3)
                        {
                            existing.SetVolume(mix.Volume);
                            existing.SetMuted(mix.Muted);
                            routeErrors.Remove(appId);

                            if (!appMixEntries.ContainsKey(appId))
                            {
                                await AttachAppToMixerAsync(appId, existing);
                            }

                            continue;
                        }

                        await RemoveAppFromMixerAsync(appId);
                        existing.Dispose();
                        appLoopbackSources.Remove(appId);
                        ProcessLoopbackPool.Evict(existing.CaptureProcessId);
                    }
                }
                else
                {
                    existing.ResetStaleCaptureChecks();
                    existing.SetVolume(mix.Volume);
                    existing.SetMuted(mix.Muted);
                    routeErrors.Remove(appId);

                    if (!appMixEntries.ContainsKey(appId))
                    {
                        await AttachAppToMixerAsync(appId, existing);
                    }

                    continue;
                }
            }

            if (appLoopbackSources.ContainsKey(appId))
            {
                continue;
            }

            if (!int.TryParse(appId, out var processId))
            {
                routeErrors[appId] = "Invalid process id.";
                message = $"Unable to route app {appId}: invalid process id.";
                continue;
            }

            try
            {
                var source = await CreateLoopbackSourceWithRetryAsync(
                    appId,
                    processId,
                    mixFormat,
                    mix.Volume,
                    mix.ProcessName);
                source.SetMuted(mix.Muted);
                appLoopbackSources[appId] = source;
                routeErrors.Remove(appId);
                await AttachAppToMixerAsync(appId, source);
                message = $"Capturing audio from process {processId}.";
            }
            catch (Exception ex)
            {
                if (!IsRecoverableBufferMessage(ex.Message))
                {
                    routeErrors[appId] = ex.Message;
                }

                message = $"Unable to capture audio for process {processId}: {ex.Message}";
            }
        }

        ApplyAppEqualizers();

        if (desiredApps.Count == 0)
        {
            if (state is "running" or "starting")
            {
                StartSources();
            }

            return;
        }

        if (state == "running" || state == "starting")
        {
            StartSources();
        }
    }

    public void Dispose()
    {
        outputBroadcast?.Dispose();
        foreach (var source in microphoneSources.Values)
        {
            source.Dispose();
        }

        microphoneSources.Clear();
        foreach (var source in appLoopbackSources.Values)
        {
            source.Dispose();
        }

        appLoopbackSources.Clear();
        ProcessLoopbackPool.DisposeAll();
        enumerator.Dispose();
    }

    private void StartSources()
    {
        lock (gate)
        {
            if (outputBroadcast is null)
            {
                state = "error";
                message ??= string.IsNullOrWhiteSpace(selection.InputDeviceId)
                    ? "Select Hi-Fi Cable Input and start the stream again."
                    : "Unable to bind the selected Input device. Try Refresh, then Start stream again.";
                return;
            }
        }

        EnsureMixerInputsAttached();

        var hifiOutputWarning = string.Empty;
        if (UsesHifiCableInput())
        {
            hifiOutputActivator ??= new HifiCableOutputActivator();
            try
            {
                hifiOutputActivator.Start();
            }
            catch (Exception ex)
            {
                hifiOutputWarning =
                    $" Hi-Fi Cable Output keep-alive failed ({ex.Message}) — listeners on Hi-Fi Cable Output will hear silence.";
            }

            if (hifiOutputActivator.IsActive != true)
            {
                var detail = hifiOutputActivator.LastError;
                hifiOutputWarning = string.IsNullOrWhiteSpace(detail)
                    ? " Hi-Fi Cable Output could not be opened — other apps will hear silence until Recording → Hi-Fi Cable Output is Enabled and matching Input format (48 kHz · 24-bit)."
                    : $" {detail}";
            }
        }

        var boundDevice = FindAudioEndpoint(DataFlow.Render, selection.InputDeviceId);
        if (boundDevice is not null)
        {
            TryRefreshVoicemeeterRoute(boundDevice.FriendlyName, out var routeMessage);
            if (!string.IsNullOrWhiteSpace(routeMessage) && !voicemeeterRouteEnabled)
            {
                message = $"{message} · {routeMessage}";
            }
        }

        foreach (var source in microphoneSources.Values)
        {
            source.Start();
        }

        foreach (var source in appLoopbackSources.Values)
        {
            source.Start();
        }

        WaitForCapturePriming();

        lock (gate)
        {
            // Always start WASAPI render after sources are primed — Bind alone does not Play.
            outputBroadcast?.Play();
        }

        lock (gate)
        {
            var routeSuffix = voicemeeterRouteEnabled ? " Voicemeeter bus routed." : string.Empty;
            var hifiActive = UsesHifiCableInput() && hifiOutputActivator?.IsActive == true;
            var hifiSuffix = hifiActive
                ? " Hi-Fi Cable Output is active."
                : hifiOutputWarning;

            // Still mark running so Input playback continues, but surface Output failure loudly.
            state = "running";
            message = microphoneSources.Count == 0
                ? $"Streaming application audio to input.{routeSuffix}{hifiSuffix}"
                : $"Streaming mix to input.{routeSuffix}{hifiSuffix}";

            if (UsesHifiCableInput() && !hifiActive)
            {
                // Keep state running (Input may still be useful) but prefer the Output error text.
                message = string.IsNullOrWhiteSpace(hifiOutputActivator?.LastError)
                    ? message
                    : hifiOutputActivator!.LastError +
                      " Mix is playing to Hi-Fi Cable Input, but Output listeners will hear silence.";
            }
        }
    }

    private void EnsureMixerInputsAttached()
    {
        foreach (var (slotId, mic) in microphoneSources.ToList())
        {
            if (!microphoneMixEntries.ContainsKey(slotId))
            {
                AttachMicrophoneToMixer(slotId, mic);
            }
        }

        foreach (var (appId, source) in appLoopbackSources.ToList())
        {
            if (!appMixEntries.ContainsKey(appId))
            {
                AttachAppToMixer(appId, source);
            }
        }
    }

    private void WaitForCapturePriming()
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(750);
        var minMicSamples = Math.Max(
            mixFormat.Channels,
            mixFormat.SampleRate * mixFormat.Channels * 48 / 1000);
        var minAppSamples = Math.Max(
            mixFormat.Channels,
            mixFormat.SampleRate * mixFormat.Channels * LatencyTuning.AppLoopbackWarmupMilliseconds / 1000 / 2);

        while (DateTime.UtcNow < deadline)
        {
            var micReady = microphoneSources.Count == 0 ||
                microphoneSources.Values.Any(mic => mic.BufferedSamples >= minMicSamples);
            var appReady = appLoopbackSources.Count == 0 ||
                appLoopbackSources.Values.Any(app => app.BufferedSamples >= minAppSamples);

            if (micReady && appReady)
            {
                return;
            }

            Thread.Sleep(15);
        }
    }

    private bool TryRefreshVoicemeeterRoute(string inputDeviceName, out string routeMessage)
    {
        if (VoicemeeterRemoteClient.TryEnableRoute(inputDeviceName, out routeMessage))
        {
            voicemeeterRouteEnabled = true;
            return true;
        }

        if (VoicemeeterRoutingMap.ParseInputDeviceName(inputDeviceName) is null)
        {
            voicemeeterRouteEnabled = false;
        }

        return false;
    }

    private void TryRefreshVoicemeeterRoute(string inputDeviceName)
    {
        if (TryRefreshVoicemeeterRoute(inputDeviceName, out var routeMessage) && !string.IsNullOrWhiteSpace(routeMessage))
        {
            message = $"{message} · {routeMessage}";
        }
        else if (!voicemeeterRouteEnabled && !string.IsNullOrWhiteSpace(routeMessage))
        {
            message = $"{message} · {routeMessage}";
        }
    }

    private async Task<AppLoopbackSource> CreateLoopbackSourceWithRetryAsync(
        string appId,
        int processId,
        WaveFormat mixFormat,
        float volume,
        string? processName = null)
    {
        var captureProcessId = AudioProcessResolver.ResolvePlaybackProcessId(enumerator, processId, processName);
        var processIdsToTry = captureProcessId == processId
            ? new[] { processId }
            : new[] { captureProcessId, processId };

        Exception? lastError = null;

        foreach (var targetProcessId in processIdsToTry)
        {
            foreach (var includeProcessTree in new[] { true, false })
            {
                ProcessLoopbackPool.Evict(targetProcessId);

                try
                {
                    var source = await AppLoopbackSource.CreateAsync(
                        appId,
                        processId,
                        targetProcessId,
                        mixFormat,
                        volume,
                        includeProcessTree,
                        UsesHifiCableInput());

                    var warning = AudioProcessResolver.TryGetDirectHifiPlaybackWarning(
                        enumerator,
                        targetProcessId,
                        selection.InputDeviceId);
                    if (!string.IsNullOrWhiteSpace(warning))
                    {
                        routeErrors[appId] = warning;
                    }
                    else
                    {
                        routeErrors.Remove(appId);
                    }

                    return source;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    ProcessLoopbackPool.Evict(targetProcessId);

                    if (!IsLoopbackReuseFailure(ex))
                    {
                        throw;
                    }

                    // Only wait after a failed reuse attempt, not on the first try.
                    await Task.Delay(150);
                }
            }
        }

        throw lastError ?? new InvalidOperationException("Unable to start process loopback capture.");
    }

    private string? GetRouteWarning(string appId, int captureProcessId)
    {
        if (routeErrors.TryGetValue(appId, out var routeError))
        {
            return routeError;
        }

        return AudioProcessResolver.TryGetDirectHifiPlaybackWarning(
            enumerator,
            captureProcessId,
            selection.InputDeviceId);
    }

    private static bool IsLoopbackReuseFailure(Exception ex)
    {
        if (ex is COMException comException)
        {
            var code = comException.HResult & 0xFFFFFFFF;
            if (code is 0x80004001 or 0x88890002)
            {
                return true;
            }
        }

        return ex is NotImplementedException
            || string.Equals(ex.Message, "The method or operation is not implemented.", StringComparison.Ordinal);
    }

    private MMDevice? FindAudioEndpoint(DataFlow flow, string? selectionId)
    {
        if (string.IsNullOrWhiteSpace(selectionId))
        {
            return null;
        }

        var targetName = ExtractBindableDeviceName(selectionId);
        var activeMatch = FindAudioEndpoint(flow, selectionId, targetName, DeviceState.Active);
        if (activeMatch is not null)
        {
            return activeMatch;
        }

        return FindAudioEndpoint(flow, selectionId, targetName, DeviceState.All);
    }

    private MMDevice? FindAudioEndpoint(
        DataFlow flow,
        string selectionId,
        string targetName,
        DeviceState deviceState)
    {
        var endpoints = enumerator.EnumerateAudioEndPoints(flow, deviceState).ToList();
        var candidateNames = BuildDeviceNameCandidates(flow, targetName).ToList();

        var exactIdMatch = endpoints.FirstOrDefault(endpoint => endpoint.ID == selectionId);
        if (exactIdMatch is not null)
        {
            return exactIdMatch;
        }

        if (!string.Equals(selectionId, targetName, StringComparison.Ordinal))
        {
            exactIdMatch = endpoints.FirstOrDefault(endpoint => endpoint.ID == targetName);
            if (exactIdMatch is not null)
            {
                return exactIdMatch;
            }
        }

        foreach (var candidateName in candidateNames)
        {
            var exactNameMatch = endpoints.FirstOrDefault(endpoint =>
                string.Equals(endpoint.FriendlyName, candidateName, StringComparison.OrdinalIgnoreCase));
            if (exactNameMatch is not null)
            {
                return exactNameMatch;
            }
        }

        var partialMatch = endpoints.FirstOrDefault(endpoint =>
            EndpointNamesMatch(endpoint.FriendlyName, targetName));
        if (partialMatch is not null)
        {
            return partialMatch;
        }

        if (flow == DataFlow.Render && IsHifiCableTarget(targetName) && !IsVoicemeeterBusTarget(targetName))
        {
            var hifiMatch = endpoints.FirstOrDefault(endpoint => IsHifiCableRenderName(endpoint.FriendlyName));
            if (hifiMatch is not null)
            {
                return hifiMatch;
            }
        }

        return null;
    }

    private static bool IsVoicemeeterBusTarget(string targetName)
    {
        return System.Text.RegularExpressions.Regex.IsMatch(
            targetName,
            @"voicemeeter (?:in|out) [ab]\d+",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static bool EndpointNamesMatch(string friendlyName, string targetName)
    {
        if (string.Equals(friendlyName, targetName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (friendlyName.Contains(targetName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var friendlyBase = friendlyName.Split('(')[0].Trim();
        var targetBase = targetName.Split('(')[0].Trim();
        return string.Equals(friendlyBase, targetBase, StringComparison.OrdinalIgnoreCase) ||
               friendlyBase.Contains(targetBase, StringComparison.OrdinalIgnoreCase) ||
               targetBase.Contains(friendlyBase, StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> BuildDeviceNameCandidates(DataFlow flow, string targetName)
    {
        yield return targetName;

        if (flow == DataFlow.Render)
        {
            if (targetName.Contains("CABLE Input", StringComparison.OrdinalIgnoreCase) &&
                targetName.Contains("Hi-Fi", StringComparison.OrdinalIgnoreCase))
            {
                yield return "CABLE Input (VB-Audio Hi-Fi Cable)";
                yield return "Hi-Fi Cable Input";
            }
            else if (targetName.Contains("Voicemeeter Input", StringComparison.OrdinalIgnoreCase))
            {
                yield return "Voicemeeter Aux Input (VB-Audio Voicemeeter AUX VAIO)";
                yield return "Voicemeeter VAIO3 Input (VB-Audio Voicemeeter VAIO)";
            }
            else if (targetName.Contains("Voicemeeter In", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var candidate in BuildVoicemeeterBusInputCandidates(targetName))
                {
                    yield return candidate;
                }
            }
        }
        else if (flow == DataFlow.Capture)
        {
            if (targetName.Contains("CABLE Output", StringComparison.OrdinalIgnoreCase) &&
                targetName.Contains("Hi-Fi", StringComparison.OrdinalIgnoreCase))
            {
                yield return "CABLE Output (VB-Audio Hi-Fi Cable)";
                yield return "Hi-Fi Cable Output";
            }
            else if (targetName.Contains("Voicemeeter Out", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var candidate in BuildVoicemeeterBusOutputCandidates(targetName))
                {
                    yield return candidate;
                }
            }
        }
    }

    private static IEnumerable<string> BuildVoicemeeterBusInputCandidates(string targetName)
    {
        var busMatch = System.Text.RegularExpressions.Regex.Match(
            targetName,
            @"voicemeeter in ([ab]\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!busMatch.Success)
        {
            yield break;
        }

        var busId = busMatch.Groups[1].Value.ToUpperInvariant();
        yield return $"Voicemeeter In {busId}";
        yield return $"Voicemeeter In {busId} (VB-Audio Voicemeeter VAIO)";
    }

    private static IEnumerable<string> BuildVoicemeeterBusOutputCandidates(string targetName)
    {
        var busMatch = System.Text.RegularExpressions.Regex.Match(
            targetName,
            @"voicemeeter out ([ab]\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!busMatch.Success)
        {
            yield break;
        }

        var busId = busMatch.Groups[1].Value.ToUpperInvariant();
        yield return $"Voicemeeter Out {busId}";
        yield return $"Voicemeeter Out {busId} (VB-Audio Voicemeeter VAIO)";
    }

    private static bool IsHifiCableTarget(string targetName)
    {
        return HifiCableFormat.IsHifiCableDevice(targetName) ||
               targetName.Contains("Voicemeeter Input", StringComparison.OrdinalIgnoreCase) ||
               targetName.Contains("Voicemeeter Aux Input", StringComparison.OrdinalIgnoreCase) ||
               targetName.Contains("Voicemeeter VAIO3 Input", StringComparison.OrdinalIgnoreCase) ||
               targetName.Contains("Voicemeeter In", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsHifiCableRenderName(string friendlyName)
    {
        return HifiCableFormat.IsHifiCableDevice(friendlyName) ||
               friendlyName.Contains("Voicemeeter Input", StringComparison.OrdinalIgnoreCase) ||
               friendlyName.Contains("Voicemeeter Aux Input", StringComparison.OrdinalIgnoreCase) ||
               friendlyName.Contains("Voicemeeter VAIO3 Input", StringComparison.OrdinalIgnoreCase) ||
               friendlyName.Contains("Voicemeeter In", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsMicrophoneTarget(string targetName)
    {
        return !IsHifiCableTarget(targetName);
    }
}

internal sealed class MicSource : IDisposable
{
    private readonly MicWasapiCapture capture;
    private readonly SmoothCaptureBuffer captureBuffer;
    private readonly WaveFormat captureFormat;
    private readonly int captureSampleRate;
    private readonly NoiseSuppressionSampleProvider noiseSuppressionProvider;
    private readonly FullBlockVolumeSampleProvider volumeProvider;
    private float baseVolume = 1f;
    private bool muted;

    private MicSource(
        string selectionId,
        string deviceId,
        string deviceName,
        MicWasapiCapture capture,
        SmoothCaptureBuffer captureBuffer,
        WaveFormat captureFormat,
        NoiseSuppressionSampleProvider noiseSuppressionProvider,
        FullBlockVolumeSampleProvider volumeProvider,
        int mixSampleRate)
    {
        SelectionId = selectionId;
        DeviceId = deviceId;
        DeviceName = deviceName;
        MixSampleRate = mixSampleRate;
        this.capture = capture;
        this.captureBuffer = captureBuffer;
        this.captureFormat = captureFormat;
        this.captureSampleRate = captureFormat.SampleRate;
        this.noiseSuppressionProvider = noiseSuppressionProvider;
        this.volumeProvider = volumeProvider;
        SampleProvider = volumeProvider;
        IsReady = false;
        capture.DataAvailable += OnCaptureDataAvailable;
        capture.RecordingStopped += (_, args) =>
        {
            if (args.Exception is not null)
            {
                IsReady = false;
            }
        };
    }

    public string SelectionId { get; }
    public string DeviceId { get; }
    public string DeviceName { get; }
    public int MixSampleRate { get; }
    public bool IsReady { get; private set; }
    public float Level { get; private set; }
    public ISampleProvider SampleProvider { get; }

    public void SetMuted(bool isMuted)
    {
        muted = isMuted;
        ApplyVolume();
    }

    public bool IsMuted => muted;

    public int CaptureSampleRate => captureSampleRate;

    public int BufferedSamples => captureBuffer.BufferedSamples;

    public void SetVolume(float volume)
    {
        baseVolume = Math.Clamp(volume, 0f, 4f);
        ApplyVolume();
    }

    public void SetNoiseSuppression(bool enabled)
    {
        noiseSuppressionProvider.SetEnabled(enabled);
    }

    public void SetNoiseSuppressionSettings(
        bool enabled,
        float strength,
        float threshold,
        float highPassHz,
        float attack,
        float release,
        bool noiseGateEnabled = false,
        float noiseGateThreshold = 35f)
    {
        noiseSuppressionProvider.SetSettings(
            enabled,
            strength,
            threshold,
            highPassHz,
            attack,
            release,
            noiseGateEnabled,
            noiseGateThreshold);
    }

    private void ApplyVolume()
    {
        volumeProvider.Volume = muted ? 0f : baseVolume;
    }

    private void OnCaptureDataAvailable(object? sender, WaveInEventArgs args)
    {
        try
        {
            captureBuffer.Write(args.Buffer, 0, args.BytesRecorded);
            var peak = AudioLevelUtility.ComputePeak(args.Buffer, args.BytesRecorded, captureFormat);
            var postGain = muted ? 0f : peak * baseVolume;
            Level = AudioLevelUtility.ApplyDecay(Level, postGain);
            IsReady = true;
        }
        catch
        {
            IsReady = false;
        }
    }

    public static Task<MicSource> CreateAsync(
        MMDevice device,
        WaveFormat mixFormat,
        string selectionId,
        int micBufferMilliseconds = LatencyTuning.MicCaptureBufferMilliseconds,
        bool isHiFiOutput = false)
    {
        var deviceName = device.FriendlyName;
        var comfortCapture = CaptureDeviceTuning.IsComfortCaptureDevice(deviceName);
        var comfortUnderrun = CaptureDeviceTuning.UseComfortUnderrun(deviceName);
        var capture = MicWasapiCapture.Create(
            device,
            micBufferMilliseconds,
            EngineAudioFormat.CaptureSampleRate);
        var captureFormat = capture.WaveFormat;
        var captureBuffer = new SmoothCaptureBuffer(
            captureFormat,
            mixFormat.SampleRate,
            isHiFiOutput,
            comfortUnderrun: comfortUnderrun,
            deviceName: deviceName,
            jitterBufferMilliseconds: 0,
            holdLastOnUnderrun: false,
            enableTrim: true);
        var provider = CapturePipeline.Build(captureBuffer, captureFormat, mixFormat, comfortCapture);
        var noiseSuppressionProvider = new NoiseSuppressionSampleProvider(provider);
        var volumeProvider = new FullBlockVolumeSampleProvider(noiseSuppressionProvider) { Volume = 1f };
        return Task.FromResult(new MicSource(
            selectionId,
            device.ID,
            deviceName,
            capture,
            captureBuffer,
            captureFormat,
            noiseSuppressionProvider,
            volumeProvider,
            mixFormat.SampleRate));
    }

    public void Start()
    {
        if (capture.CaptureState != CaptureState.Capturing)
        {
            capture.StartRecording();
        }

        IsReady = true;
    }

    public void Stop()
    {
        if (capture.CaptureState != CaptureState.Stopped)
        {
            capture.StopRecording();
        }
    }

    public void Dispose()
    {
        capture.DataAvailable -= OnCaptureDataAvailable;
        Stop();
        capture.Dispose();
    }
}

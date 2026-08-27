using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Streams the live mix to a Windows playback endpoint (Hi-Fi Cable Input, Voicemeeter input, etc.).
/// Hi-Fi Cable prefers NAudio WasapiOut with IEEE float (custom render can stay silent on some hosts).
/// Packed PCM24 is never fed to WasapiOut. After Play, a silent pump can fail over to WASAPI render.
/// </summary>
internal sealed class WasapiMixOutputBroadcast : IMixOutputBroadcast
{
    private readonly Func<ISampleProvider> sourceFactory;
    private readonly WaveFormat sourceFormat;
    private readonly List<IDisposable> outputs = [];
    private MMDevice? boundDevice;
    private Action? playAction;
    private Action? stopAction;
    private string? boundDeviceId;
    private string boundDeviceName = string.Empty;
    private bool boundIsHiFi;
    private bool preferWasapiOut = true;

    public WasapiMixOutputBroadcast(Func<ISampleProvider> sourceFactory, WaveFormat sourceFormat)
    {
        this.sourceFactory = sourceFactory;
        this.sourceFormat = sourceFormat;
    }

    public bool IsBound => outputs.Count > 0;

    public string BindingDescription { get; private set; } = string.Empty;

    public void Bind(MMDevice device)
    {
        boundDeviceId = device.ID;
        boundDeviceName = device.FriendlyName;
        boundIsHiFi = HifiCableFormat.IsHifiCableDevice(boundDeviceName);
        preferWasapiOut = boundIsHiFi;
        BindInternal();
    }

    /// <summary>
    /// After Play(), if the render pump pulled no bytes, flip backend and play again.
    /// </summary>
    public bool TryRecoverSilentPump(int settleMilliseconds = 450)
    {
        if (!boundIsHiFi || string.IsNullOrWhiteSpace(boundDeviceId))
        {
            return OutputPullMeter.BytesPulled > 0;
        }

        var before = OutputPullMeter.BytesPulled;
        Thread.Sleep(Math.Max(100, settleMilliseconds));
        if (OutputPullMeter.BytesPulled > before)
        {
            return true;
        }

        preferWasapiOut = !preferWasapiOut;
        try
        {
            BindInternal();
            playAction?.Invoke();
        }
        catch
        {
            preferWasapiOut = !preferWasapiOut;
            try
            {
                BindInternal();
                playAction?.Invoke();
            }
            catch
            {
                return false;
            }
        }

        before = OutputPullMeter.BytesPulled;
        Thread.Sleep(Math.Max(100, settleMilliseconds));
        return OutputPullMeter.BytesPulled > before;
    }

    public void Play()
    {
        playAction?.Invoke();
    }

    public void Stop()
    {
        stopAction?.Invoke();
    }

    public void Dispose()
    {
        DisposeOutputs();
    }

    private void BindInternal()
    {
        DisposeOutputs();
        OutputPullMeter.Reset();

        if (string.IsNullOrWhiteSpace(boundDeviceId))
        {
            throw new InvalidOperationException("No playback device selected for bind.");
        }

        var delegatingSource = new DelegateSampleProvider(sourceFormat, sourceFactory);
        var qualityHint = HifiCableOutputFormat.GetSetupQualityHint(boundDeviceName);
        Exception? lastError = null;
        using var enumerator = new MMDeviceEnumerator();

        MMDevice probeDevice;
        try
        {
            probeDevice = enumerator.GetDevice(boundDeviceId);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Playback device disappeared: {boundDeviceName}", ex);
        }

        IReadOnlyList<WasapiBindAttempt> attempts;
        try
        {
            attempts = HifiCableOutputBindPlanner.GetAttempts(probeDevice, boundDeviceName);
        }
        finally
        {
            probeDevice.Dispose();
        }

        // First pass: preferred backend. Second pass: alternate (Hi-Fi only).
        foreach (var useWasapiOut in boundIsHiFi
                     ? (preferWasapiOut ? new[] { true, false } : new[] { false, true })
                     : new[] { false })
        {
            foreach (var attempt in attempts)
            {
                MMDevice? attemptDevice = null;
                try
                {
                    attemptDevice = enumerator.GetDevice(boundDeviceId);
                    if (boundIsHiFi)
                    {
                        HifiCableEndpointVolume.EnsurePlaybackAudible(attemptDevice);
                    }

                    var bindFormat = boundIsHiFi
                        ? ToWasapiOutSafeFormat(ResolveBindFormat(attemptDevice, attempt.Format))
                        : attempt.Format;
                    var outputSource = CreateOutputSource(delegatingSource, bindFormat, isHiFi: boundIsHiFi);
                    var waveProvider = new FullBlockWaveProvider(
                        OutputWaveProviderFactory.Create(outputSource, bindFormat));
                    var latencyMilliseconds = boundIsHiFi
                        ? LatencyTuning.HiFiOutputLatencyMilliseconds
                        : LatencyTuning.OutputLatencyMilliseconds;

                    if (useWasapiOut)
                    {
                        var wasapiOut = new WasapiOutBroadcast();
                        wasapiOut.Configure(
                            attemptDevice,
                            waveProvider,
                            latencyMilliseconds,
                            useEventSync: false);
                        outputs.Add(wasapiOut);
                        playAction = wasapiOut.Play;
                        stopAction = wasapiOut.Stop;
                        BindingDescription =
                            $"Hi-Fi Cable {boundDeviceName} · WasapiOut · {DescribeAttemptFormat(bindFormat)}";
                    }
                    else
                    {
                        var render = new WasapiRenderBroadcast();
                        render.Configure(
                            attemptDevice,
                            attempt.ShareMode,
                            useEventSync: false,
                            latencyMilliseconds,
                            waveProvider,
                            attempt.AllowAutoConvert);
                        outputs.Add(render);
                        playAction = render.Play;
                        stopAction = render.Stop;
                        BindingDescription = boundIsHiFi
                            ? $"Hi-Fi Cable {boundDeviceName} · WASAPI · {DescribeAttemptFormat(bindFormat)}"
                            : $"WASAPI {boundDeviceName} · {DescribeAttemptFormat(bindFormat)}";
                    }

                    boundDevice = attemptDevice;
                    attemptDevice = null;
                    preferWasapiOut = useWasapiOut;
                    AudioDiagnostics.SetOutputBinding(BindingDescription, bindFormat);
                    return;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    DisposeOutputs();
                    attemptDevice?.Dispose();
                }
            }
        }

        throw CreateBindException(
            boundDeviceName,
            boundIsHiFi,
            qualityHint,
            lastError ?? new InvalidOperationException("No bind attempts were generated."));
    }

    private static WaveFormat ResolveBindFormat(MMDevice device, WaveFormat attemptFormat)
    {
        try
        {
            var mixFormat = device.AudioClient.MixFormat;
            if (WaveFormatUtility.IsFloatFormat(mixFormat) &&
                mixFormat.SampleRate == attemptFormat.SampleRate &&
                mixFormat.Channels == attemptFormat.Channels)
            {
                return WaveFormat.CreateIeeeFloatWaveFormat(mixFormat.SampleRate, mixFormat.Channels);
            }

            // Prefer the live MixFormat rate as float — bit-perfect Hi-Fi stays audible.
            if (mixFormat.SampleRate > 0)
            {
                return WaveFormat.CreateIeeeFloatWaveFormat(
                    mixFormat.SampleRate,
                    Math.Max(1, mixFormat.Channels));
            }
        }
        catch
        {
            // Fall through.
        }

        return ToWasapiOutSafeFormat(attemptFormat);
    }

    private static WaveFormat ToWasapiOutSafeFormat(WaveFormat attemptFormat)
    {
        if (WaveFormatUtility.IsFloatFormat(attemptFormat))
        {
            return attemptFormat;
        }

        return WaveFormat.CreateIeeeFloatWaveFormat(
            attemptFormat.SampleRate,
            Math.Max(1, attemptFormat.Channels));
    }

    private static ISampleProvider CreateOutputSource(
        ISampleProvider source,
        WaveFormat outputFormat,
        bool isHiFi)
    {
        // Match Test cable for Hi-Fi: tone → (optional resample) → WasapiOut, no OutputStage.
        // OutputStage buffering has left the live mix silent on some hosts while Test still passed.
        ISampleProvider staged = isHiFi
            ? source
            : new OutputStageSampleProvider(
                source,
                bufferMilliseconds: LatencyTuning.OutputStageBufferMilliseconds);

        if (outputFormat.SampleRate == staged.WaveFormat.SampleRate)
        {
            return staged;
        }

        return new StudioRateOutputSampleProvider(staged, outputFormat.SampleRate);
    }

    private static InvalidOperationException CreateBindException(
        string deviceName,
        bool isHiFiTarget,
        string qualityHint,
        Exception inner)
    {
        if (isHiFiTarget)
        {
            return new InvalidOperationException(
                $"Unable to open {deviceName} ({qualityHint}). " +
                "Open Windows Sound → Playback, double-click Hi-Fi Cable Input → Advanced tab → " +
                $"set Default Format to {HifiCableFormat.HiFiEngineBitsPerSample} bit, {HifiCableFormat.EngineCleanSampleRate} Hz (Clean audio). " +
                "Use the same format on Hi-Fi Cable Output (Input and Output must match — Hi-Fi Cable is bit-perfect).",
                inner);
        }

        return new InvalidOperationException(
            $"Unable to open {deviceName} for playback. Configure the device for {qualityHint}.",
            inner);
    }

    private void DisposeOutputs()
    {
        Stop();
        foreach (var output in outputs)
        {
            output.Dispose();
        }

        outputs.Clear();
        playAction = null;
        stopAction = null;
        boundDevice?.Dispose();
        boundDevice = null;
        BindingDescription = string.Empty;
    }

    private static string DescribeAttemptFormat(WaveFormat format)
    {
        var encoding = WaveFormatUtility.IsFloatFormat(format) ? "float" : "pcm";
        return $"{format.SampleRate} Hz, {WaveFormatUtility.GetEffectiveBitsPerSample(format)}-bit {encoding}";
    }
}

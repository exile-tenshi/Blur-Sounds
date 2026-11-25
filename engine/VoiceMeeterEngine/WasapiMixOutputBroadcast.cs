using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Streams the live mix to a Windows playback endpoint (Hi-Fi Cable Input, Voicemeeter input, etc.).
/// Hi-Fi Cable uses the same WasapiRenderBroadcast path as main — NAudio WasapiOut corrupts
/// virtual-cable audio (extreme bitrattling) even with IEEE float providers.
/// </summary>
internal sealed class WasapiMixOutputBroadcast : IMixOutputBroadcast
{
    private readonly Func<ISampleProvider> sourceFactory;
    private readonly WaveFormat sourceFormat;
    private readonly List<IDisposable> outputs = [];
    private MMDevice? boundDevice;
    private Action? playAction;
    private Action? stopAction;

    public WasapiMixOutputBroadcast(Func<ISampleProvider> sourceFactory, WaveFormat sourceFormat)
    {
        this.sourceFactory = sourceFactory;
        this.sourceFormat = sourceFormat;
    }

    public bool IsBound => outputs.Count > 0;

    public string BindingDescription { get; private set; } = string.Empty;

    public void Bind(MMDevice device)
    {
        DisposeOutputs();
        OutputPullMeter.Reset();

        var delegatingSource = new DelegateSampleProvider(sourceFormat, sourceFactory);
        var deviceName = device.FriendlyName;
        var deviceId = device.ID;
        var isHiFiTarget = HifiCableFormat.IsHifiCableDevice(deviceName);
        var qualityHint = HifiCableOutputFormat.GetSetupQualityHint(deviceName);
        var attempts = HifiCableOutputBindPlanner.GetAttempts(device, deviceName);

        Exception? lastError = null;
        using var enumerator = new MMDeviceEnumerator();

        foreach (var attempt in attempts)
        {
            MMDevice? attemptDevice = null;
            try
            {
                // Fresh MMDevice per attempt — NAudio caches AudioClient on MMDevice and a
                // failed Initialize leaves that cache unusable for retries.
                attemptDevice = enumerator.GetDevice(deviceId);
                if (isHiFiTarget)
                {
                    HifiCableEndpointVolume.EnsurePlaybackAudible(attemptDevice);
                }

                var bindFormat = ResolveBindFormat(attemptDevice, attempt.Format, isHiFiTarget);
                var outputSource = CreateOutputSource(delegatingSource, bindFormat);
                var waveProvider = new FullBlockWaveProvider(
                    OutputWaveProviderFactory.Create(outputSource, bindFormat));
                var latencyMilliseconds = isHiFiTarget
                    ? LatencyTuning.HiFiOutputLatencyMilliseconds
                    : LatencyTuning.OutputLatencyMilliseconds;

                var render = new WasapiRenderBroadcast();
                render.Configure(
                    attemptDevice,
                    attempt.ShareMode,
                    useEventSync: attempt.UseEventSync,
                    latencyMilliseconds,
                    waveProvider,
                    attempt.AllowAutoConvert);
                outputs.Add(render);
                playAction = render.Play;
                stopAction = render.Stop;

                boundDevice = attemptDevice;
                attemptDevice = null;
                BindingDescription = isHiFiTarget
                    ? $"Hi-Fi Cable {deviceName} · WASAPI · {DescribeAttemptFormat(bindFormat)}"
                    : $"WASAPI {deviceName} · {DescribeAttemptFormat(bindFormat)}";
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

        throw CreateBindException(
            deviceName,
            isHiFiTarget,
            qualityHint,
            lastError ?? new InvalidOperationException("No bind attempts were generated."));
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

    private static WaveFormat ResolveBindFormat(MMDevice device, WaveFormat attemptFormat, bool isHiFiTarget)
    {
        if (!isHiFiTarget)
        {
            return attemptFormat;
        }

        // Shared-mode Hi-Fi Cable is cleanest when we match MixFormat exactly (usually float32).
        try
        {
            var mixFormat = device.AudioClient.MixFormat;
            if (WaveFormatUtility.IsFloatFormat(mixFormat) &&
                mixFormat.SampleRate == attemptFormat.SampleRate &&
                mixFormat.Channels == attemptFormat.Channels)
            {
                return WaveFormat.CreateIeeeFloatWaveFormat(mixFormat.SampleRate, mixFormat.Channels);
            }
        }
        catch
        {
            // Fall through to attempt format.
        }

        if (WaveFormatUtility.IsFloatFormat(attemptFormat))
        {
            return attemptFormat;
        }

        // Never feed packed PCM24 into shared AutoConvert — rewrite as float at the same rate.
        return WaveFormat.CreateIeeeFloatWaveFormat(
            attemptFormat.SampleRate,
            Math.Max(1, attemptFormat.Channels));
    }

    private static ISampleProvider CreateOutputSource(ISampleProvider source, WaveFormat outputFormat)
    {
        var staged = new OutputStageSampleProvider(
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

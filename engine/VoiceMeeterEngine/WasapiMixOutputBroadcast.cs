using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Streams the live mix to a Windows playback endpoint (Hi-Fi Cable Input, Voicemeeter input, etc.).
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
                    HifiCableEndpointVolume.EnsureAudible(attemptDevice);
                }

                // WasapiOut shared Init always enables AutoConvert and does not install a DMO
                // resampler. Feeding packed PCM24 Extensible there produces extreme digital
                // corruption on Hi-Fi Cable — keep the provider in IEEE float at the attempt rate.
                var bindFormat = isHiFiTarget
                    ? ToWasapiOutSafeFormat(attempt.Format)
                    : attempt.Format;
                var outputSource = CreateOutputSource(delegatingSource, bindFormat);
                var waveProvider = new FullBlockWaveProvider(
                    OutputWaveProviderFactory.Create(outputSource, bindFormat));
                var latencyMilliseconds = isHiFiTarget
                    ? LatencyTuning.HiFiOutputLatencyMilliseconds
                    : LatencyTuning.OutputLatencyMilliseconds;

                if (isHiFiTarget)
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
                }

                boundDevice = attemptDevice;
                attemptDevice = null; // ownership transferred to boundDevice / output
                BindingDescription = isHiFiTarget
                    ? $"Hi-Fi Cable {deviceName} · WasapiOut · {DescribeAttemptFormat(bindFormat)}"
                    : $"WASAPI {deviceName} · {DescribeAttemptFormat(attempt.Format)}";
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

    private static ISampleProvider CreateOutputSource(ISampleProvider source, WaveFormat outputFormat)
    {
        // Always stage first so capture FIFOs are not pulled directly by WASAPI / resampler.
        var staged = new OutputStageSampleProvider(
            source,
            bufferMilliseconds: LatencyTuning.OutputStageBufferMilliseconds);

        if (outputFormat.SampleRate == staged.WaveFormat.SampleRate)
        {
            return staged;
        }

        return new StudioRateOutputSampleProvider(staged, outputFormat.SampleRate);
    }

    /// <summary>
    /// WasapiOut must receive IEEE float (or a true MixFormat-compatible layout).
    /// Packed 24-bit PCM Extensible is rewritten as float at the same rate.
    /// </summary>
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

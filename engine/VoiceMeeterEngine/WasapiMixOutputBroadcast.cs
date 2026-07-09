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
    private readonly List<WasapiRenderBroadcast> outputs = [];

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
        var isHiFiTarget = HifiCableFormat.IsHifiCableDevice(deviceName);
        var qualityHint = HifiCableOutputFormat.GetSetupQualityHint(deviceName);
        var attempts = HifiCableOutputBindPlanner.GetAttempts(device, deviceName);

        Exception? lastError = null;

        foreach (var attempt in attempts)
        {
            WasapiRenderBroadcast? output = null;
            try
            {
                output = new WasapiRenderBroadcast();
                var outputSource = CreateOutputSource(delegatingSource, attempt.Format);
                var waveProvider = new FullBlockWaveProvider(
                    OutputWaveProviderFactory.Create(outputSource, attempt.Format));
                var latencyMilliseconds = isHiFiTarget
                    ? LatencyTuning.HiFiOutputLatencyMilliseconds
                    : LatencyTuning.OutputLatencyMilliseconds;
                output.Configure(
                    device,
                    attempt.ShareMode,
                    attempt.UseEventSync,
                    latencyMilliseconds,
                    waveProvider,
                    attempt.AllowAutoConvert);
                outputs.Add(output);
                BindingDescription = isHiFiTarget
                    ? $"Hi-Fi Cable {deviceName} · {attempt.ShareMode} · {DescribeAttemptFormat(attempt.Format)}"
                    : $"WASAPI {deviceName} · {DescribeAttemptFormat(attempt.Format)}";
                AudioDiagnostics.SetOutputBinding(BindingDescription, attempt.Format);
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
                output?.Dispose();
            }
        }

        throw CreateBindException(deviceName, isHiFiTarget, qualityHint, lastError ?? new InvalidOperationException("No bind attempts were generated."));
    }

    public void Play()
    {
        foreach (var output in outputs)
        {
            output.Play();
        }
    }

    public void Stop()
    {
        foreach (var output in outputs)
        {
            output.Stop();
        }
    }

    public void Dispose()
    {
        DisposeOutputs();
    }

    private static ISampleProvider CreateOutputSource(ISampleProvider source, WaveFormat outputFormat)
    {
        if (outputFormat.SampleRate == source.WaveFormat.SampleRate)
        {
            return new OutputStageSampleProvider(source, bufferMilliseconds: 120);
        }

        return new StudioRateOutputSampleProvider(source, outputFormat.SampleRate);
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
                $"set Default Format to {HifiCableFormat.HiFiEngineBitsPerSample} bit, {HifiCableFormat.HiFiEngineSampleRate} Hz (Studio Quality). " +
                "Use the same format on Hi-Fi Cable Output.",
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
        BindingDescription = string.Empty;
    }

    private static string DescribeAttemptFormat(WaveFormat format)
    {
        var encoding = WaveFormatUtility.IsFloatFormat(format) ? "float" : "pcm";
        return $"{format.SampleRate} Hz, {WaveFormatUtility.GetEffectiveBitsPerSample(format)}-bit {encoding}";
    }
}

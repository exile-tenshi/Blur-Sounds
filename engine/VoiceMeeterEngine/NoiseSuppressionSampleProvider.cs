using NAudio.Dsp;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Real-time microphone noise suppression: high-pass + adaptive soft noise gate.
/// Estimates a noise floor during quiet speech gaps and attenuates steady background noise.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider
{
    private const float HighPassHz = 85f;
    private const float NoiseLearnRate = 0.015f;
    private const float SpeechLearnRate = 0.35f;
    private const float GateOpenMarginDb = 8f;
    private const float GateCloseMarginDb = 3.5f;
    private const float MaxAttenuation = 0.06f;
    private const float Attack = 0.45f;
    private const float Release = 0.08f;
    private const float MinEnvelope = 1e-6f;

    private readonly ISampleProvider source;
    private readonly int channels;
    private readonly BiQuadFilter[] highPassFilters;
    private readonly float[] channelEnvelope;
    private float noiseFloor = 0.002f;
    private float gateGain = 1f;
    private bool enabled;

    public NoiseSuppressionSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        channels = Math.Max(1, WaveFormat.Channels);
        channelEnvelope = new float[channels];
        highPassFilters = new BiQuadFilter[channels];
        for (var channel = 0; channel < channels; channel++)
        {
            highPassFilters[channel] = BiQuadFilter.HighPassFilter(WaveFormat.SampleRate, HighPassHz, 0.707f);
            channelEnvelope[channel] = MinEnvelope;
        }
    }

    public WaveFormat WaveFormat { get; }

    public void SetEnabled(bool nextEnabled)
    {
        enabled = nextEnabled;
        if (!enabled)
        {
            gateGain = 1f;
        }
    }

    public bool IsEnabled => enabled;

    public int Read(float[] buffer, int offset, int count)
    {
        var samplesRead = source.Read(buffer, offset, count);
        if (samplesRead <= 0 || !enabled)
        {
            return samplesRead;
        }

        for (var index = 0; index < samplesRead; index++)
        {
            var channel = index % channels;
            var sample = highPassFilters[channel].Transform(buffer[offset + index]);
            var abs = Math.Abs(sample);
            var previous = channelEnvelope[channel];
            var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
            var envelope = previous + (abs - previous) * learn;
            channelEnvelope[channel] = Math.Max(MinEnvelope, envelope);

            if (channel == 0)
            {
                UpdateGate(envelope);
            }

            buffer[offset + index] = sample * gateGain;
        }

        return samplesRead;
    }

    private void UpdateGate(float envelope)
    {
        var noiseDb = ToDb(noiseFloor);
        var envelopeDb = ToDb(envelope);

        if (envelopeDb < noiseDb + GateCloseMarginDb)
        {
            noiseFloor += (envelope - noiseFloor) * NoiseLearnRate;
            noiseFloor = Math.Clamp(noiseFloor, MinEnvelope, 0.05f);
        }

        var openThreshold = noiseDb + GateOpenMarginDb;
        var closeThreshold = noiseDb + GateCloseMarginDb;
        float targetGain;

        if (envelopeDb >= openThreshold)
        {
            targetGain = 1f;
        }
        else if (envelopeDb <= closeThreshold)
        {
            targetGain = MaxAttenuation;
        }
        else
        {
            var t = (envelopeDb - closeThreshold) / (openThreshold - closeThreshold);
            targetGain = MaxAttenuation + (1f - MaxAttenuation) * Smoothstep(t);
        }

        var rate = targetGain > gateGain ? Attack : Release;
        gateGain += (targetGain - gateGain) * rate;
    }

    private static float ToDb(float linear)
    {
        return 20f * MathF.Log10(Math.Max(linear, MinEnvelope));
    }

    private static float Smoothstep(float t)
    {
        t = Math.Clamp(t, 0f, 1f);
        return t * t * (3f - 2f * t);
    }
}

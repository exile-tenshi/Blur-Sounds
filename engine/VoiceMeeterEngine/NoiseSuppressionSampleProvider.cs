using NAudio.Dsp;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Real-time microphone noise suppression with editable strength / threshold / high-pass / timing.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider
{
    private const float NoiseLearnRate = 0.015f;
    private const float SpeechLearnRate = 0.35f;
    private const float MinEnvelope = 1e-6f;

    private readonly ISampleProvider source;
    private readonly int channels;
    private readonly BiQuadFilter[] highPassFilters;
    private readonly float[] channelEnvelope;
    private float noiseFloor = 0.002f;
    private float gateGain = 1f;
    private bool enabled;
    private float highPassHz = 85f;
    private float strength = 70f;
    private float threshold = 55f;
    private float attack = 55f;
    private float release = 40f;

    public NoiseSuppressionSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        channels = Math.Max(1, WaveFormat.Channels);
        channelEnvelope = new float[channels];
        highPassFilters = new BiQuadFilter[channels];
        RebuildHighPass();
        for (var channel = 0; channel < channels; channel++)
        {
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

    public void SetSettings(bool nextEnabled, float nextStrength, float nextThreshold, float nextHighPassHz, float nextAttack, float nextRelease)
    {
        enabled = nextEnabled;
        strength = Math.Clamp(nextStrength, 0f, 100f);
        threshold = Math.Clamp(nextThreshold, 0f, 100f);
        attack = Math.Clamp(nextAttack, 0f, 100f);
        release = Math.Clamp(nextRelease, 0f, 100f);
        var clampedHighPass = Math.Clamp(nextHighPassHz, 40f, 220f);
        if (Math.Abs(clampedHighPass - highPassHz) >= 0.5f)
        {
            highPassHz = clampedHighPass;
            RebuildHighPass();
        }

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

    private void RebuildHighPass()
    {
        for (var channel = 0; channel < channels; channel++)
        {
            highPassFilters[channel] = BiQuadFilter.HighPassFilter(WaveFormat.SampleRate, highPassHz, 0.707f);
        }
    }

    private void UpdateGate(float envelope)
    {
        // Higher strength → deeper attenuation when gated.
        var maxAttenuation = Math.Clamp(0.35f - strength * 0.0032f, 0.02f, 0.35f);
        // Higher threshold → easier to open (more voice kept).
        var openMarginDb = Math.Clamp(14f - threshold * 0.1f, 3f, 14f);
        var closeMarginDb = Math.Max(1.5f, openMarginDb * 0.45f);
        var attackRate = Math.Clamp(0.15f + attack * 0.007f, 0.12f, 0.9f);
        var releaseRate = Math.Clamp(0.03f + release * 0.0025f, 0.02f, 0.35f);

        var noiseDb = ToDb(noiseFloor);
        var envelopeDb = ToDb(envelope);

        if (envelopeDb < noiseDb + closeMarginDb)
        {
            noiseFloor += (envelope - noiseFloor) * NoiseLearnRate;
            noiseFloor = Math.Clamp(noiseFloor, MinEnvelope, 0.05f);
        }

        var openThreshold = noiseDb + openMarginDb;
        var closeThreshold = noiseDb + closeMarginDb;
        float targetGain;

        if (envelopeDb >= openThreshold)
        {
            targetGain = 1f;
        }
        else if (envelopeDb <= closeThreshold)
        {
            targetGain = maxAttenuation;
        }
        else
        {
            var t = (envelopeDb - closeThreshold) / (openThreshold - closeThreshold);
            targetGain = maxAttenuation + (1f - maxAttenuation) * Smoothstep(t);
        }

        var rate = targetGain > gateGain ? attackRate : releaseRate;
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

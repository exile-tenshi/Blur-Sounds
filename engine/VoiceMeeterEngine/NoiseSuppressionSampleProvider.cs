using NAudio.Dsp;
using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise. Uses the Denoiser's own frame buffer
/// (finish:false) so samples are never dropped. Strength is a gentle dry/wet mix.
/// Completely bypasses processing when both NS and the optional gate are off.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider, IDisposable
{
    private const float MinEnvelope = 1e-6f;
    private const float NoiseLearnRate = 0.02f;
    private const float SpeechLearnRate = 0.4f;

    private readonly ISampleProvider source;
    private readonly int channels;
    private readonly object gate = new();
    private Denoiser? denoiser;
    private bool denoiserFailed;
    private float[]? monoScratch;
    private float[]? dryScratch;
    private BiQuadFilter? highPass;
    private float highPassHz = 80f;
    private float channelEnvelope = MinEnvelope;
    private float gateGain = 1f;
    private bool enabled;
    private bool noiseGateEnabled;
    private float strength = 70f;
    private float noiseGateThreshold = 35f;
    private float attack = 55f;
    private float release = 40f;

    public NoiseSuppressionSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        channels = Math.Max(1, WaveFormat.Channels);
        RebuildHighPass();
    }

    public WaveFormat WaveFormat { get; }

    public void SetEnabled(bool nextEnabled)
    {
        lock (gate)
        {
            enabled = nextEnabled;
            if (!IsProcessingActive)
            {
                ResetIdleState();
            }
            else
            {
                EnsureDenoiser();
            }
        }
    }

    public void SetSettings(
        bool nextEnabled,
        float nextStrength,
        float nextThreshold,
        float nextHighPassHz,
        float nextAttack,
        float nextRelease,
        bool nextNoiseGateEnabled = false,
        float nextNoiseGateThreshold = 35f)
    {
        lock (gate)
        {
            _ = nextThreshold;

            enabled = nextEnabled;
            noiseGateEnabled = nextNoiseGateEnabled;
            strength = Math.Clamp(nextStrength, 0f, 100f);
            attack = Math.Clamp(nextAttack, 0f, 100f);
            release = Math.Clamp(nextRelease, 0f, 100f);
            noiseGateThreshold = Math.Clamp(nextNoiseGateThreshold, 0f, 100f);

            var clampedHighPass = Math.Clamp(nextHighPassHz, 40f, 220f);
            if (Math.Abs(clampedHighPass - highPassHz) >= 0.5f)
            {
                highPassHz = clampedHighPass;
                RebuildHighPass();
            }

            if (!IsProcessingActive)
            {
                ResetIdleState();
            }
            else
            {
                EnsureDenoiser();
            }
        }
    }

    public bool IsEnabled => enabled;

    private bool IsProcessingActive => enabled || noiseGateEnabled;

    public int Read(float[] buffer, int offset, int count)
    {
        var samplesRead = source.Read(buffer, offset, count);
        if (samplesRead <= 0)
        {
            return samplesRead;
        }

        lock (gate)
        {
            // Hard bypass when everything is off — zero latency / zero artifacts.
            if (!IsProcessingActive || channels <= 0)
            {
                return samplesRead;
            }

            var frames = samplesRead / channels;
            EnsureScratch(frames);

            for (var frame = 0; frame < frames; frame++)
            {
                var frameOffset = offset + (frame * channels);
                var mono = AverageFrame(buffer, frameOffset);
                if (enabled && highPass is not null)
                {
                    mono = highPass.Transform(mono);
                }

                dryScratch![frame] = mono;
                monoScratch![frame] = mono;
            }

            if (enabled && EnsureDenoiser())
            {
                try
                {
                    // Let RNNoise.NET buffer internally — never finish:true mid-stream.
                    denoiser!.Denoise(monoScratch.AsSpan(0, frames), finish: false);
                }
                catch
                {
                    denoiserFailed = true;
                    try
                    {
                        denoiser?.Dispose();
                    }
                    catch
                    {
                        // Ignore dispose after native failure.
                    }

                    denoiser = null;
                    Array.Copy(dryScratch!, monoScratch!, frames);
                }
            }

            // Soft dry/wet curve — full 100 maps to ~0.82 wet so voice stays natural.
            var wet = enabled ? MathF.Pow(strength / 100f, 1.15f) * 0.82f : 0f;
            var dryMix = 1f - wet;

            for (var frame = 0; frame < frames; frame++)
            {
                var clean = (dryScratch![frame] * dryMix) + (monoScratch![frame] * wet);

                if (noiseGateEnabled)
                {
                    UpdateGate(Math.Abs(clean));
                    clean *= gateGain;
                }
                else
                {
                    gateGain = 1f;
                }

                var frameOffset = offset + (frame * channels);
                for (var channel = 0; channel < channels; channel++)
                {
                    buffer[frameOffset + channel] = clean;
                }
            }
        }

        return samplesRead;
    }

    public void Dispose()
    {
        lock (gate)
        {
            denoiser?.Dispose();
            denoiser = null;
        }
    }

    private void EnsureScratch(int frames)
    {
        if (monoScratch is null || monoScratch.Length < frames)
        {
            monoScratch = new float[frames];
            dryScratch = new float[frames];
        }
    }

    private bool EnsureDenoiser()
    {
        if (denoiser is not null)
        {
            return true;
        }

        if (denoiserFailed)
        {
            return false;
        }

        try
        {
            denoiser = new Denoiser();
            return true;
        }
        catch
        {
            denoiserFailed = true;
            denoiser = null;
            return false;
        }
    }

    private void UpdateGate(float abs)
    {
        var previous = channelEnvelope;
        var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
        channelEnvelope = Math.Max(MinEnvelope, previous + (abs - previous) * learn);

        var thresholdLinear = MathF.Pow(10f, (-48f + (noiseGateThreshold * 0.3f)) / 20f);
        var target = channelEnvelope >= thresholdLinear ? 1f : 0f;
        var attackCoeff = 0.08f + ((100f - attack) * 0.004f);
        var releaseCoeff = 0.02f + ((100f - release) * 0.0015f);
        var coeff = target > gateGain ? attackCoeff : releaseCoeff;
        gateGain += (target - gateGain) * coeff;
        if (gateGain < 0.0001f)
        {
            gateGain = 0f;
        }
        else if (gateGain > 0.999f)
        {
            gateGain = 1f;
        }
    }

    private float AverageFrame(float[] buffer, int frameOffset)
    {
        if (channels == 1)
        {
            return buffer[frameOffset];
        }

        var sum = 0f;
        for (var channel = 0; channel < channels; channel++)
        {
            sum += buffer[frameOffset + channel];
        }

        return sum / channels;
    }

    private void RebuildHighPass()
    {
        highPass = BiQuadFilter.HighPassFilter(WaveFormat.SampleRate, highPassHz, 0.707f);
    }

    private void ResetIdleState()
    {
        gateGain = 1f;
        channelEnvelope = MinEnvelope;
        // Recreate denoiser next enable so its internal pad state cannot bleed into dry audio.
        try
        {
            denoiser?.Dispose();
        }
        catch
        {
            // Ignore.
        }

        denoiser = null;
        RebuildHighPass();
    }
}

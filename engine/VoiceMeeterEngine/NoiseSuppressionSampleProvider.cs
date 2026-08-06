using System.Collections.Generic;
using NAudio.Dsp;
using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise. Fixed ~10 ms frame delay, 1:1 samples.
/// High-pass + wet mix + gentle residual floor; soft-limited so taps don't explode.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider, IDisposable
{
    private const float MinEnvelope = 1e-6f;
    private const float NoiseLearnRate = 0.03f;
    private const float SpeechLearnRate = 0.35f;
    /// <summary>Light makeup only — high makeup made mic taps blast.</summary>
    private const float RnnoiseMakeup = 1.12f;
    /// <summary>Residual room floor when quiet (not near-mute — that pumped on taps).</summary>
    private const float ResidualFloorMin = 0.14f;
    private const float SoftLimitCeiling = 0.82f;

    private readonly ISampleProvider source;
    private readonly int channels;
    private readonly object gate = new();
    private readonly float[] dryFrame = new float[Native.FRAME_SIZE];
    private readonly float[] processFrame = new float[Native.FRAME_SIZE];
    private readonly Queue<float> inputQueue = new(Native.FRAME_SIZE * 2);
    private readonly Queue<float> outputQueue = new(Native.FRAME_SIZE * 2);
    private Denoiser? denoiser;
    private bool denoiserFailed;
    private BiQuadFilter? highPass;
    private float highPassHz = 80f;
    private float channelEnvelope = MinEnvelope;
    private float gateGain = 1f;
    private float residualGain = 1f;
    private float limiterEnvelope = MinEnvelope;
    private bool enabled;
    private bool noiseGateEnabled;
    private float strength = 88f;
    private float noiseGateThreshold = 40f;
    private float attack = 55f;
    private float release = 40f;
    private bool compressorEnabled;
    private float compressorLevel = 30f;
    private float compressorEnvelope = MinEnvelope;

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
            if (!nextEnabled)
            {
                noiseGateEnabled = false;
                compressorEnabled = false;
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

    public void SetSettings(
        bool nextEnabled,
        float nextStrength,
        float nextThreshold,
        float nextHighPassHz,
        float nextAttack,
        float nextRelease,
        bool nextNoiseGateEnabled = false,
        float nextNoiseGateThreshold = 35f,
        bool nextCompressorEnabled = false,
        float nextCompressorLevel = 30f)
    {
        lock (gate)
        {
            _ = nextThreshold;

            enabled = nextEnabled;
            noiseGateEnabled = nextNoiseGateEnabled;
            compressorEnabled = nextEnabled && nextCompressorEnabled;
            strength = Math.Clamp(nextStrength, 0f, 100f);
            attack = Math.Clamp(nextAttack, 0f, 100f);
            release = Math.Clamp(nextRelease, 0f, 100f);
            noiseGateThreshold = Math.Clamp(nextNoiseGateThreshold, 0f, 100f);
            compressorLevel = Math.Clamp(nextCompressorLevel, 0f, 100f);

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
            if (!IsProcessingActive || channels <= 0)
            {
                return samplesRead;
            }

            var frames = samplesRead / channels;
            for (var frame = 0; frame < frames; frame++)
            {
                var frameOffset = offset + (frame * channels);
                var dry = AverageFrame(buffer, frameOffset);
                if (enabled && highPass is not null)
                {
                    dry = highPass.Transform(dry);
                }

                // Tame pathological input spikes before RNNoise (mic taps / bumps).
                dry = SoftClip(dry, 0.95f);

                var clean = ProcessMonoSample(dry);

                if (enabled)
                {
                    UpdateResidual(Math.Abs(clean));
                    clean *= residualGain;
                }
                else
                {
                    residualGain = 1f;
                }

                if (noiseGateEnabled)
                {
                    UpdateGate(Math.Abs(clean));
                    clean *= gateGain;
                }
                else
                {
                    gateGain = 1f;
                }

                if (compressorEnabled)
                {
                    clean = ApplyCompressor(clean);
                }

                clean = SoftLimit(clean);

                if (!float.IsFinite(clean))
                {
                    clean = 0f;
                }

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

    private float ProcessMonoSample(float sample)
    {
        inputQueue.Enqueue(sample);

        while (inputQueue.Count >= Native.FRAME_SIZE)
        {
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                dryFrame[index] = inputQueue.Dequeue();
            }

            ProcessFullFrame();
        }

        if (outputQueue.Count > 0)
        {
            return outputQueue.Dequeue();
        }

        return 0f;
    }

    private void ProcessFullFrame()
    {
        var wet = enabled ? StrengthToWet(strength) : 0f;
        if (!enabled || wet <= 0.001f || !EnsureDenoiser())
        {
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                outputQueue.Enqueue(dryFrame[index]);
            }

            return;
        }

        Array.Copy(dryFrame, processFrame, Native.FRAME_SIZE);
        try
        {
            denoiser!.Denoise(processFrame.AsSpan(), finish: false);

            var dryMix = 1f - wet;
            var makeup = 1f + ((RnnoiseMakeup - 1f) * wet);
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                var mixed = (dryFrame[index] * dryMix) + (processFrame[index] * wet);
                if (float.IsNaN(mixed) || float.IsInfinity(mixed))
                {
                    mixed = dryFrame[index];
                }

                outputQueue.Enqueue(SoftClip(mixed * makeup, SoftLimitCeiling));
            }
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
                // Ignore dispose failures after native issues.
            }

            denoiser = null;
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                outputQueue.Enqueue(dryFrame[index]);
            }
        }
    }

    /// <summary>
    /// UI 0–100 → wet. Strong but not instantaneous full-wet (avoids brittle voice).
    /// 50→0.84, 70→0.92, 85→0.96, 100→1.0
    /// </summary>
    private static float StrengthToWet(float strengthPercent)
    {
        var normalized = Math.Clamp(strengthPercent / 100f, 0f, 1f);
        return MathF.Pow(normalized, 0.32f);
    }

    /// <summary>
    /// Gentle residual floor — slow open/close so taps don't pump the gain.
    /// </summary>
    private void UpdateResidual(float abs)
    {
        var previous = channelEnvelope;
        var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
        channelEnvelope = Math.Max(MinEnvelope, previous + ((abs - previous) * learn));

        var wet = StrengthToWet(strength);
        var speechOpen = 0.048f - (wet * 0.012f);
        var noiseFloor = ResidualFloorMin + ((1f - wet) * 0.22f);
        var target = channelEnvelope >= speechOpen ? 1f : noiseFloor;
        // Slow open prevents tap/plosive gain snaps; moderate close keeps words intact.
        var coeff = target > residualGain ? 0.12f : 0.045f + ((1f - wet) * 0.04f);
        residualGain += (target - residualGain) * coeff;
        residualGain = Math.Clamp(residualGain, ResidualFloorMin, 1f);
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

    private float ApplyCompressor(float sample)
    {
        var abs = Math.Abs(sample);
        var learn = abs > compressorEnvelope ? 0.28f : 0.04f;
        compressorEnvelope = Math.Max(MinEnvelope, compressorEnvelope + ((abs - compressorEnvelope) * learn));

        var amount = compressorLevel / 100f;
        if (amount <= 0.001f)
        {
            return sample;
        }

        var threshold = 0.24f - (amount * 0.06f);
        if (compressorEnvelope <= threshold)
        {
            return sample;
        }

        var over = compressorEnvelope / threshold;
        var ratio = 1f + (amount * 1.6f);
        var gain = MathF.Pow(1f / over, 1f - (1f / ratio));
        gain = Math.Clamp(gain, 0.45f, 1f);
        // No extra makeup boost on compressor — that amplified taps.
        return sample * gain;
    }

    private void UpdateGate(float abs)
    {
        var previous = channelEnvelope;
        var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
        channelEnvelope = Math.Max(MinEnvelope, previous + ((abs - previous) * learn));

        var thresholdLinear = MathF.Pow(10f, (-50f + (noiseGateThreshold * 0.28f)) / 20f);
        var target = channelEnvelope >= thresholdLinear ? 1f : 0.12f;
        var attackCoeff = 0.08f + ((100f - attack) * 0.0035f);
        var releaseCoeff = 0.018f + ((100f - release) * 0.0012f);
        var coeff = target > gateGain ? attackCoeff : releaseCoeff;
        gateGain += (target - gateGain) * coeff;
        gateGain = Math.Clamp(gateGain, 0.12f, 1f);
    }

    /// <summary>Fast peak limiter so mic taps / bumps stay listenable.</summary>
    private float SoftLimit(float sample)
    {
        var abs = Math.Abs(sample);
        var learn = abs > limiterEnvelope ? 0.55f : 0.08f;
        limiterEnvelope = Math.Max(MinEnvelope, limiterEnvelope + ((abs - limiterEnvelope) * learn));

        if (limiterEnvelope <= SoftLimitCeiling)
        {
            return SoftClip(sample, SoftLimitCeiling);
        }

        var gain = SoftLimitCeiling / limiterEnvelope;
        return SoftClip(sample * gain, SoftLimitCeiling);
    }

    private static float SoftClip(float sample, float ceiling)
    {
        if (!float.IsFinite(sample))
        {
            return 0f;
        }

        var scaled = sample / Math.Max(0.05f, ceiling);
        // Gentle tanh knee — avoids hard digital clipping on taps.
        return ceiling * MathF.Tanh(scaled);
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
        residualGain = 1f;
        channelEnvelope = MinEnvelope;
        compressorEnvelope = MinEnvelope;
        limiterEnvelope = MinEnvelope;
        inputQueue.Clear();
        outputQueue.Clear();
        Array.Clear(dryFrame);
        Array.Clear(processFrame);
        RebuildHighPass();
        try
        {
            denoiser?.Dispose();
        }
        catch
        {
            // Ignore.
        }

        denoiser = null;
    }
}

using System.Collections.Generic;
using NAudio.Dsp;
using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise. Fixed ~10 ms frame delay, 1:1 samples.
/// High-pass + wet mix + hysteresis residual floor; peak-limit only on overs
/// so extended speech stays clean (no tanh grit / residual flutter static).
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider, IDisposable
{
    private const float MinEnvelope = 1e-6f;
    private const float NoiseLearnRate = 0.02f;
    private const float SpeechLearnRate = 0.28f;
    /// <summary>Light makeup only — high makeup made mic taps blast.</summary>
    private const float RnnoiseMakeup = 1.08f;
    /// <summary>Residual room floor when quiet (not near-mute — that pumped on taps).</summary>
    private const float ResidualFloorMin = 0.18f;
    /// <summary>Only clamp true overs — continuous SoftClip on voice caused static grit.</summary>
    private const float SoftLimitCeiling = 0.92f;
    private const float SoftLimitKnee = 0.86f;

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
    private bool residualSpeechOpen;
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

                // Pass voice linearly — SoftLimit after residual handles true overs only.
                outputQueue.Enqueue(mixed * makeup);
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
    /// UI 0–100 → wet. Strong cleanup without living at full-wet (RNNoise grit).
    /// 50→0.78, 70→0.88, 85→0.94, 100→1.0
    /// </summary>
    private static float StrengthToWet(float strengthPercent)
    {
        var normalized = Math.Clamp(strengthPercent / 100f, 0f, 1f);
        return MathF.Pow(normalized, 0.42f);
    }

    /// <summary>
    /// Residual floor with speech hysteresis — stays open through quiet consonants
    /// so extended talk doesn't flutter into static.
    /// </summary>
    private void UpdateResidual(float abs)
    {
        var previous = channelEnvelope;
        var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
        channelEnvelope = Math.Max(MinEnvelope, previous + ((abs - previous) * learn));

        var wet = StrengthToWet(strength);
        // Open easily on speech; close only after a deeper quiet gap (hysteresis).
        var openThreshold = 0.028f - (wet * 0.006f);
        var closeThreshold = 0.012f - (wet * 0.003f);
        if (!residualSpeechOpen && channelEnvelope >= openThreshold)
        {
            residualSpeechOpen = true;
        }
        else if (residualSpeechOpen && channelEnvelope < closeThreshold)
        {
            residualSpeechOpen = false;
        }

        var noiseFloor = ResidualFloorMin + ((1f - wet) * 0.18f);
        var target = residualSpeechOpen ? 1f : noiseFloor;
        // Fast-ish open, very slow close — continuous speech stays at unity gain.
        var coeff = target > residualGain
            ? 0.10f
            : 0.008f + ((1f - wet) * 0.006f);
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
        // Gentler envelope — grabby compressor caused pumping static on long talk.
        var learn = abs > compressorEnvelope ? 0.16f : 0.03f;
        compressorEnvelope = Math.Max(MinEnvelope, compressorEnvelope + ((abs - compressorEnvelope) * learn));

        var amount = compressorLevel / 100f;
        if (amount <= 0.001f)
        {
            return sample;
        }

        var threshold = 0.32f - (amount * 0.05f);
        if (compressorEnvelope <= threshold)
        {
            return sample;
        }

        var over = compressorEnvelope / threshold;
        var ratio = 1f + (amount * 1.1f);
        var gain = MathF.Pow(1f / over, 1f - (1f / ratio));
        gain = Math.Clamp(gain, 0.55f, 1f);
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

    /// <summary>
    /// Peak limiter for taps/bumps only — normal speech passes linearly
    /// (always-on SoftClip was the main source of extended-talk static).
    /// </summary>
    private float SoftLimit(float sample)
    {
        if (!float.IsFinite(sample))
        {
            return 0f;
        }

        var abs = Math.Abs(sample);
        var learn = abs > limiterEnvelope ? 0.35f : 0.04f;
        limiterEnvelope = Math.Max(MinEnvelope, limiterEnvelope + ((abs - limiterEnvelope) * learn));

        if (abs <= SoftLimitKnee)
        {
            return sample;
        }

        if (limiterEnvelope <= SoftLimitCeiling)
        {
            // Soft knee only near the ceiling — leave mid-level voice untouched.
            var t = Math.Clamp((abs - SoftLimitKnee) / (SoftLimitCeiling - SoftLimitKnee), 0f, 1f);
            var limited = SoftLimitCeiling * MathF.Tanh(abs / SoftLimitCeiling);
            var shaped = abs + ((limited - abs) * (t * t));
            return MathF.CopySign(shaped, sample);
        }

        var gain = SoftLimitCeiling / limiterEnvelope;
        return sample * gain;
    }

    private static float SoftClip(float sample, float ceiling)
    {
        if (!float.IsFinite(sample))
        {
            return 0f;
        }

        var abs = Math.Abs(sample);
        // Linear for normal levels — only bend true spikes (pre-RNNoise taps).
        if (abs <= ceiling)
        {
            return sample;
        }

        var scaled = sample / Math.Max(0.05f, ceiling);
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
        residualSpeechOpen = false;
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

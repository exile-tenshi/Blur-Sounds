using System.Collections.Generic;
using NAudio.Dsp;
using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise. Fixed ~10 ms frame delay, 1:1 samples.
/// High-pass + wet mix + hysteresis residual floor; peak-limit only on overs.
/// Impulsive desk taps stay 100% dry (RNNoise never sees them) so no wet
/// “vrooom” overlay sits on top of the real tap. Impact still removes them.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider, IDisposable
{
    private const float MinEnvelope = 1e-6f;
    private const float NoiseLearnRate = 0.02f;
    /// <summary>Slower than peak so desk taps don't charge the “speech open” path.</summary>
    private const float SpeechLearnRate = 0.10f;
    private const float PeakAttackRate = 0.55f;
    private const float PeakReleaseRate = 0.055f;
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
    private float peakEnvelope = MinEnvelope;
    private float impulseAmount;
    private float gateGain = 1f;
    private float residualGain = 1f;
    private bool residualSpeechOpen;
    private float limiterEnvelope = MinEnvelope;
    private bool enabled;
    private bool noiseGateEnabled;
    private float strength = 88f;
    private float background = 55f;
    private float impact = 40f;
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
        float nextImpact,
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
            enabled = nextEnabled;
            noiseGateEnabled = nextNoiseGateEnabled;
            compressorEnabled = nextCompressorEnabled;
            strength = Math.Clamp(nextStrength, 0f, 100f);
            background = Math.Clamp(nextThreshold, 0f, 100f);
            impact = Math.Clamp(nextImpact, 0f, 100f);
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

    private bool IsProcessingActive => enabled || noiseGateEnabled || compressorEnabled;

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
                UpdateImpulseDetector(Math.Abs(dry));

                // High-pass rings on desk taps (“vroom”). Keep filter state updated but
                // use the unfiltered sample while an impulse is active.
                if (enabled && highPass is not null)
                {
                    var filtered = highPass.Transform(dry);
                    if (impulseAmount < 0.22f)
                    {
                        dry = filtered;
                    }
                }

                // Only soft-clip true overs — never auto-duck taps (Impact slider owns that).
                dry = SoftClip(dry, 0.95f);

                var clean = ProcessMonoSample(dry);

                if (enabled)
                {
                    UpdateResidual(Math.Abs(clean));
                    clean *= ResolveResidualGainForSample();
                }
                else
                {
                    residualGain = 1f;
                }

                if (noiseGateEnabled && impulseAmount < 0.22f)
                {
                    UpdateGate(Math.Abs(clean));
                    clean *= gateGain;
                }
                else if (!noiseGateEnabled)
                {
                    gateGain = 1f;
                }

                // Compressor on taps adds a whooshy pump — skip while impulse is held.
                if (compressorEnabled && impulseAmount < 0.22f)
                {
                    clean = ApplyCompressor(clean);
                }

                if (impulseAmount < 0.22f)
                {
                    clean = SoftLimit(clean);
                }

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

        // If this frame is a desk tap / bump, never run RNNoise on it — even a little wet
        // mixes as a spaceship “vrooom” overlay on top of the real tap.
        var frameImpulse = MeasureFrameImpulse(dryFrame);
        var blendImpulse = Math.Max(impulseAmount, frameImpulse);
        if (blendImpulse > 0.18f)
        {
            // Hold the dry window through the tap’s resonant decay.
            impulseAmount = Math.Max(impulseAmount, blendImpulse);
            var impactGain = 1f - (blendImpulse * (impact / 100f) * 0.97f);
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                outputQueue.Enqueue(dryFrame[index] * impactGain);
            }

            return;
        }

        try
        {
            denoiser!.Denoise(processFrame.AsSpan(), finish: false);

            var dryMix = 1f - wet;
            var makeup = 1f + ((RnnoiseMakeup - 1f) * wet);
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                var mixed = ((dryFrame[index] * dryMix) + (processFrame[index] * wet)) * makeup;
                if (float.IsNaN(mixed) || float.IsInfinity(mixed))
                {
                    mixed = dryFrame[index];
                }

                outputQueue.Enqueue(mixed);
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
    /// Dual envelope: slow “voice” vs fast peak. Desk taps spike peak ≫ voice → impulse.
    /// </summary>
    private void UpdateImpulseDetector(float abs)
    {
        var peakLearn = abs > peakEnvelope ? PeakAttackRate : PeakReleaseRate;
        peakEnvelope = Math.Max(MinEnvelope, peakEnvelope + ((abs - peakEnvelope) * peakLearn));

        var voiceLearn = abs > channelEnvelope ? SpeechLearnRate : NoiseLearnRate;
        channelEnvelope = Math.Max(MinEnvelope, channelEnvelope + ((abs - channelEnvelope) * voiceLearn));

        // Speech rises together; taps jump far above the voice follower.
        var excess = peakEnvelope - (channelEnvelope * 2.8f);
        var targetImpulse = Math.Clamp(excess / 0.16f, 0f, 1f);
        // Fast open, slow release — hold dry through the tap’s decay so no wet overlay sneaks in.
        var coeff = targetImpulse > impulseAmount ? 0.65f : 0.012f;
        impulseAmount += (targetImpulse - impulseAmount) * coeff;
        impulseAmount = Math.Clamp(impulseAmount, 0f, 1f);
    }

    private static float MeasureFrameImpulse(float[] frame)
    {
        var peak = 0f;
        var sumSq = 0f;
        for (var index = 0; index < frame.Length; index++)
        {
            var abs = Math.Abs(frame[index]);
            if (abs > peak)
            {
                peak = abs;
            }

            sumSq += abs * abs;
        }

        var rms = MathF.Sqrt(sumSq / Math.Max(1, frame.Length));
        if (peak < 0.03f || rms < MinEnvelope)
        {
            return 0f;
        }

        var crest = peak / Math.Max(rms, MinEnvelope);
        // Speech crest is moderate; desk taps / bumps are much peakier.
        return Math.Clamp((crest - 6.0f) / 12f, 0f, 1f);
    }

    /// <summary>
    /// Residual floor with speech hysteresis — stays open through quiet consonants
    /// so extended talk doesn't flutter into static. Impulses do not open the path.
    /// </summary>
    private void UpdateResidual(float abs)
    {
        _ = abs;
        var wet = StrengthToWet(strength);
        var backgroundAmount = background / 100f;
        // Open on sustained voice envelope only — taps already charged peakEnvelope,
        // but channelEnvelope (slow) must rise for residual to open.
        var openThreshold = 0.030f - (wet * 0.006f);
        var closeThreshold = 0.012f - (wet * 0.003f);
        if (!residualSpeechOpen && channelEnvelope >= openThreshold && impulseAmount < 0.35f)
        {
            residualSpeechOpen = true;
        }
        else if (residualSpeechOpen && channelEnvelope < closeThreshold)
        {
            residualSpeechOpen = false;
        }

        // Background deepens the quiet-floor cut (more Background → quieter residual).
        var noiseFloor = (ResidualFloorMin + ((1f - wet) * 0.18f)) * (1f - (backgroundAmount * 0.55f));
        noiseFloor = Math.Clamp(noiseFloor, 0.06f, 1f);
        var target = residualSpeechOpen ? 1f : noiseFloor;

        var openCoeff = 0.08f;
        var closeCoeff = 0.008f + ((1f - wet) * 0.006f);
        var coeff = target > residualGain ? openCoeff : closeCoeff;
        residualGain += (target - residualGain) * coeff;
        residualGain = Math.Clamp(residualGain, 0.06f, 1f);
    }

    /// <summary>
    /// Speech uses residual floor as usual. Impulses: Impact 0 keeps natural level;
    /// Impact 100 applies residual cut + extra suppress so taps/keyboard disappear.
    /// </summary>
    private float ResolveResidualGainForSample()
    {
        if (impulseAmount < 0.12f)
        {
            return residualGain;
        }

        var impactAmount = impact / 100f;
        // Lerp natural (1) → residual floor, then extra cut from Impact × impulse strength.
        var blended = 1f + ((residualGain - 1f) * impactAmount);
        blended *= 1f - (impulseAmount * impactAmount * 0.9f);
        return Math.Clamp(blended, 0.02f, 1f);
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
        peakEnvelope = MinEnvelope;
        impulseAmount = 0f;
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

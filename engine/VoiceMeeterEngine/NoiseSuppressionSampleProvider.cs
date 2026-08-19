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
    /// <summary>Voice envelope — fast enough that talk isn't treated as a desk tap.</summary>
    private const float SpeechLearnRate = 0.22f;
    private const float PeakAttackRate = 0.55f;
    private const float PeakReleaseRate = 0.08f;
    /// <summary>Light makeup only — high makeup made mic taps blast.</summary>
    private const float RnnoiseMakeup = 1.08f;
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
    private readonly Queue<float> dryOutQueue = new(Native.FRAME_SIZE * 2);
    private Denoiser? denoiser;
    private bool denoiserFailed;
    private BiQuadFilter? highPass;
    private float highPassHz = 80f;
    private float channelEnvelope = MinEnvelope;
    private float peakEnvelope = MinEnvelope;
    private float impulseAmount;
    private float gateGain = 1f;
    private bool residualSpeechOpen;
    private int quietHoldSamples;
    private bool idlePath;
    private float pathGain = 1f;
    private float noiseFloor = 0.004f;
    private float limiterEnvelope = MinEnvelope;
    private bool enabled;
    private bool noiseGateEnabled;
    private float strength = 88f;
    private float background = 55f;
    private float impact = 0f;
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
            var wasActive = IsProcessingActive;
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

            var nowActive = IsProcessingActive;
            if (wasActive && !nowActive)
            {
                ResetIdleState();
            }
            else if (nowActive)
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

                // Always high-pass when NS is on — skipping it left chest/rumble in and
                // locked the impulse detector on speech.
                if (enabled && highPass is not null)
                {
                    dry = highPass.Transform(dry);
                }

                UpdateImpulseDetector(Math.Abs(dry));
                UpdateNoiseFloor(Math.Abs(dry));

                // Only soft-clip true overs — never auto-duck taps (Impact slider owns that).
                dry = SoftClip(dry, 0.95f);

                if (enabled)
                {
                    UpdateResidual();
                }
                else
                {
                    residualSpeechOpen = true;
                    quietHoldSamples = 0;
                    idlePath = false;
                    pathGain = 1f;
                }

                var clean = ProcessMonoSample(dry);

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
            var mixed = outputQueue.Dequeue();
            var dryOut = dryOutQueue.Count > 0 ? dryOutQueue.Dequeue() : mixed;
            if (!enabled)
            {
                return mixed;
            }

            // Never sum dry + RNNoise — that comb-filters into “complete ass”
            // after a few Background moves. Talking and idle both stay on mixed
            // (RNNoise). Idle dry was letting PC fans back in as fuzz.
            return SelectBackgroundPath(mixed, dryOut);
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
                dryOutQueue.Enqueue(dryFrame[index]);
            }

            return;
        }

        Array.Copy(dryFrame, processFrame, Native.FRAME_SIZE);

        var frameImpulse = MeasureFrameImpulse(dryFrame);
        var blendImpulse = Math.Max(impulseAmount, frameImpulse);
        // Strong desk taps only — speech plosives must still go through RNNoise.
        var isDeskTap = blendImpulse > 0.62f;

        try
        {
            if (isDeskTap)
            {
                // Fully dry: even a little RNNoise wet = “vrooom” overlay on the real tap.
                var impactGain = 1f - (blendImpulse * (impact / 100f) * 0.97f);
                for (var index = 0; index < Native.FRAME_SIZE; index++)
                {
                    var tap = dryFrame[index] * impactGain;
                    outputQueue.Enqueue(tap);
                    dryOutQueue.Enqueue(tap);
                }

                return;
            }

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
                dryOutQueue.Enqueue(dryFrame[index]);
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
                dryOutQueue.Enqueue(dryFrame[index]);
            }
        }
    }

    /// <summary>
    /// UI 0–100 → wet. Keep this almost fully wet at typical settings so a fan
    /// does not leak under the voice as dry fuzz. 50→0.80, 70→0.94, 88→0.99, 100→1.0
    /// </summary>
    private static float StrengthToWet(float strengthPercent)
    {
        var normalized = Math.Clamp(strengthPercent / 100f, 0f, 1f);
        return 1f - MathF.Pow(1f - normalized, 2.35f);
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
        var excess = peakEnvelope - (channelEnvelope * 3.6f);
        var targetImpulse = Math.Clamp(excess / 0.22f, 0f, 1f);
        // Fast open on real taps; release fast enough that talk isn't latched as a tap.
        var coeff = targetImpulse > impulseAmount ? 0.45f : 0.08f;
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
        if (peak < 0.06f || rms < MinEnvelope)
        {
            return 0f;
        }

        var crest = peak / Math.Max(rms, MinEnvelope);
        // Desk taps are much peakier than speech (typically crest > ~10).
        return Math.Clamp((crest - 9.5f) / 12f, 0f, 1f);
    }

    /// <summary>
    /// Speech vs a learned noise floor (fan / room tone), not a fixed amplitude.
    /// Hangover so Background cannot chop syllables or duck the whole voice.
    /// </summary>
    private void UpdateResidual()
    {
        var sampleRate = Math.Max(8000, WaveFormat.SampleRate);
        var hangoverSamples = Math.Max(1, (int)(sampleRate * 0.22f));
        var floor = Math.Max(noiseFloor, MinEnvelope);
        var snr = channelEnvelope / floor;
        var openThreshold = Math.Max(0.008f, floor * 1.9f);
        var closeThreshold = Math.Max(0.0035f, floor * 1.25f);

        if (channelEnvelope >= openThreshold && snr >= 1.75f)
        {
            residualSpeechOpen = true;
            quietHoldSamples = 0;
        }
        else if (residualSpeechOpen && (channelEnvelope < closeThreshold || snr < 1.22f))
        {
            quietHoldSamples++;
            if (quietHoldSamples >= hangoverSamples)
            {
                residualSpeechOpen = false;
            }
        }
        else
        {
            quietHoldSamples = 0;
        }
    }

    /// <summary>
    /// Slow minimum tracker so a fan becomes the floor instead of “always talking”.
    /// </summary>
    private void UpdateNoiseFloor(float abs)
    {
        var env = Math.Max(abs, MinEnvelope);
        var sampleRate = Math.Max(8000, WaveFormat.SampleRate);
        float coeff;
        if (env < noiseFloor)
        {
            coeff = 1f / (sampleRate * 0.35f);
        }
        else if (!residualSpeechOpen)
        {
            coeff = 1f / (sampleRate * 3.2f);
        }
        else
        {
            coeff = 1f / (sampleRate * 28f);
        }

        noiseFloor += (env - noiseFloor) * coeff;
        noiseFloor = Math.Clamp(noiseFloor, 0.00035f, 0.07f);
    }

    /// <summary>
    /// Exclusive path: RNNoise mixed while talking and when idle. Never sum dry + wet.
    /// Idle dry was a clear room — and a clear fan. Duck, switch gain, then rise.
    /// </summary>
    private float SelectBackgroundPath(float mixed, float dryOut)
    {
        _ = dryOut;
        mixed *= EngineDspMarkers.KeepAliveScale();
        var wantIdle = !residualSpeechOpen;
        var sampleRate = Math.Max(8000, WaveFormat.SampleRate);
        var duckCoeff = 1f / Math.Max(2f, sampleRate * 0.004f);
        var riseCoeff = 1f / Math.Max(2f, sampleRate * 0.008f);

        if (idlePath != wantIdle)
        {
            pathGain += (0f - pathGain) * duckCoeff;
            if (pathGain <= 0.03f)
            {
                idlePath = wantIdle;
                pathGain = 0f;
            }
        }
        else
        {
            var target = idlePath ? QuietRoomGain() : 1f;
            pathGain += (target - pathGain) * riseCoeff;
            pathGain = Math.Clamp(pathGain, 0f, 1f);
        }

        // Always the RNNoise mix — idle attenuation is gain, not a dry-fan switch.
        return ExpandResidual(mixed * pathGain);
    }

    /// <summary>
    /// Background 0 keeps cleaned leftover when quiet (fan stays suppressed).
    /// Background 100 is true silence when you are not talking.
    /// </summary>
    private float QuietRoomGain()
    {
        var amount = Math.Clamp(background / 100f, 0f, 1f);
        return MathF.Pow(1f - amount, 2.2f);
    }

    /// <summary>
    /// Crush leftover fan/swirl near the noise floor. Gentle while talking so
    /// consonants survive; stronger when idle and as Background rises.
    /// </summary>
    private float ExpandResidual(float sample)
    {
        var abs = Math.Abs(sample);
        var amount = Math.Clamp(background / 100f, 0f, 1f);
        var thresh = Math.Max(noiseFloor * (1.35f + (amount * 3.4f)), 0.0007f);
        if (residualSpeechOpen)
        {
            thresh *= 0.5f;
        }

        if (abs >= thresh)
        {
            return sample;
        }

        var ratio = 1.7f + (amount * 3.6f);
        var gain = MathF.Pow(Math.Max(abs, MinEnvelope) / thresh, ratio - 1f);
        return sample * Math.Clamp(gain, 0f, 1f);
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
        var target = channelEnvelope >= thresholdLinear ? 1f : 0f;
        var attackCoeff = 0.08f + ((100f - attack) * 0.0035f);
        var releaseCoeff = 0.018f + ((100f - release) * 0.0012f);
        var coeff = target > gateGain ? attackCoeff : releaseCoeff;
        gateGain += (target - gateGain) * coeff;
        gateGain = Math.Clamp(gateGain, 0f, 1f);
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
        residualSpeechOpen = false;
        quietHoldSamples = 0;
        idlePath = true;
        pathGain = 1f;
        channelEnvelope = MinEnvelope;
        peakEnvelope = MinEnvelope;
        impulseAmount = 0f;
        compressorEnvelope = MinEnvelope;
        limiterEnvelope = MinEnvelope;
        noiseFloor = 0.004f;
        inputQueue.Clear();
        outputQueue.Clear();
        dryOutQueue.Clear();
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

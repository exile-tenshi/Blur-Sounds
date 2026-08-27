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
    /// <summary>Light makeup only — high makeup made mic taps blast / robotic.</summary>
    private const float RnnoiseMakeup = 1.03f;
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
    private float gateEnvelope = MinEnvelope;
    private bool residualSpeechOpen;
    private int quietHoldSamples;
    private bool idlePath;
    private float pathGain = 1f;
    private float noiseFloor = 0.004f;
    private float limiterEnvelope = MinEnvelope;
    private bool enabled;
    private bool noiseGateEnabled;
    private float strength = 90f;
    private float background = 78f;
    private float impact = 72f;
    private float noiseGateThreshold = 40f;
    private float attack = 55f;
    private float release = 40f;
    private bool deEchoActive;
    private float deEchoAmount = 45f;
    private bool compressorEnabled;
    private float compressorLevel = 30f;
    private float compressorEnvelope = MinEnvelope;
    private int echoTailSamples;

    public NoiseSuppressionSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        channels = Math.Max(1, WaveFormat.Channels);
        RebuildHighPass();
        _ = EngineDspMarkers.KeepAliveScale();
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
        float nextCompressorLevel = 30f,
        float nextDeEcho = 45f)
    {
        lock (gate)
        {
            var wasActive = IsProcessingActive;
            enabled = nextEnabled;
            noiseGateEnabled = nextNoiseGateEnabled;
            compressorEnabled = nextCompressorEnabled;
            deEchoAmount = Math.Clamp(nextDeEcho, 0f, 100f);
            deEchoActive = deEchoAmount > 0.5f;
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
        if (enabled && deEchoActive)
        {
            // Scale wet boost with Echo bar — high Echo tips toward robotic.
            var echo = deEchoAmount / 100f;
            wet = Math.Min(0.94f, wet + (0.02f + (echo * 0.07f)));
        }
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
        // Keyboard + desk: catch softer typing, not only hard bumps.
        var isDeskTap = blendImpulse > 0.38f;

        try
        {
            if (isDeskTap)
            {
                // Dry path + Impact duck — RNNoise on taps = “vrooom”. High Impact ≈ mute.
                var impactGain = 1f - (blendImpulse * (impact / 100f));
                impactGain = Math.Clamp(impactGain, 0f, 1f);
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
            // Soft key-clacks that didn't trip desk-tap still get Impact ducking.
            var softImpactGain = 1f;
            if (impact > 0.5f && blendImpulse > 0.1f)
            {
                softImpactGain = 1f - (blendImpulse * (impact / 100f) * 0.9f);
                softImpactGain = Math.Clamp(softImpactGain, 0.05f, 1f);
            }

            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                var mixed = ((dryFrame[index] * dryMix) + (processFrame[index] * wet)) * makeup;
                mixed *= softImpactGain;
                if (float.IsNaN(mixed) || float.IsInfinity(mixed))
                {
                    mixed = dryFrame[index] * softImpactGain;
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
    /// UI 0–100 → wet. Strong enough to beat Sonar-style fan bleed under voice,
    /// soft-capped so Max isn't fully robotic. 70→0.88, 88→0.95, 100→0.97
    /// </summary>
    private static float StrengthToWet(float strengthPercent)
    {
        var normalized = Math.Clamp(strengthPercent / 100f, 0f, 1f);
        return 0.97f * (1f - MathF.Pow(1f - normalized, 1.85f));
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

        // Speech rises together; taps/keys jump far above the voice follower.
        var excess = peakEnvelope - (channelEnvelope * 2.8f);
        var targetImpulse = Math.Clamp(excess / 0.16f, 0f, 1f);
        // Fast open on real taps; release fast enough that talk isn't latched as a tap.
        var coeff = targetImpulse > impulseAmount ? 0.55f : 0.1f;
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
        // Keyboards are peaky but softer than desk bumps — catch crest > ~6.5.
        return Math.Clamp((crest - 6.5f) / 10f, 0f, 1f);
    }

    /// <summary>
    /// Speech vs a learned noise floor. Echo amount shortens hangover and arms a
    /// post-speech tail window — higher Echo = longer/harder reverb crush.
    /// </summary>
    private void UpdateResidual()
    {
        var sampleRate = Math.Max(8000, WaveFormat.SampleRate);
        var echo = Math.Clamp(deEchoAmount / 100f, 0f, 1f);
        var bg = Math.Clamp(background / 100f, 0f, 1f);
        // High Background closes sooner so fans/room die between words (Sonar-like).
        var hangoverSeconds = 0.18f - (bg * 0.1f);
        if (deEchoActive)
        {
            hangoverSeconds = Math.Min(hangoverSeconds, 0.22f - (echo * 0.165f));
        }
        hangoverSeconds = Math.Clamp(hangoverSeconds, 0.05f, 0.22f);
        var hangoverSamples = Math.Max(1, (int)(sampleRate * hangoverSeconds));
        var floor = Math.Max(noiseFloor, MinEnvelope);
        var snr = channelEnvelope / floor;
        // Slightly harder open — idle fan shouldn't count as speech.
        var openThreshold = Math.Max(0.01f, floor * (2.15f + (bg * 0.4f)));
        var closeThreshold = Math.Max(0.004f, floor * (1.35f + (bg * 0.2f)));

        var wasOpen = residualSpeechOpen;
        if (channelEnvelope >= openThreshold && snr >= 2.0f)
        {
            residualSpeechOpen = true;
            quietHoldSamples = 0;
            echoTailSamples = 0;
        }
        else if (residualSpeechOpen && (channelEnvelope < closeThreshold || snr < 1.35f))
        {
            quietHoldSamples++;
            if (quietHoldSamples >= hangoverSamples)
            {
                residualSpeechOpen = false;
                if (deEchoActive)
                {
                    // Tail window grows with Echo bar (~120–360 ms).
                    var tailSeconds = 0.12f + (echo * 0.24f);
                    echoTailSamples = Math.Max(1, (int)(sampleRate * tailSeconds));
                }
            }
        }
        else
        {
            quietHoldSamples = 0;
        }

        if (!wasOpen && residualSpeechOpen)
        {
            echoTailSamples = 0;
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
        // Steeper idle duck — Sonar-like silence between phrases when Background is high.
        return MathF.Pow(1f - amount, 2.55f);
    }

    /// <summary>
    /// Crush leftover fan / room / keyboard wash. Strong when idle or Background high;
    /// lighter while talking so consonants survive.
    /// </summary>
    private float ExpandResidual(float sample)
    {
        var abs = Math.Abs(sample);
        var amount = Math.Clamp(background / 100f, 0f, 1f);
        var echo = Math.Clamp(deEchoAmount / 100f, 0f, 1f);
        var inEchoTail = deEchoActive && echoTailSamples > 0;
        if (inEchoTail)
        {
            echoTailSamples--;
        }

        if (residualSpeechOpen && !inEchoTail)
        {
            // While talking: still kill under-voice fan/hum that rides under speech.
            var talkAmount = Math.Min(1f, amount + 0.15f + (echo * 0.2f));
            var talkThresh = Math.Max(noiseFloor * (0.95f + (talkAmount * 1.6f)), 0.0007f);
            if (abs >= talkThresh)
            {
                return sample;
            }

            var talkRatio = 1.45f + (talkAmount * 1.4f);
            var talkFloor = 0.22f - (talkAmount * 0.12f);
            var talkGain = MathF.Pow(Math.Max(abs, MinEnvelope) / talkThresh, talkRatio - 1f);
            return sample * Math.Clamp(talkGain, Math.Max(0.06f, talkFloor), 1f);
        }

        var floorScale = inEchoTail
            ? (1.6f + (amount * 2.6f) + (echo * 2.8f))
            : (1.55f + (amount * 3.4f));
        var thresh = Math.Max(
            noiseFloor * floorScale,
            inEchoTail ? (0.0009f + (echo * 0.0014f)) : (0.0008f + (amount * 0.0015f)));
        if (abs >= thresh)
        {
            if (inEchoTail && abs < thresh * (1.8f + (echo * 1.2f)))
            {
                var taper = Math.Clamp((abs - thresh) / Math.Max(MinEnvelope, thresh * 1.4f), 0f, 1f);
                var floorGain = 0.28f - (echo * 0.2f);
                return sample * (Math.Max(0.04f, floorGain) + ((1f - Math.Max(0.04f, floorGain)) * taper));
            }

            return sample;
        }

        var ratio = inEchoTail
            ? (1.8f + (amount * 2.4f) + (echo * 2.8f))
            : (1.9f + (amount * 3.2f));
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
        var previous = gateEnvelope;
        var learn = abs > previous ? SpeechLearnRate : NoiseLearnRate;
        gateEnvelope = Math.Max(MinEnvelope, previous + ((abs - previous) * learn));

        var thresholdLinear = MathF.Pow(10f, (-50f + (noiseGateThreshold * 0.28f)) / 20f);
        var target = gateEnvelope >= thresholdLinear ? 1f : 0f;
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
        gateEnvelope = MinEnvelope;
        residualSpeechOpen = false;
        quietHoldSamples = 0;
        echoTailSamples = 0;
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

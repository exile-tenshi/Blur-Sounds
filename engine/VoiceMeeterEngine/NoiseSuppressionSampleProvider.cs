using System.Collections.Generic;
using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise. Uses a fixed ~10 ms frame delay so
/// every input sample produces exactly one output sample (no drops / no in-out).
/// Completely bypasses when NS and the optional gate are both off.
/// </summary>
internal sealed class NoiseSuppressionSampleProvider : ISampleProvider, IDisposable
{
    private const float MinEnvelope = 1e-6f;
    private const float NoiseLearnRate = 0.02f;
    private const float SpeechLearnRate = 0.4f;
    /// <summary>RNNoise often lowers speech a bit — restore level without clipping.</summary>
    private const float RnnoiseMakeup = 1.25f;

    private readonly ISampleProvider source;
    private readonly int channels;
    private readonly object gate = new();
    private readonly float[] dryFrame = new float[Native.FRAME_SIZE];
    private readonly float[] processFrame = new float[Native.FRAME_SIZE];
    private readonly Queue<float> inputQueue = new(Native.FRAME_SIZE * 2);
    private readonly Queue<float> outputQueue = new(Native.FRAME_SIZE * 2);
    private Denoiser? denoiser;
    private bool denoiserFailed;
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
        float nextNoiseGateThreshold = 35f)
    {
        lock (gate)
        {
            _ = nextThreshold;
            _ = nextHighPassHz;

            enabled = nextEnabled;
            // Gate alone causes speech ducking — only allow while NS is on.
            noiseGateEnabled = nextEnabled && nextNoiseGateEnabled;
            strength = Math.Clamp(nextStrength, 0f, 100f);
            attack = Math.Clamp(nextAttack, 0f, 100f);
            release = Math.Clamp(nextRelease, 0f, 100f);
            noiseGateThreshold = Math.Clamp(nextNoiseGateThreshold, 0f, 100f);

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

        // First RNNoise frame (~10 ms) is still filling — keep timeline continuous with silence,
        // never pass dry here or those samples would also be replayed from the output queue.
        return 0f;
    }

    private void ProcessFullFrame()
    {
        var wet = enabled ? Math.Clamp(strength / 100f, 0f, 1f) : 0f;
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
            // finish:false — never zero-pad mid-stream.
            denoiser!.Denoise(processFrame.AsSpan(), finish: false);

            var dryMix = 1f - wet;
            var makeup = 1f + ((RnnoiseMakeup - 1f) * wet);
            for (var index = 0; index < Native.FRAME_SIZE; index++)
            {
                var mixed = (dryFrame[index] * dryMix) + (processFrame[index] * wet);
                outputQueue.Enqueue(Math.Clamp(mixed * makeup, -1f, 1f));
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
        channelEnvelope = Math.Max(MinEnvelope, previous + ((abs - previous) * learn));

        // Softer than a hard mute — duck to 18% instead of silence to avoid extreme in/out.
        var thresholdLinear = MathF.Pow(10f, (-48f + (noiseGateThreshold * 0.3f)) / 20f);
        var target = channelEnvelope >= thresholdLinear ? 1f : 0.18f;
        var attackCoeff = 0.08f + ((100f - attack) * 0.004f);
        var releaseCoeff = 0.015f + ((100f - release) * 0.0012f);
        var coeff = target > gateGain ? attackCoeff : releaseCoeff;
        gateGain += (target - gateGain) * coeff;
        gateGain = Math.Clamp(gateGain, 0.18f, 1f);
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

    private void ResetIdleState()
    {
        gateGain = 1f;
        channelEnvelope = MinEnvelope;
        inputQueue.Clear();
        outputQueue.Clear();
        Array.Clear(dryFrame);
        Array.Clear(processFrame);
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

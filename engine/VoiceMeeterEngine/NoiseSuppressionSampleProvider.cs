using NAudio.Wave;
using RNNoise.NET;

namespace VoiceMeeterEngine;

/// <summary>
/// Neural mic noise cancellation via RNNoise (Xiph), with strength dry/wet mix
/// and an optional hard noise gate. Falls back to pass-through if the native DLL
/// cannot load.
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
    private readonly float[] dryFrame = new float[Native.FRAME_SIZE];
    private readonly float[] processFrame = new float[Native.FRAME_SIZE];
    private readonly float[] outputFrame = new float[Native.FRAME_SIZE];
    private int frameFill;
    private int outputRead;
    private int outputCount;
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
                gateGain = 1f;
                ResetBuffers();
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
            // Legacy threshold / high-pass knobs are unused by RNNoise but kept for IPC compat.
            _ = nextThreshold;
            _ = nextHighPassHz;

            enabled = nextEnabled;
            // Gate alone causes cut in/out — only allow it while NS is on.
            noiseGateEnabled = nextEnabled && nextNoiseGateEnabled;
            strength = Math.Clamp(nextStrength, 0f, 100f);
            attack = Math.Clamp(nextAttack, 0f, 100f);
            release = Math.Clamp(nextRelease, 0f, 100f);
            noiseGateThreshold = Math.Clamp(nextNoiseGateThreshold, 0f, 100f);

            if (!IsProcessingActive)
            {
                gateGain = 1f;
                ResetBuffers();
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
            ResetBuffers();
            return true;
        }
        catch
        {
            denoiserFailed = true;
            denoiser = null;
            return false;
        }
    }

    private float ProcessMonoSample(float sample)
    {
        if (outputRead < outputCount)
        {
            return outputFrame[outputRead++];
        }

        dryFrame[frameFill++] = sample;
        if (frameFill < Native.FRAME_SIZE)
        {
            // First ~10 ms of each stream: pass dry until a full RNNoise frame is ready.
            return sample;
        }

        frameFill = 0;
        outputRead = 0;
        outputCount = Native.FRAME_SIZE;

        var wet = enabled ? strength / 100f : 0f;
        if (!enabled || wet <= 0.001f || !EnsureDenoiser())
        {
            Array.Copy(dryFrame, outputFrame, Native.FRAME_SIZE);
            return outputFrame[outputRead++];
        }

        Array.Copy(dryFrame, processFrame, Native.FRAME_SIZE);
        try
        {
            // finish:false — never zero-pad mid-stream.
            denoiser!.Denoise(processFrame.AsSpan(), finish: false);
            if (wet >= 0.999f)
            {
                Array.Copy(processFrame, outputFrame, Native.FRAME_SIZE);
            }
            else
            {
                var dryMix = 1f - wet;
                for (var index = 0; index < Native.FRAME_SIZE; index++)
                {
                    outputFrame[index] = (dryFrame[index] * dryMix) + (processFrame[index] * wet);
                }
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
            Array.Copy(dryFrame, outputFrame, Native.FRAME_SIZE);
        }

        return outputFrame[outputRead++];
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

    private void ResetBuffers()
    {
        frameFill = 0;
        outputRead = 0;
        outputCount = 0;
        Array.Clear(dryFrame);
        Array.Clear(processFrame);
        Array.Clear(outputFrame);
        channelEnvelope = MinEnvelope;
    }
}

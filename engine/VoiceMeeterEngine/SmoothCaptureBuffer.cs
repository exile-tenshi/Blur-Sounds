using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Lock-protected float sample ring that never throws on overflow.
/// </summary>
internal sealed class FloatCaptureRing
{
    private readonly object gate = new();
    private float[] storage;
    private int head;
    private int count;
    private readonly int capacity;

    public FloatCaptureRing(int capacitySamples)
    {
        capacity = Math.Max(2, capacitySamples);
        storage = new float[capacity];
    }

    public int BufferedSamples
    {
        get
        {
            lock (gate)
            {
                return count;
            }
        }
    }

    public void Clear()
    {
        lock (gate)
        {
            head = 0;
            count = 0;
        }
    }

    public void Write(float[] samples, int offset, int sampleCount)
    {
        if (sampleCount <= 0)
        {
            return;
        }

        lock (gate)
        {
            if (sampleCount > capacity)
            {
                offset += sampleCount - capacity;
                sampleCount = capacity;
            }

            var overflow = count + sampleCount - capacity;
            if (overflow > 0)
            {
                head = (head + overflow) % capacity;
                count -= overflow;
            }

            var writePos = (head + count) % capacity;
            var firstPart = Math.Min(sampleCount, capacity - writePos);
            Array.Copy(samples, offset, storage, writePos, firstPart);
            if (firstPart < sampleCount)
            {
                Array.Copy(samples, offset + firstPart, storage, 0, sampleCount - firstPart);
            }

            count += sampleCount;
        }
    }

    public int Read(float[] destination, int offset, int sampleCount)
    {
        lock (gate)
        {
            var samplesToRead = Math.Min(sampleCount, count);
            if (samplesToRead <= 0)
            {
                return 0;
            }

            var firstPart = Math.Min(samplesToRead, capacity - head);
            Array.Copy(storage, head, destination, offset, firstPart);
            if (firstPart < samplesToRead)
            {
                Array.Copy(storage, 0, destination, offset + firstPart, samplesToRead - firstPart);
            }

            head = (head + samplesToRead) % capacity;
            count -= samplesToRead;
            return samplesToRead;
        }
    }

    public int PeekBufferedSamples()
    {
        lock (gate)
        {
            return count;
        }
    }
}

/// <summary>
/// FIFO capture queue for microphones and app loopback.
/// </summary>
internal sealed class SmoothCaptureBuffer
{
    private readonly object gate = new();
    private readonly WaveFormat captureFormat;
    private readonly WaveFormat floatFormat;
    private readonly FloatCaptureRing ring;
    private readonly int targetBufferedSamples;
    private readonly int trimThresholdSamples;
    private readonly bool comfortCapture;
    private readonly int minPlayoutSamples;
    private readonly bool holdLastOnUnderrun;
    private readonly bool enableTrim;
    private float[] convertScratch = [];
    private float[] trimScratch = [];
    private float[] lastFrame = [];
    private bool hasWrittenAudio;

    public SmoothCaptureBuffer(
        WaveFormat format,
        int mixSampleRate = EngineAudioFormat.SampleRate,
        bool isHiFiOutput = false,
        bool comfortUnderrun = false,
        string? deviceName = null,
        int? maxCaptureMilliseconds = null,
        int? jitterBufferMilliseconds = null,
        bool holdLastOnUnderrun = true,
        bool enableTrim = true)
    {
        captureFormat = format;
        floatFormat = CaptureFormatConverter.CreateFloatStorageFormat(format);
        comfortCapture = comfortUnderrun;
        this.holdLastOnUnderrun = holdLastOnUnderrun;
        this.enableTrim = enableTrim;
        var isHiFiMix = AudioTuningPolicy.UseHiFiBuffers(
            isHiFiOutput || mixSampleRate == HifiStreamingPolicy.EngineMixSampleRate);
        var maxCaptureMs = maxCaptureMilliseconds ??
            (comfortUnderrun
                ? CaptureDeviceTuning.GetMicCaptureMaxMilliseconds(deviceName, isHiFiMix)
                : LatencyTuning.GetMicCaptureMaxMilliseconds(isHiFiMix));

        var ringMs = Math.Max(
            comfortUnderrun
                ? CaptureDeviceTuning.GetMicCaptureRingMilliseconds(deviceName)
                : maxCaptureMilliseconds.HasValue
                    ? LatencyTuning.LoopbackCaptureRingMilliseconds
                    : LatencyTuning.MicCaptureRingMilliseconds,
            maxCaptureMs + 100);
        var ringSamples = Math.Max(
            floatFormat.Channels,
            floatFormat.SampleRate * floatFormat.Channels * ringMs / 1000);
        targetBufferedSamples = Math.Max(
            floatFormat.Channels,
            floatFormat.SampleRate * floatFormat.Channels * maxCaptureMs / 1000);
        trimThresholdSamples = comfortUnderrun
            ? targetBufferedSamples + targetBufferedSamples / 2
            : targetBufferedSamples + targetBufferedSamples / 3;
        var baseJitterBufferMs = jitterBufferMilliseconds ??
            (maxCaptureMilliseconds.HasValue
                ? LatencyTuning.LoopbackCaptureJitterBufferMilliseconds
                : LatencyTuning.MicCaptureJitterBufferMilliseconds);
        var jitterSamples = Math.Max(
            floatFormat.Channels,
            floatFormat.SampleRate * floatFormat.Channels * baseJitterBufferMs / 1000);
        minPlayoutSamples = comfortUnderrun
            ? Math.Max(
                jitterSamples,
                floatFormat.SampleRate * floatFormat.Channels *
                CaptureDeviceTuning.GetJitterBufferMilliseconds(deviceName) / 1000)
            : jitterSamples;

        ring = new FloatCaptureRing(ringSamples);
        lastFrame = new float[floatFormat.Channels];
    }

    public WaveFormat WaveFormat => floatFormat;

    public int BufferedSamples => ring.BufferedSamples;

    public void Clear()
    {
        lock (gate)
        {
            ring.Clear();
            Array.Clear(lastFrame, 0, lastFrame.Length);
            hasWrittenAudio = false;
        }
    }

    public void RelievePressure(int milliseconds = 30)
    {
        lock (gate)
        {
            var channels = Math.Max(1, floatFormat.Channels);
            var samplesToTrim = Math.Max(
                channels,
                floatFormat.SampleRate * channels * milliseconds / 1000);
            TrimOldestSamples(samplesToTrim);
        }
    }

    public void Write(byte[] data, int offset, int count)
    {
        lock (gate)
        {
            var maxSamples = Math.Max(1, count / Math.Max(1, captureFormat.BlockAlign) * captureFormat.Channels);
            if (convertScratch.Length < maxSamples)
            {
                convertScratch = new float[maxSamples];
            }

            var samplesWritten = CaptureFormatConverter.ConvertToFloatSamples(
                data,
                offset,
                count,
                captureFormat,
                convertScratch,
                0);

            if (samplesWritten <= 0)
            {
                return;
            }

            ring.Write(convertScratch, 0, samplesWritten);
            UpdateLastFrame(convertScratch, samplesWritten);
            hasWrittenAudio = true;
            TrimOldestBeyond(targetBufferedSamples);
        }
    }

    public ISampleProvider CreateReader()
    {
        return new SmoothCaptureSampleProvider(
            gate,
            ring,
            floatFormat,
            lastFrame,
            () => hasWrittenAudio,
            holdLastOnUnderrun,
            comfortCapture,
            minPlayoutSamples,
            targetBufferedSamples);
    }

    private void TrimOldestBeyond(int maxSamples)
    {
        if (!enableTrim)
        {
            return;
        }

        var excess = ring.BufferedSamples - maxSamples;
        if (excess <= 0)
        {
            return;
        }

        var channels = Math.Max(1, floatFormat.Channels);
        // Trim as soon as we drift past one packet so latency cannot climb.
        var minExcessBeforeTrim = Math.Max(
            channels,
            floatFormat.SampleRate * channels * LatencyTuning.MaxTrimPassMilliseconds / 1000);
        if (excess < minExcessBeforeTrim)
        {
            return;
        }

        var maxTrimPerPass = Math.Max(
            channels,
            floatFormat.SampleRate * channels * LatencyTuning.MaxTrimPassMilliseconds / 1000);
        var alignedExcess = excess - (excess % channels);
        var trimCount = Math.Min(alignedExcess, maxTrimPerPass);
        if (trimCount <= 0)
        {
            return;
        }

        TrimOldestSamples(trimCount);
    }

    private void TrimOldestSamples(int sampleCount)
    {
        if (sampleCount <= 0)
        {
            return;
        }

        if (trimScratch.Length < sampleCount)
        {
            trimScratch = new float[sampleCount];
        }

        ring.Read(trimScratch, 0, sampleCount);
    }

    private void UpdateLastFrame(float[] samples, int sampleCount)
    {
        var channels = Math.Max(1, floatFormat.Channels);
        if (lastFrame.Length != channels)
        {
            lastFrame = new float[channels];
        }

        var frames = sampleCount / channels;
        if (frames <= 0)
        {
            return;
        }

        var frameStart = (frames - 1) * channels;
        for (var channel = 0; channel < channels; channel++)
        {
            lastFrame[channel] = samples[frameStart + channel];
        }
    }
}

internal sealed class SmoothCaptureSampleProvider : ISampleProvider
{
    private readonly object gate;
    private readonly FloatCaptureRing ring;
    private readonly int channels;
    private readonly SampleGapFill gapFill;
    private readonly Func<bool> hasWrittenAudio;
    private readonly int minPlayoutSamples;

    public SmoothCaptureSampleProvider(
        object gate,
        FloatCaptureRing ring,
        WaveFormat floatFormat,
        float[] lastFrame,
        Func<bool> hasWrittenAudio,
        bool holdLastOnUnderrun,
        bool comfortCapture = false,
        int minPlayoutSamples = 0,
        int targetBufferedSamples = 0)
    {
        this.gate = gate;
        this.ring = ring;
        WaveFormat = floatFormat;
        channels = Math.Max(1, floatFormat.Channels);
        gapFill = new SampleGapFill(channels);
        this.hasWrittenAudio = hasWrittenAudio;
        this.minPlayoutSamples = Math.Max(0, minPlayoutSamples);
        _ = holdLastOnUnderrun;
        _ = comfortCapture;
        _ = targetBufferedSamples;
        _ = lastFrame;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] samples, int offset, int count)
    {
        lock (gate)
        {
            var buffered = ring.BufferedSamples;
            if (minPlayoutSamples > 0 && buffered < minPlayoutSamples)
            {
                Array.Clear(samples, offset, count);
                return count;
            }

            if (buffered < count)
            {
                var samplesRead = ring.Read(samples, offset, buffered);
                if (samplesRead > 0)
                {
                    gapFill.NoteSamplesRead(samples, offset, samplesRead);
                    CaptureDiagnostics.NoteCaptureUnderrun();
                }

                gapFill.FillGap(samples, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
                return count;
            }

            var fullRead = ring.Read(samples, offset, count);
            if (fullRead > 0)
            {
                gapFill.NoteSamplesRead(samples, offset, fullRead);
            }

            return count;
        }
    }
}

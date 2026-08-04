using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Simple FIFO capture queue. No live-edge discard, no jitter gate, no gap-fill.
/// </summary>
internal sealed class FifoCaptureBuffer
{
    private readonly object gate = new();
    private readonly WaveFormat captureFormat;
    private readonly WaveFormat floatFormat;
    private readonly BufferedWaveProvider buffer;
    private float[] convertScratch = [];
    private byte[] floatByteScratch = [];
    private byte[] readScratch = [];

    private readonly int minPlayoutSamples;

    public FifoCaptureBuffer(WaveFormat format, int maxMilliseconds = 300, int jitterBufferMilliseconds = 0)
    {
        captureFormat = format;
        floatFormat = CaptureFormatConverter.CreateFloatStorageFormat(format);
        var ringMs = Math.Max(100, maxMilliseconds + 100);
        buffer = new BufferedWaveProvider(floatFormat)
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromMilliseconds(ringMs),
        };
        minPlayoutSamples = Math.Max(
            0,
            floatFormat.SampleRate * floatFormat.Channels * jitterBufferMilliseconds / 1000);
    }

    public WaveFormat WaveFormat => floatFormat;

    public int BufferedSamples
    {
        get
        {
            lock (gate)
            {
                return buffer.BufferedBytes / Math.Max(1, sizeof(float));
            }
        }
    }

    public void Clear()
    {
        lock (gate)
        {
            buffer.ClearBuffer();
        }
    }

    public void RelievePressure(int milliseconds = 30)
    {
        lock (gate)
        {
            var bytesToDiscard = Math.Max(
                floatFormat.BlockAlign,
                floatFormat.AverageBytesPerSecond * milliseconds / 1000);
            DiscardBytes(Math.Min(bytesToDiscard, buffer.BufferedBytes));
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

            var byteCount = samplesWritten * sizeof(float);
            if (floatByteScratch.Length < byteCount)
            {
                floatByteScratch = new byte[byteCount];
            }

            Buffer.BlockCopy(convertScratch, 0, floatByteScratch, 0, byteCount);
            buffer.AddSamples(floatByteScratch, 0, byteCount);
        }
    }

    public ISampleProvider CreateReader() => new FifoCaptureSampleProvider(gate, buffer, floatFormat, minPlayoutSamples);

    private void DiscardBytes(int byteCount)
    {
        var alignedCount = byteCount - (byteCount % buffer.WaveFormat.BlockAlign);
        if (alignedCount <= 0)
        {
            return;
        }

        if (readScratch.Length < alignedCount)
        {
            readScratch = new byte[alignedCount];
        }

        buffer.Read(readScratch, 0, alignedCount);
    }
}

internal sealed class FifoCaptureSampleProvider : ISampleProvider
{
    private readonly object gate;
    private readonly BufferedWaveProvider buffer;
    private readonly WaveFormat floatFormat;
    private readonly SampleGapFill gapFill;
    private readonly int minPlayoutSamples;
    private byte[] readScratch = [];

    public FifoCaptureSampleProvider(object gate, BufferedWaveProvider buffer, WaveFormat floatFormat, int minPlayoutSamples = 0)
    {
        this.gate = gate;
        this.buffer = buffer;
        this.floatFormat = floatFormat;
        this.minPlayoutSamples = Math.Max(0, minPlayoutSamples);
        gapFill = new SampleGapFill(Math.Max(1, floatFormat.Channels));
        WaveFormat = floatFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] samples, int offset, int count)
    {
        lock (gate)
        {
            if (minPlayoutSamples > 0 && buffer.BufferedBytes / sizeof(float) < minPlayoutSamples)
            {
                gapFill.FillGap(samples, offset, count);
                return count;
            }

            var bytesNeeded = count * sizeof(float);
            if (readScratch.Length < bytesNeeded)
            {
                readScratch = new byte[bytesNeeded];
            }

            var bytesToRead = Math.Min(bytesNeeded, buffer.BufferedBytes);
            var bytesRead = bytesToRead > 0 ? buffer.Read(readScratch, 0, bytesToRead) : 0;
            var samplesRead = bytesRead / sizeof(float);

            if (samplesRead > 0)
            {
                Buffer.BlockCopy(readScratch, 0, samples, offset * sizeof(float), bytesRead);
                gapFill.NoteSamplesRead(samples, offset, samplesRead);
            }

            if (samplesRead < count)
            {
                if (samplesRead > 0)
                {
                    CaptureDiagnostics.NoteCaptureUnderrun();
                }

                gapFill.FillGap(samples, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
            }

            return count;
        }
    }
}

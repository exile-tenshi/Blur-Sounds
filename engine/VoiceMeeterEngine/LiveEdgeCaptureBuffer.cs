using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Low-latency live-edge capture queue for application loopback.
/// Keeps only the newest audio and discards stale samples on read.
/// </summary>
internal sealed class LiveEdgeCaptureBuffer
{
    private readonly object gate = new();
    private readonly WaveFormat captureFormat;
    private readonly WaveFormat floatFormat;
    private readonly BufferedWaveProvider buffer;
    private readonly int targetBufferedBytes;
    private byte[] discardBuffer = [];
    private float[] convertScratch = [];
    private byte[] floatByteScratch = [];

    public LiveEdgeCaptureBuffer(WaveFormat format)
    {
        captureFormat = format;
        floatFormat = CaptureFormatConverter.CreateFloatStorageFormat(format);
        targetBufferedBytes = Math.Max(
            floatFormat.BlockAlign,
            floatFormat.AverageBytesPerSecond * LatencyTuning.LiveEdgeMaxMilliseconds / 1000);

        buffer = new BufferedWaveProvider(floatFormat)
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromMilliseconds(LatencyTuning.LiveEdgeRingMilliseconds),
        };
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

    public void RelievePressure(int milliseconds = 20)
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
            DiscardOldestBeyond(targetBufferedBytes);
        }
    }

    public ISampleProvider CreateReader()
    {
        return new LiveEdgeSampleProvider(gate, buffer, floatFormat);
    }

    private void DiscardOldestBeyond(int maxBytes)
    {
        var excess = buffer.BufferedBytes - maxBytes;
        if (excess <= 0)
        {
            return;
        }

        DiscardBytes(excess);
    }

    private void DiscardBytes(int byteCount)
    {
        var alignedCount = byteCount - (byteCount % buffer.WaveFormat.BlockAlign);
        if (alignedCount <= 0)
        {
            return;
        }

        if (discardBuffer.Length < alignedCount)
        {
            discardBuffer = new byte[alignedCount];
        }

        buffer.Read(discardBuffer, 0, alignedCount);
    }
}

internal sealed class LiveEdgeSampleProvider : ISampleProvider
{
    private readonly object gate;
    private readonly BufferedWaveProvider buffer;
    private readonly WaveFormat floatFormat;
    private byte[] readScratch = [];
    private byte[] discardBuffer = [];

    public LiveEdgeSampleProvider(object gate, BufferedWaveProvider buffer, WaveFormat floatFormat)
    {
        this.gate = gate;
        this.buffer = buffer;
        this.floatFormat = floatFormat;
        WaveFormat = floatFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] samples, int offset, int count)
    {
        lock (gate)
        {
            var bytesNeeded = count * sizeof(float);
            var available = buffer.BufferedBytes;
            if (available > bytesNeeded)
            {
                DiscardBytes(available - bytesNeeded);
            }

            if (readScratch.Length < bytesNeeded)
            {
                readScratch = new byte[bytesNeeded];
            }

            var bytesRead = buffer.Read(readScratch, 0, bytesNeeded);
            var samplesRead = bytesRead / sizeof(float);

            for (var index = 0; index < samplesRead; index++)
            {
                samples[offset + index] = BitConverter.ToSingle(readScratch, index * sizeof(float));
            }

            if (samplesRead < count)
            {
                if (samplesRead > 0)
                {
                    CaptureDiagnostics.NoteCaptureUnderrun();
                }

                Array.Clear(samples, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
            }

            return count;
        }
    }

    private void DiscardBytes(int byteCount)
    {
        var alignedCount = byteCount - (byteCount % floatFormat.BlockAlign);
        if (alignedCount <= 0)
        {
            return;
        }

        if (discardBuffer.Length < alignedCount)
        {
            discardBuffer = new byte[alignedCount];
        }

        buffer.Read(discardBuffer, 0, alignedCount);
    }
}

using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Live-edge capture queue for application loopback / music.
/// Soft-trims toward a target depth; never discards on every read.
/// Underruns hold the last frame instead of silence to avoid bitrattling crackle.
/// </summary>
internal sealed class LiveEdgeCaptureBuffer
{
    private readonly object gate = new();
    private readonly WaveFormat captureFormat;
    private readonly WaveFormat floatFormat;
    private readonly BufferedWaveProvider buffer;
    private readonly int targetBufferedBytes;
    private readonly int softTrimThresholdBytes;
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
        softTrimThresholdBytes = targetBufferedBytes + (targetBufferedBytes / 2);

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
        return new LiveEdgeSampleProvider(gate, buffer, floatFormat, softTrimThresholdBytes, targetBufferedBytes);
    }

    private void DiscardOldestBeyond(int maxBytes)
    {
        var excess = buffer.BufferedBytes - maxBytes;
        if (excess <= 0)
        {
            return;
        }

        var maxTrim = Math.Max(
            floatFormat.BlockAlign,
            floatFormat.AverageBytesPerSecond * LatencyTuning.MaxTrimPassMilliseconds / 1000);
        DiscardBytes(Math.Min(excess, maxTrim));
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
    private readonly int softTrimThresholdBytes;
    private readonly int targetBufferedBytes;
    private readonly SampleGapFill gapFill;
    private byte[] readScratch = [];
    private byte[] discardBuffer = [];

    public LiveEdgeSampleProvider(
        object gate,
        BufferedWaveProvider buffer,
        WaveFormat floatFormat,
        int softTrimThresholdBytes,
        int targetBufferedBytes)
    {
        this.gate = gate;
        this.buffer = buffer;
        this.floatFormat = floatFormat;
        this.softTrimThresholdBytes = softTrimThresholdBytes;
        this.targetBufferedBytes = targetBufferedBytes;
        gapFill = new SampleGapFill(Math.Max(1, floatFormat.Channels));
        WaveFormat = floatFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] samples, int offset, int count)
    {
        lock (gate)
        {
            var bytesNeeded = count * sizeof(float);

            // Soft catch-up only when heavily over-buffered — never discard-on-read.
            var available = buffer.BufferedBytes;
            if (available > softTrimThresholdBytes)
            {
                var excess = available - targetBufferedBytes;
                var maxTrim = Math.Max(
                    floatFormat.BlockAlign,
                    floatFormat.AverageBytesPerSecond * LatencyTuning.MaxTrimPassMilliseconds / 1000);
                var drop = Math.Min(excess / 4, maxTrim);
                drop -= drop % floatFormat.BlockAlign;
                if (drop > 0)
                {
                    DiscardBytes(drop);
                }
            }

            if (readScratch.Length < bytesNeeded)
            {
                readScratch = new byte[bytesNeeded];
            }

            var bytesRead = buffer.Read(readScratch, 0, bytesNeeded);
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

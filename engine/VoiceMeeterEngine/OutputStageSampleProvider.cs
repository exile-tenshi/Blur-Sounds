using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Keeps a steady 48 kHz float buffer between the mixer and WASAPI output.
/// </summary>
internal sealed class OutputStageSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly FloatCaptureRing ring;
    private readonly float[] pullScratch;
    private readonly int minBufferedSamples;

    public OutputStageSampleProvider(ISampleProvider mixSource, int bufferMilliseconds = 180)
    {
        source = mixSource;
        WaveFormat = mixSource.WaveFormat;
        var channels = Math.Max(1, WaveFormat.Channels);
        var capacity = Math.Max(
            channels,
            WaveFormat.SampleRate * channels * bufferMilliseconds / 1000);
        ring = new FloatCaptureRing(capacity);
        minBufferedSamples = Math.Max(
            channels,
            WaveFormat.SampleRate * channels * 48 / 1000);
        pullScratch = new float[Math.Max(channels, WaveFormat.SampleRate * channels / 50)];
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        PrimeRing(count);

        var written = 0;
        while (written < count)
        {
            if (ring.BufferedSamples > 0)
            {
                var chunk = Math.Min(count - written, ring.BufferedSamples);
                written += ring.Read(buffer, offset + written, chunk);
                continue;
            }

            var pulled = source.Read(buffer, offset + written, count - written);
            if (pulled <= 0)
            {
                break;
            }

            written += pulled;
        }

        if (written < count)
        {
            Array.Clear(buffer, offset + written, count - written);
        }

        return count;
    }

    private void PrimeRing(int count)
    {
        var target = Math.Max(minBufferedSamples, Math.Min(count, pullScratch.Length));
        while (ring.BufferedSamples < target)
        {
            var requested = Math.Min(pullScratch.Length, target - ring.BufferedSamples);
            var samplesRead = source.Read(pullScratch, 0, requested);
            if (samplesRead <= 0)
            {
                break;
            }

            ring.Write(pullScratch, 0, samplesRead);
        }
    }
}

/// <summary>
/// Upsamples to a studio-rate bind when 48 kHz presentation is unavailable.
/// </summary>
internal sealed class StudioRateOutputSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;

    public StudioRateOutputSampleProvider(ISampleProvider mixSource, int targetSampleRate)
    {
        if (mixSource.WaveFormat.SampleRate == targetSampleRate)
        {
            source = mixSource;
        }
        else
        {
            var stableInput = new FullBlockSampleProvider(mixSource);
            source = new WdlResamplingSampleProvider(stableInput, targetSampleRate);
        }

        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count) => source.Read(buffer, offset, count);
}

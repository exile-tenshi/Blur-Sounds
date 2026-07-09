using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal sealed class DownmixToStereoSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly int sourceChannels;
    private float[] scratch;

    public DownmixToStereoSampleProvider(ISampleProvider source)
    {
        this.source = source;
        sourceChannels = source.WaveFormat.Channels;
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 2);
        scratch = new float[source.WaveFormat.SampleRate];
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        var framesRequested = count / 2;
        var sourceSamplesNeeded = framesRequested * sourceChannels;
        if (scratch.Length < sourceSamplesNeeded)
        {
            Array.Resize(ref scratch, sourceSamplesNeeded);
        }

        var sourceSamplesRead = source.Read(scratch, 0, sourceSamplesNeeded);
        var framesRead = sourceSamplesRead / sourceChannels;
        if (framesRead <= 0)
        {
            Array.Clear(buffer, offset, count);
            return count;
        }

        for (var frame = 0; frame < framesRead; frame++)
        {
            var sourceIndex = frame * sourceChannels;
            if (sourceChannels == 1)
            {
                var mono = scratch[sourceIndex];
                buffer[offset + (frame * 2)] = mono;
                buffer[offset + (frame * 2) + 1] = mono;
                continue;
            }

            var left = 0f;
            var right = 0f;
            for (var channel = 0; channel < sourceChannels; channel++)
            {
                var sample = scratch[sourceIndex + channel];
                if (channel % 2 == 0)
                {
                    left += sample;
                }
                else
                {
                    right += sample;
                }
            }

            var leftCount = (sourceChannels + 1) / 2;
            var rightCount = sourceChannels / 2;
            buffer[offset + (frame * 2)] = left / Math.Max(1, leftCount);
            buffer[offset + (frame * 2) + 1] = right / Math.Max(1, rightCount);
        }

        if (framesRead < framesRequested)
        {
            Array.Clear(buffer, offset + (framesRead * 2), (framesRequested - framesRead) * 2);
        }

        return framesRequested * 2;
    }
}

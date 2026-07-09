using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Tracks peaks from the live mix. Does not modify samples.
/// </summary>
internal sealed class MixPullMeterSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private float peak;

    public MixPullMeterSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public float Peak
    {
        get
        {
            var current = peak;
            peak *= 0.92f;
            return current;
        }
    }

    public int Read(float[] buffer, int offset, int count)
    {
        var samplesRead = source.Read(buffer, offset, count);
        if (samplesRead > 0)
        {
            var next = 0f;
            for (var index = 0; index < samplesRead; index++)
            {
                next = Math.Max(next, Math.Abs(buffer[offset + index]));
            }

            peak = AudioLevelUtility.ApplyDecay(peak, next);
        }

        if (samplesRead < count)
        {
            Array.Clear(buffer, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
        }

        return count;
    }
}

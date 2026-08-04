using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Outputs silence while muted, but still drains the source so capture FIFOs
/// cannot inflate to hundreds of milliseconds of stale audio.
/// </summary>
internal sealed class PausedAwareMixInput : ISampleProvider
{
    private readonly Func<bool> isPaused;
    private readonly ISampleProvider source;
    private float[] discardScratch = [];

    public PausedAwareMixInput(Func<bool> isPaused, ISampleProvider source)
    {
        this.isPaused = isPaused;
        this.source = source;
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        if (isPaused())
        {
            if (discardScratch.Length < count)
            {
                discardScratch = new float[count];
            }

            source.Read(discardScratch, 0, count);
            Array.Clear(buffer, offset, count);
            return count;
        }

        return source.Read(buffer, offset, count);
    }
}

using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Outputs silence while muted. Sources are expected to return full blocks already.
/// </summary>
internal sealed class PausedAwareMixInput : ISampleProvider
{
    private readonly Func<bool> isPaused;
    private readonly ISampleProvider source;

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
            Array.Clear(buffer, offset, count);
            return count;
        }

        return source.Read(buffer, offset, count);
    }
}

using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Mix input adapter. CapturePipeline already guarantees full blocks.
/// </summary>
internal sealed class FullBlockSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;

    public FullBlockSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        var read = source.Read(buffer, offset, count);
        if (read < count)
        {
            Array.Clear(buffer, offset + Math.Max(0, read), count - Math.Max(0, read));
        }

        return count;
    }
}

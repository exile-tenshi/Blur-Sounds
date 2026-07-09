using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Volume control for a capture source that already returns full blocks.
/// </summary>
internal sealed class FullBlockVolumeSampleProvider : ISampleProvider
{
    private readonly VolumeSampleProvider volume;

    public FullBlockVolumeSampleProvider(ISampleProvider source, float volume = 1f)
    {
        this.volume = new VolumeSampleProvider(source) { Volume = volume };
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public float Volume
    {
        get => volume.Volume;
        set => volume.Volume = value;
    }

    public int Read(float[] buffer, int offset, int count)
    {
        var read = volume.Read(buffer, offset, count);
        if (read < count)
        {
            Array.Clear(buffer, offset + Math.Max(0, read), count - Math.Max(0, read));
        }

        return count;
    }
}

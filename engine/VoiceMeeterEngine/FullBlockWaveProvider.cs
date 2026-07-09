using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Ensures WASAPI always receives a full buffer. Short reads are zero-padded.
/// </summary>
internal sealed class FullBlockWaveProvider : IWaveProvider
{
    private readonly IWaveProvider source;

    public FullBlockWaveProvider(IWaveProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(byte[] buffer, int offset, int count)
    {
        var bytesRead = source.Read(buffer, offset, count);
        if (bytesRead < count)
        {
            Array.Clear(buffer, offset + Math.Max(0, bytesRead), count - Math.Max(0, bytesRead));
            bytesRead = count;
        }

        return bytesRead;
    }
}

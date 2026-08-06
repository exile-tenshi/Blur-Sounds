using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Pass-through wave provider that updates <see cref="OutputPullMeter"/> from real PCM bytes.
/// </summary>
internal sealed class PeakReportingWaveProvider : IWaveProvider
{
    private readonly IWaveProvider source;

    public PeakReportingWaveProvider(IWaveProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(byte[] buffer, int offset, int count)
    {
        var read = source.Read(buffer, offset, count);
        if (read > 0)
        {
            if (offset == 0)
            {
                OutputPullMeter.ReportPeak(buffer, read, WaveFormat);
            }
            else
            {
                var slice = new byte[read];
                Buffer.BlockCopy(buffer, offset, slice, 0, read);
                OutputPullMeter.ReportPeak(slice, read, WaveFormat);
            }
        }

        return read;
    }
}

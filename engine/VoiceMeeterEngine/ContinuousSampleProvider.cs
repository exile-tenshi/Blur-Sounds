using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Always returns the requested sample count. Short reads hold the last frame.
/// </summary>
internal sealed class ContinuousSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly SampleGapFill gapFill;

    public ContinuousSampleProvider(ISampleProvider source)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        gapFill = new SampleGapFill(Math.Max(1, WaveFormat.Channels));
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        var samplesRead = source.Read(buffer, offset, count);
        if (samplesRead > 0)
        {
            gapFill.NoteSamplesRead(buffer, offset, samplesRead);
        }

        if (samplesRead < count)
        {
            gapFill.FillGap(buffer, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
        }

        return count;
    }
}

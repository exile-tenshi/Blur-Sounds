namespace VoiceMeeterEngine;

/// <summary>
/// Fills short reads by holding the last good frame (not silence) to avoid bitrattling clicks.
/// </summary>
internal sealed class SampleGapFill
{
    private readonly int channels;
    private readonly float[] lastFrame;
    private long underrunCount;

    public SampleGapFill(int channels)
    {
        this.channels = Math.Max(1, channels);
        lastFrame = new float[this.channels];
    }

    public long UnderrunCount => underrunCount;

    public void Reset()
    {
        Array.Clear(lastFrame, 0, lastFrame.Length);
    }

    public void NoteSamplesRead(float[] buffer, int offset, int samplesRead)
    {
        if (samplesRead <= 0)
        {
            return;
        }

        var framesRead = samplesRead / channels;
        var frameStart = offset + Math.Max(0, framesRead - 1) * channels;
        for (var channel = 0; channel < channels; channel++)
        {
            lastFrame[channel] = buffer[frameStart + channel];
        }
    }

    public void FillGap(float[] buffer, int offset, int count)
    {
        if (count <= 0)
        {
            return;
        }

        underrunCount++;
        for (var index = 0; index < count; index++)
        {
            buffer[offset + index] = lastFrame[index % channels];
        }
    }
}

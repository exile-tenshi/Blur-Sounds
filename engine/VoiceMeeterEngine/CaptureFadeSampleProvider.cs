using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Fades a capture source in when it joins the mix and supports a short fade-out before removal.
/// </summary>
internal sealed class CaptureFadeSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly int fadeInSamples;
    private readonly int fadeOutSamples;
    private readonly int channels;
    private readonly float[] lastFrame;
    private int fadeInPosition;
    private int fadeOutPosition = -1;

    public CaptureFadeSampleProvider(ISampleProvider source, int fadeInMilliseconds, int fadeOutMilliseconds)
    {
        this.source = source;
        var sampleRate = Math.Max(1, source.WaveFormat.SampleRate);
        fadeInSamples = Math.Max(1, sampleRate * fadeInMilliseconds / 1000);
        fadeOutSamples = Math.Max(1, sampleRate * fadeOutMilliseconds / 1000);
        channels = Math.Max(1, source.WaveFormat.Channels);
        lastFrame = new float[channels];
        WaveFormat = source.WaveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public void BeginFadeOut()
    {
        if (fadeOutPosition < 0)
        {
            fadeOutPosition = 0;
        }
    }

    public bool IsFadeOutComplete => fadeOutPosition >= 0 && fadeOutPosition >= fadeOutSamples;

    public int Read(float[] buffer, int offset, int count)
    {
        var samplesRead = source.Read(buffer, offset, count);
        if (samplesRead <= 0)
        {
            HoldLastFrame(buffer, offset, count);
            return count;
        }

        for (var index = 0; index < samplesRead; index++)
        {
            buffer[offset + index] *= ComputeGain();
        }

        var framesRead = samplesRead / channels;
        var frameStart = offset + Math.Max(0, framesRead - 1) * channels;
        for (var channel = 0; channel < channels; channel++)
        {
            lastFrame[channel] = buffer[frameStart + channel];
        }

        if (samplesRead < count)
        {
            HoldLastFrame(buffer, offset + samplesRead, count - samplesRead);
        }

        return count;
    }

    private void HoldLastFrame(float[] buffer, int offset, int count)
    {
        for (var index = 0; index < count; index++)
        {
            buffer[offset + index] = lastFrame[index % channels];
        }
    }

    private float ComputeGain()
    {
        if (fadeOutPosition >= 0)
        {
            var gain = 1f - fadeOutPosition / (float)fadeOutSamples;
            fadeOutPosition += 1;
            return Math.Max(0f, gain);
        }

        if (fadeInPosition < fadeInSamples)
        {
            fadeInPosition += 1;
            return fadeInPosition / (float)fadeInSamples;
        }

        return 1f;
    }
}

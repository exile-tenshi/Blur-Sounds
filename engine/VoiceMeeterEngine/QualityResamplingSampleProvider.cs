using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// High-quality sample-rate conversion for capture and output paths.
/// </summary>
internal sealed class QualityResamplingSampleProvider : ISampleProvider
{
    private const int ResamplerQuality = 60;

    private readonly MediaFoundationResampler resampler;
    private byte[] byteBuffer = [];
    private float[] floatScratch = [];

    public QualityResamplingSampleProvider(ISampleProvider source, int outputSampleRate)
    {
        var channels = Math.Max(1, source.WaveFormat.Channels);
        var sourceWave = new SampleToWaveProvider(source);
        var targetFormat = WaveFormat.CreateIeeeFloatWaveFormat(outputSampleRate, channels);
        resampler = new MediaFoundationResampler(sourceWave, targetFormat)
        {
            ResamplerQuality = ResamplerQuality,
        };
        WaveFormat = targetFormat;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(float[] buffer, int offset, int count)
    {
        if (count <= 0)
        {
            return 0;
        }

        var bytesNeeded = count * sizeof(float);
        if (byteBuffer.Length < bytesNeeded)
        {
            byteBuffer = new byte[bytesNeeded];
        }

        var bytesRead = resampler.Read(byteBuffer, 0, bytesNeeded);
        var samplesRead = bytesRead > 0 ? bytesRead / sizeof(float) : 0;

        if (samplesRead > 0)
        {
            if (floatScratch.Length < samplesRead)
            {
                floatScratch = new float[samplesRead];
            }

            Buffer.BlockCopy(byteBuffer, 0, floatScratch, 0, bytesRead);
            Array.Copy(floatScratch, 0, buffer, offset, samplesRead);
        }

        if (samplesRead < count)
        {
            Array.Clear(buffer, offset + Math.Max(0, samplesRead), count - Math.Max(0, samplesRead));
        }

        return count;
    }
}

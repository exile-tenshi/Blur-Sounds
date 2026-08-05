using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Float-to-PCM conversion for Hi-Fi Cable output (packed 24-bit or 24-in-32 container).
/// </summary>
internal sealed class Pcm24WaveProvider : IWaveProvider
{
    private const int Pcm24Max = 8388607;
    private const int Pcm24Min = -8388608;

    private readonly ISampleProvider source;
    private readonly int bytesPerSample;
    private readonly int bytesPerFrame;
    private readonly float pcmScale;
    private float[]? floatBuffer;

    public Pcm24WaveProvider(ISampleProvider source, WaveFormat pcmFormat)
    {
        this.source = source;
        WaveFormat = pcmFormat;
        bytesPerSample = Math.Max(1, pcmFormat.BlockAlign / Math.Max(1, pcmFormat.Channels));
        bytesPerFrame = Math.Max(1, pcmFormat.BlockAlign);
        pcmScale = WaveFormatUtility.GetEffectiveBitsPerSample(pcmFormat) >= 24 ? Pcm24Max : 32767f;
    }

    public WaveFormat WaveFormat { get; }

    public int Read(byte[] buffer, int offset, int count)
    {
        var framesRequested = count / bytesPerFrame;
        if (framesRequested <= 0)
        {
            return 0;
        }

        var samplesRequested = framesRequested * WaveFormat.Channels;
        if (floatBuffer is null || floatBuffer.Length < samplesRequested)
        {
            floatBuffer = new float[samplesRequested];
        }

        var samplesRead = source.Read(floatBuffer, 0, samplesRequested);
        if (samplesRead < samplesRequested)
        {
            Array.Clear(floatBuffer, Math.Max(0, samplesRead), samplesRequested - Math.Max(0, samplesRead));
        }

        var writeOffset = offset;
        for (var frame = 0; frame < framesRequested; frame++)
        {
            for (var channel = 0; channel < WaveFormat.Channels; channel++)
            {
                var sample = floatBuffer[(frame * WaveFormat.Channels) + channel];
                if (float.IsNaN(sample) || float.IsInfinity(sample))
                {
                    sample = 0f;
                }

                var pcm = (int)Math.Round(Math.Clamp(sample, -1f, 1f) * pcmScale);
                pcm = Math.Clamp(pcm, Pcm24Min, Pcm24Max);
                WritePcm24Sample(buffer, ref writeOffset, pcm);
            }
        }

        return count;
    }

    private void WritePcm24Sample(byte[] buffer, ref int writeOffset, int pcm)
    {
        if (bytesPerSample >= 4)
        {
            buffer[writeOffset++] = (byte)(pcm & 0xFF);
            buffer[writeOffset++] = (byte)((pcm >> 8) & 0xFF);
            buffer[writeOffset++] = (byte)((pcm >> 16) & 0xFF);
            buffer[writeOffset++] = 0;
            return;
        }

        buffer[writeOffset++] = (byte)(pcm & 0xFF);
        buffer[writeOffset++] = (byte)((pcm >> 8) & 0xFF);
        buffer[writeOffset++] = (byte)((pcm >> 16) & 0xFF);
    }
}

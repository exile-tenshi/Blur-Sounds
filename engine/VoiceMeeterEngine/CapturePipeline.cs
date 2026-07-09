using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal static class CapturePipeline
{
    public static ISampleProvider Build(
        FifoCaptureBuffer captureBuffer,
        WaveFormat captureFormat,
        WaveFormat mixFormat,
        bool comfortCapture = false)
    {
        return Build(captureBuffer.CreateReader(), captureFormat, mixFormat);
    }

    public static ISampleProvider Build(
        LiveEdgeCaptureBuffer captureBuffer,
        WaveFormat captureFormat,
        WaveFormat mixFormat,
        bool comfortCapture = false)
    {
        return Build(captureBuffer.CreateReader(), captureFormat, mixFormat);
    }

    public static ISampleProvider Build(
        SmoothCaptureBuffer captureBuffer,
        WaveFormat captureFormat,
        WaveFormat mixFormat,
        bool comfortCapture = false)
    {
        return Build(captureBuffer.CreateReader(), captureFormat, mixFormat);
    }

    private static ISampleProvider Build(
        ISampleProvider provider,
        WaveFormat captureFormat,
        WaveFormat mixFormat)
    {
        if (captureFormat.Channels == 1 && mixFormat.Channels == 2)
        {
            provider = new MonoToStereoSampleProvider(provider);
        }
        else if (captureFormat.Channels > 2 && mixFormat.Channels == 2)
        {
            provider = new DownmixToStereoSampleProvider(provider);
        }

        if (provider.WaveFormat.SampleRate != mixFormat.SampleRate)
        {
            provider = new FullBlockSampleProvider(
                new WdlResamplingSampleProvider(provider, mixFormat.SampleRate));
        }

        return provider;
    }
}

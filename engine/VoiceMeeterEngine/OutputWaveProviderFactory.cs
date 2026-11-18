using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal static class OutputWaveProviderFactory
{
    public static IWaveProvider Create(ISampleProvider source, WaveFormat outputFormat)
    {
        ISampleProvider aligned = source;

        if (aligned.WaveFormat.Channels == 1 && outputFormat.Channels == 2)
        {
            aligned = new MonoToStereoSampleProvider(aligned);
        }
        else if (aligned.WaveFormat.Channels == 2 && outputFormat.Channels == 1)
        {
            aligned = new StereoToMonoSampleProvider(aligned);
        }

        if (aligned.WaveFormat.SampleRate != outputFormat.SampleRate)
        {
            aligned = new StudioRateOutputSampleProvider(aligned, outputFormat.SampleRate);
        }

        if (WaveFormatUtility.IsFloatFormat(outputFormat) &&
            aligned.WaveFormat.SampleRate == outputFormat.SampleRate &&
            aligned.WaveFormat.Channels == outputFormat.Channels)
        {
            return new SampleToWaveProvider(aligned);
        }

        if (WaveFormatUtility.IsPcmFormat(outputFormat) &&
            WaveFormatUtility.GetEffectiveBitsPerSample(outputFormat) == 16 &&
            aligned.WaveFormat.SampleRate == outputFormat.SampleRate &&
            aligned.WaveFormat.Channels == outputFormat.Channels)
        {
            return new SampleToWaveProvider16(aligned);
        }

        if (WaveFormatUtility.IsPcmFormat(outputFormat) &&
            WaveFormatUtility.GetEffectiveBitsPerSample(outputFormat) >= 24 &&
            aligned.WaveFormat.SampleRate == outputFormat.SampleRate &&
            aligned.WaveFormat.Channels == outputFormat.Channels)
        {
            return new Pcm24WaveProvider(aligned, outputFormat);
        }

        // Never ship IEEE float bytes under a PCM WaveFormat — that sounds like bitrattling.
        if (WaveFormatUtility.IsPcmFormat(outputFormat))
        {
            return new Pcm24WaveProvider(aligned, outputFormat);
        }

        return new SampleToWaveProvider(aligned);
    }
}

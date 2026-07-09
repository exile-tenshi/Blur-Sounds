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

        if (WaveFormatUtility.IsFloatFormat(outputFormat) &&
            aligned.WaveFormat.SampleRate == outputFormat.SampleRate &&
            aligned.WaveFormat.Channels == outputFormat.Channels)
        {
            return new SampleToWaveProvider(aligned);
        }

        if (WaveFormatUtility.IsPcmFormat(outputFormat) &&
            WaveFormatUtility.GetEffectiveBitsPerSample(outputFormat) >= 24 &&
            aligned.WaveFormat.SampleRate == outputFormat.SampleRate &&
            aligned.WaveFormat.Channels == outputFormat.Channels)
        {
            return new Pcm24WaveProvider(aligned, outputFormat);
        }

        if (WaveFormatUtility.IsPcmFormat(outputFormat) &&
            WaveFormatUtility.GetEffectiveBitsPerSample(outputFormat) == 16)
        {
            return new SampleToWaveProvider16(aligned);
        }

        return new SampleToWaveProvider(aligned);
    }
}

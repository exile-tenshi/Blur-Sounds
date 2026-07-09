using NAudio.Wave;



namespace VoiceMeeterEngine;



/// <summary>

/// Preferred WASAPI output formats for Hi-Fi Cable and other playback endpoints.

/// </summary>

internal static class HifiCableOutputFormat

{

    public static IReadOnlyList<WaveFormat> GetPreferredFormats(string? deviceName)

    {

        if (HifiCableFormat.IsHifiCableDevice(deviceName))

        {

            return
            [
                HifiCableWaveFormats.StreamPcmExtensible,
                HifiCableWaveFormats.StreamPcmPacked,
                HifiCableWaveFormats.StreamFloat,
            ];

        }



        return

        [

            CreatePcm(96000, 24),

            CreatePcm(48000, 24),

            HifiCableFormat.StandardPcmOutputFormat,

        ];

    }



    public static string DescribeFormat(WaveFormat format)

    {

        return $"{format.SampleRate} Hz, {WaveFormatUtility.GetEffectiveBitsPerSample(format)}-bit stereo";

    }



    public static string GetSetupQualityHint(string? deviceName)

    {

        if (HifiCableFormat.IsHifiCableDevice(deviceName))

        {

            return HifiCableFormat.HiFiDescription;

        }



        return HifiCableFormat.StandardDescription;

    }



    private static WaveFormat CreatePcm(int sampleRate, int bitsPerSample)

    {

        return new WaveFormat(sampleRate, bitsPerSample, HifiCableFormat.MaxChannels);

    }

}



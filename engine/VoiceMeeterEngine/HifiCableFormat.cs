using System.Text.RegularExpressions;

using NAudio.Wave;



namespace VoiceMeeterEngine;



/// <summary>

/// Audio format limits and Hi-Fi Cable device detection.

/// </summary>

internal static partial class HifiCableFormat

{

    public const int StandardSampleRate = 48000;

    public const int StandardBitsPerSample = 16;

    public const int MaxChannels = 2;

    public const int MinEventMilliseconds = 10;

    public const int HiFiMaxSampleRate = 384000;

    public const int HiFiMaxBitsPerSample = 24;



    /// <summary>Studio sample rate for VB-Audio Hi-Fi Cable marketing max.</summary>

    public const int HiFiEngineSampleRate = HiFiMaxSampleRate;

    /// <summary>Rate used for capture, mix, and WASAPI bind — no sample-rate conversion.</summary>

    public const int EngineCleanSampleRate = StandardSampleRate;



    /// <summary>Bit depth for Hi-Fi Cable endpoints and WASAPI output.</summary>

    public const int HiFiEngineBitsPerSample = HiFiMaxBitsPerSample;



    public const int MinEventFrames = StandardSampleRate * MinEventMilliseconds / 1000;



    public const int HiFiMinEventFrames = HiFiEngineSampleRate * MinEventMilliseconds / 1000;



    public static WaveFormat StandardMixFormat { get; } =

        WaveFormat.CreateIeeeFloatWaveFormat(StandardSampleRate, MaxChannels);



    public static WaveFormat HiFiMixFormat { get; } =

        WaveFormat.CreateIeeeFloatWaveFormat(HiFiEngineSampleRate, MaxChannels);



    public static WaveFormat StandardPcmOutputFormat { get; } =

        new(StandardSampleRate, StandardBitsPerSample, MaxChannels);



    public static WaveFormat HiFiPcmOutputFormat { get; } = HifiCableWaveFormats.StudioPcmExtensible;



    public static string StandardDescription => $"{StandardSampleRate} Hz, {StandardBitsPerSample}-bit stereo";



    public static string HiFiDescription =>

        $"{HiFiEngineSampleRate} Hz, {HiFiEngineBitsPerSample}-bit stereo (Studio Quality)";

    public static string EngineCleanDescription =>

        $"{EngineCleanSampleRate} Hz, {HiFiEngineBitsPerSample}-bit stereo (Clean audio)";



    public static bool IsHifiCableDevice(string? deviceName)

    {

        if (string.IsNullOrWhiteSpace(deviceName))

        {

            return false;

        }



        var normalized = deviceName.Trim();

        return HiFiCablePattern().IsMatch(normalized) &&

               normalized.Contains("CABLE", StringComparison.OrdinalIgnoreCase);

    }



    public static bool IsStudioQualityFormat(WaveFormat format)

    {

        return format.SampleRate == HiFiEngineSampleRate &&

               format.BitsPerSample >= HiFiEngineBitsPerSample &&

               format.Channels == MaxChannels;

    }

    public static bool IsEngineCleanFormat(WaveFormat format)

    {

        return format.SampleRate == EngineCleanSampleRate &&

               format.Channels == MaxChannels &&

               format.BitsPerSample >= HiFiEngineBitsPerSample;

    }



    public static string DescribeDeviceFormat(WaveFormat format)

    {

        if (IsStudioQualityFormat(format))

        {

            return $"{HiFiEngineBitsPerSample} bit, {HiFiEngineSampleRate} Hz (Studio Quality)";

        }



        return $"{format.BitsPerSample} bit, {format.SampleRate} Hz";

    }



    public static void ValidateOutputFormat(WaveFormat format, string? deviceName = null)

    {

        var maxSampleRate = IsHifiCableDevice(deviceName) ? HiFiMaxSampleRate : StandardSampleRate;

        var maxBits = IsHifiCableDevice(deviceName) ? HiFiMaxBitsPerSample : StandardBitsPerSample;



        if (format.SampleRate > maxSampleRate)

        {

            throw new NotSupportedException(

                $"Output supports up to {maxSampleRate} Hz. Device format is {format.SampleRate} Hz.");

        }



        if (format.BitsPerSample > maxBits)

        {

            throw new NotSupportedException(

                $"Output supports up to {maxBits}-bit PCM. Device format is {format.BitsPerSample}-bit.");

        }



        if (format.Channels > MaxChannels)

        {

            throw new NotSupportedException(

                $"Output supports up to {MaxChannels} channels. Device format is {format.Channels} channels.");

        }

    }



    [GeneratedRegex(@"hi-?fi", RegexOptions.IgnoreCase)]

    private static partial Regex HiFiCablePattern();

}



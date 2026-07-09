using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Hi-Fi Cable studio device format vs engine processing/streaming rates.
/// </summary>
internal static class HifiStreamingPolicy
{
    public const int DeviceSampleRate = HifiCableFormat.HiFiEngineSampleRate;
    public const int DeviceBitsPerSample = HifiCableFormat.HiFiEngineBitsPerSample;
    public const int EngineMixSampleRate = HifiCableFormat.StandardSampleRate;

    public static WaveFormat EngineMixFormat { get; } = HifiCableFormat.StandardMixFormat;

    /// <summary>48 kHz float mix presented to the output upsampler.</summary>
    public static WaveFormat WasapiStreamFormat { get; } = HifiCableFormat.StandardMixFormat;

    /// <summary>384 kHz · 24-bit PCM — rate-matched WASAPI bind (one engine upsample, no Windows SRC).</summary>
    public static WaveFormat DevicePcmFormat { get; } = HifiCableFormat.HiFiPcmOutputFormat;

    public static WaveFormat GetMixFormat(string? outputDeviceName) =>
        HifiCableFormat.IsHifiCableDevice(outputDeviceName)
            ? EngineMixFormat
            : HifiCableFormat.StandardMixFormat;

    public static bool ShouldUpsampleToDevice(WaveFormat outputFormat) =>
        outputFormat.SampleRate == DeviceSampleRate &&
        WaveFormatUtility.GetEffectiveBitsPerSample(outputFormat) >= DeviceBitsPerSample;

    public static string Describe() =>
        $"device {HifiCableFormat.EngineCleanSampleRate} Hz · {DeviceBitsPerSample}-bit, engine {EngineMixSampleRate} Hz float (no SRC)";
}

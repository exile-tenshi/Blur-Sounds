using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class EngineAudioFormat
{
    public const int StandardSampleRate = HifiCableFormat.StandardSampleRate;
    public const int CaptureSampleRate = StandardSampleRate;
    public const int BitsPerSample = HifiCableFormat.HiFiEngineBitsPerSample;
    public const int Channels = HifiCableFormat.MaxChannels;

    /// <summary>Internal mix and WASAPI stream rate (48 kHz IEEE float).</summary>
    public const int SampleRate = HifiStreamingPolicy.EngineMixSampleRate;

    public static WaveFormat StandardMixFormat { get; } = HifiStreamingPolicy.EngineMixFormat;

    public static WaveFormat HiFiMixFormat { get; } = HifiStreamingPolicy.EngineMixFormat;

    public static WaveFormat PcmOutputFormat { get; } = HifiCableFormat.HiFiPcmOutputFormat;

    public static string Description => HifiStreamingPolicy.Describe();

    public static WaveFormat MixFormat => HifiStreamingPolicy.EngineMixFormat;

    public static WaveFormat GetMixFormat(string? outputDeviceName) =>
        HifiStreamingPolicy.GetMixFormat(outputDeviceName);

    public static int GetOutputSampleRate(string? outputDeviceName) =>
        HifiCableFormat.IsHifiCableDevice(outputDeviceName)
            ? HifiStreamingPolicy.EngineMixSampleRate
            : StandardSampleRate;

    public static int GetSampleRate(string? outputDeviceName) => GetOutputSampleRate(outputDeviceName);

    public static int GetCaptureSampleRate(string? outputDeviceName) => CaptureSampleRate;

    public static bool IsHiFiMixRate(int sampleRate) =>
        sampleRate == HifiStreamingPolicy.EngineMixSampleRate;
}

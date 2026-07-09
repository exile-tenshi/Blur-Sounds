using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// WASAPI formats for Hi-Fi Cable (24-bit PCM; engine mixes at 48 kHz).
/// </summary>
internal static class HifiCableWaveFormats
{
    /// <summary>Primary bind: 48 kHz · 24-bit PCM — Windows converts to the 384 kHz studio device.</summary>
    public static WaveFormat StreamPcmExtensible { get; } = new WaveFormatExtensible(
        HifiCableFormat.StandardSampleRate,
        HifiCableFormat.HiFiEngineBitsPerSample,
        HifiCableFormat.MaxChannels);

    /// <summary>48 kHz packed 24-bit PCM fallback.</summary>
    public static WaveFormat StreamPcmPacked { get; } = new(
        HifiCableFormat.StandardSampleRate,
        HifiCableFormat.HiFiEngineBitsPerSample,
        HifiCableFormat.MaxChannels);

    /// <summary>384 kHz · 24-bit extensible — only when rate-matched bind is required.</summary>
    public static WaveFormat StudioPcmExtensible { get; } = new WaveFormatExtensible(
        HifiCableFormat.HiFiEngineSampleRate,
        HifiCableFormat.HiFiEngineBitsPerSample,
        HifiCableFormat.MaxChannels);

    /// <summary>384 kHz packed 24-bit PCM fallback.</summary>
    public static WaveFormat StudioPcmPacked { get; } = new(
        HifiCableFormat.HiFiEngineSampleRate,
        HifiCableFormat.HiFiEngineBitsPerSample,
        HifiCableFormat.MaxChannels);

    public static WaveFormat StreamFloat { get; } = HifiCableFormat.StandardMixFormat;

    /// <summary>384 kHz IEEE float — rate-matched bind with engine upsample.</summary>
    public static WaveFormat StudioFloat { get; } = HifiCableFormat.HiFiMixFormat;
}

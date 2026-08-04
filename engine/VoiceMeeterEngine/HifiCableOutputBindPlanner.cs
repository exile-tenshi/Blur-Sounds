using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

internal readonly record struct WasapiBindAttempt(
    AudioClientShareMode ShareMode,
    WaveFormat Format,
    bool UseEventSync,
    bool AllowAutoConvert);

internal static class HifiCableOutputBindPlanner
{
    public static IReadOnlyList<WasapiBindAttempt> GetAttempts(MMDevice device, string deviceName)
    {
        var attempts = new List<WasapiBindAttempt>();
        var isHiFiTarget = HifiCableFormat.IsHifiCableDevice(deviceName);

        if (!isHiFiTarget)
        {
            foreach (var format in HifiCableOutputFormat.GetPreferredFormats(deviceName))
            {
                attempts.Add(new WasapiBindAttempt(AudioClientShareMode.Shared, format, true, true));
            }

            return attempts;
        }

        var mixRate = 0;
        try
        {
            mixRate = device.AudioClient.MixFormat.SampleRate;
        }
        catch
        {
            // MixFormat unavailable — fall through to 48 kHz attempts.
        }

        // When MixFormat is already 48 kHz, only bind at 48 kHz. Opening Input at 48 kHz
        // while Output stays at 384 kHz (or the reverse) is silent on bit-perfect Hi-Fi Cable.
        if (mixRate == HifiStreamingPolicy.EngineMixSampleRate || mixRate == 0)
        {
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmPacked, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, true);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, true);
            return attempts;
        }

        // Legacy 384 kHz MixFormat — bind at that rate so Input matches Output.
        if (mixRate == HifiStreamingPolicy.DeviceSampleRate)
        {
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmExtensible, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmPacked, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, true, true);
        }

        // Last resort: 48 kHz with Windows SRC (still needs Output at the same rate).
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, true);

        return attempts;
    }

    private static void AddAttempt(
        List<WasapiBindAttempt> attempts,
        AudioClientShareMode shareMode,
        WaveFormat format,
        bool useEventSync,
        bool allowAutoConvert)
    {
        if (attempts.Any(existing =>
                existing.ShareMode == shareMode &&
                existing.UseEventSync == useEventSync &&
                existing.AllowAutoConvert == allowAutoConvert &&
                WaveFormatUtility.MatchesLayout(existing.Format, format)))
        {
            return;
        }

        attempts.Add(new WasapiBindAttempt(shareMode, format, useEventSync, allowAutoConvert));
    }
}

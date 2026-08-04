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
                attempts.Add(new WasapiBindAttempt(AudioClientShareMode.Shared, format, false, true));
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

        // Prefer timer sync + PCM 24-bit first — matches Windows "24 bit, 48000 Hz" MixFormat.
        // Float-without-autoconvert can Initialize oddly on some hosts and write silence.
        if (mixRate == HifiStreamingPolicy.EngineMixSampleRate || mixRate == 0)
        {
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmPacked, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, true);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, false, true);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, true);
            return attempts;
        }

        if (mixRate == HifiStreamingPolicy.DeviceSampleRate)
        {
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmExtensible, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmPacked, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, true);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, true, false);
        }

        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, false, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, true);

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

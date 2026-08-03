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

        // Engine-native 48 kHz float — no upsampling or Windows SRC when the cable matches.
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmPacked, true, false);

        // Fallback if the cable is still at 384 kHz studio rate.
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, true, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmExtensible, true, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmExtensible, false, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmPacked, true, false);

        // Shared-mode with Windows SRC — required when Input/Output formats diverge or
        // PolicyConfig could not force 48 kHz clean audio.
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, true, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmPacked, true, true);

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

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

        WaveFormat? mixFormat = null;
        try
        {
            mixFormat = device.AudioClient.MixFormat;
        }
        catch
        {
            // MixFormat unavailable — fall through to engine formats.
        }

        // Match MixFormat first (shared mode is cleanest this way).
        if (mixFormat is not null && WaveFormatUtility.IsFloatFormat(mixFormat))
        {
            var mixFloat = WaveFormat.CreateIeeeFloatWaveFormat(
                mixFormat.SampleRate,
                Math.Max(1, mixFormat.Channels));
            AddAttempt(attempts, AudioClientShareMode.Shared, mixFloat, false, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, mixFloat, true, false);
            AddAttempt(attempts, AudioClientShareMode.Shared, mixFloat, false, true);
        }

        // Engine-native 48 kHz float — no upsampling when the cable is at clean 48 kHz.
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, true, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamFloat, false, true);

        // Fallback if the cable is still at 384 kHz studio rate.
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, false);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioFloat, false, true);

        // PCM only with AutoConvert as last resorts (WasapiRender can handle these correctly).
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StreamPcmExtensible, false, true);
        AddAttempt(attempts, AudioClientShareMode.Shared, HifiCableWaveFormats.StudioPcmExtensible, false, true);

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

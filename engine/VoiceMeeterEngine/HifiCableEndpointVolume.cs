using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

/// <summary>
/// Windows can leave Hi-Fi Cable Input muted or at 0% — that looks like a dead cable
/// even when Blur Sounds is writing PCM. Unmute playback endpoints; for recording
/// endpoints only clear mute (do not force 100%, or Windows Listen-through gets loud).
/// </summary>
internal static class HifiCableEndpointVolume
{
    public static void EnsureAudible(MMDevice device) => EnsurePlaybackAudible(device);

    public static void EnsurePlaybackAudible(MMDevice device)
    {
        try
        {
            var volume = device.AudioEndpointVolume;
            if (volume.Mute)
            {
                volume.Mute = false;
            }

            if (volume.MasterVolumeLevelScalar < 0.95f)
            {
                volume.MasterVolumeLevelScalar = 1f;
            }
        }
        catch
        {
            // Endpoint volume APIs can fail while another client holds exclusive mode.
        }
    }

    /// <summary>
    /// Keep-alive / capture side: unmute only. Forcing 100% on Hi-Fi Cable Output
    /// makes Windows "Listen to this device" blast the mix through speakers.
    /// </summary>
    public static void EnsureCaptureUnmuted(MMDevice device)
    {
        try
        {
            var volume = device.AudioEndpointVolume;
            if (volume.Mute)
            {
                volume.Mute = false;
            }
        }
        catch
        {
            // Endpoint volume APIs can fail while another client holds exclusive mode.
        }
    }
}

using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

/// <summary>
/// Windows can leave Hi-Fi Cable Input/Output muted or at 0% — that looks like a dead cable
/// even when Blur Sounds is writing PCM. Force the endpoint open and audible.
/// </summary>
internal static class HifiCableEndpointVolume
{
    public static void EnsureAudible(MMDevice device)
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
}

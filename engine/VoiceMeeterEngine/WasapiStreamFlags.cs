using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

/// <summary>
/// WASAPI stream flag helpers.
/// </summary>
internal static class WasapiStreamFlags
{
    // AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY — required alongside AUTOCONVERTPCM on modern Windows.
    private const AudioClientStreamFlags SrcDefaultQuality =
        (AudioClientStreamFlags)0x08000000;

    public static AudioClientStreamFlags ForSharedCapture(bool useAutoConvert, bool useEventSync)
    {
        var flags = AudioClientStreamFlags.None;
        if (useAutoConvert)
        {
            flags |= AudioClientStreamFlags.AutoConvertPcm | SrcDefaultQuality;
        }

        if (useEventSync)
        {
            flags |= AudioClientStreamFlags.EventCallback;
        }

        return flags;
    }

    public static AudioClientStreamFlags ForSharedRender(bool allowAutoConvert, bool useEventSync)
    {
        var flags = AudioClientStreamFlags.None;
        if (allowAutoConvert)
        {
            flags |= AudioClientStreamFlags.AutoConvertPcm | SrcDefaultQuality;
        }

        if (useEventSync)
        {
            flags |= AudioClientStreamFlags.EventCallback;
        }

        return flags;
    }

    public static AudioClientStreamFlags ForProcessLoopback(bool useEventSync)
    {
        var flags = AudioClientStreamFlags.Loopback | AudioClientStreamFlags.AutoConvertPcm;
        if (useEventSync)
        {
            flags |= AudioClientStreamFlags.EventCallback;
        }

        return flags;
    }
}

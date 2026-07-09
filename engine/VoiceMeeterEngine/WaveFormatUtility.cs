using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class WaveFormatUtility
{
    private static readonly Guid IeeeFloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");
    private static readonly Guid PcmSubFormat = new("00000001-0000-0010-8000-00aa00389b71");

    public static bool IsFloatFormat(WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            return true;
        }

        return format is WaveFormatExtensible extensible && extensible.SubFormat == IeeeFloatSubFormat;
    }

    public static bool IsPcmFormat(WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.Pcm)
        {
            return true;
        }

        return format is WaveFormatExtensible extensible && extensible.SubFormat == PcmSubFormat;
    }

    public static int GetEffectiveBitsPerSample(WaveFormat format)
    {
        if (IsPcmFormat(format))
        {
            var bytesPerSample = format.BlockAlign / Math.Max(1, format.Channels);
            return bytesPerSample switch
            {
                4 => 24,
                3 => 24,
                2 => 16,
                _ => format.BitsPerSample,
            };
        }

        return format.BitsPerSample;
    }

    public static bool MatchesLayout(WaveFormat left, WaveFormat right)
    {
        if (left.SampleRate != right.SampleRate || left.Channels != right.Channels)
        {
            return false;
        }

        if (left.BitsPerSample == right.BitsPerSample && left.Encoding == right.Encoding)
        {
            return true;
        }

        if (left is WaveFormatExtensible leftExtensible && right is WaveFormatExtensible rightExtensible)
        {
            return leftExtensible.SubFormat == rightExtensible.SubFormat &&
                   leftExtensible.BitsPerSample == rightExtensible.BitsPerSample;
        }

        return false;
    }
}

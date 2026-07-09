using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class AudioLevelUtility
{
    public static float ComputePeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        if (bytesRecorded <= 0)
        {
            return 0f;
        }

        return CaptureFormatConverter.GetSampleEncoding(format) switch
        {
            WaveFormatEncoding.IeeeFloat => ComputeFloatPeak(buffer, bytesRecorded),
            WaveFormatEncoding.Pcm when format.BitsPerSample == 16 => ComputePcm16Peak(buffer, bytesRecorded),
            WaveFormatEncoding.Pcm when format.BitsPerSample == 24 && format.BlockAlign / Math.Max(1, format.Channels) >= 4 =>
                ComputePcm24In32Peak(buffer, bytesRecorded, format.BlockAlign),
            WaveFormatEncoding.Pcm when format.BitsPerSample == 24 => ComputePcm24Peak(buffer, bytesRecorded, format.BlockAlign),
            WaveFormatEncoding.Pcm when format.BitsPerSample == 32 => ComputePcm32Peak(buffer, bytesRecorded),
            WaveFormatEncoding.Extensible when WaveFormatUtility.IsFloatFormat(format) =>
                ComputeFloatPeak(buffer, bytesRecorded),
            WaveFormatEncoding.Extensible when WaveFormatUtility.IsPcmFormat(format) =>
                ComputeExtensiblePcmPeak(buffer, bytesRecorded, format),
            _ => 0f,
        };
    }

    private static float ComputeExtensiblePcmPeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        var bytesPerSample = format.BlockAlign / Math.Max(1, format.Channels);
        return bytesPerSample switch
        {
            4 => ComputePcm24In32Peak(buffer, bytesRecorded, format.BlockAlign),
            3 => ComputePcm24Peak(buffer, bytesRecorded, format.BlockAlign),
            2 => ComputePcm16Peak(buffer, bytesRecorded),
            _ => 0f,
        };
    }

    public static float ApplyDecay(float current, float next, float decay = 0.55f)
    {
        return Math.Max(next, current * decay);
    }

    private static float ComputeFloatPeak(byte[] buffer, int bytesRecorded)
    {
        var max = 0f;

        for (var index = 0; index + 3 < bytesRecorded; index += 4)
        {
            var sample = Math.Abs(BitConverter.ToSingle(buffer, index));
            if (sample > max)
            {
                max = sample;
            }
        }

        return max;
    }

    private static float ComputePcm16Peak(byte[] buffer, int bytesRecorded)
    {
        var max = 0f;

        for (var index = 0; index + 1 < bytesRecorded; index += 2)
        {
            var sample = Math.Abs(BitConverter.ToInt16(buffer, index) / 32768f);
            if (sample > max)
            {
                max = sample;
            }
        }

        return max;
    }

    private static float ComputePcm24Peak(byte[] buffer, int bytesRecorded, int blockAlign)
    {
        var max = 0f;
        var bytesPerSample = 3;

        for (var index = 0; index + bytesPerSample <= bytesRecorded; index += blockAlign)
        {
            var sampleBytes = buffer[index] | (buffer[index + 1] << 8) | (buffer[index + 2] << 16);
            if ((sampleBytes & 0x800000) != 0)
            {
                sampleBytes |= unchecked((int)0xFF000000);
            }

            var sample = Math.Abs(sampleBytes / 8388608f);
            if (sample > max)
            {
                max = sample;
            }
        }

        return max;
    }

    private static float ComputePcm24In32Peak(byte[] buffer, int bytesRecorded, int blockAlign)
    {
        var max = 0f;

        for (var index = 0; index + 3 < bytesRecorded; index += blockAlign)
        {
            var sampleBytes = buffer[index] | (buffer[index + 1] << 8) | (buffer[index + 2] << 16);
            if ((sampleBytes & 0x800000) != 0)
            {
                sampleBytes |= unchecked((int)0xFF000000);
            }

            var sample = Math.Abs(sampleBytes / 8388608f);
            if (sample > max)
            {
                max = sample;
            }
        }

        return max;
    }

    private static float ComputePcm32Peak(byte[] buffer, int bytesRecorded)
    {
        var max = 0f;

        for (var index = 0; index + 3 < bytesRecorded; index += 4)
        {
            var sample = Math.Abs(BitConverter.ToInt32(buffer, index) / 2147483648f);
            if (sample > max)
            {
                max = sample;
            }
        }

        return max;
    }
}

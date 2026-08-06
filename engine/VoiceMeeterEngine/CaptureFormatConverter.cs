using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class CaptureFormatConverter
{
    private static readonly Guid IeeeFloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");
    private static readonly Guid PcmSubFormat = new("00000001-0000-0010-8000-00aa00389b71");

    public static WaveFormat CreateFloatStorageFormat(WaveFormat captureFormat)
    {
        _ = ResolveEncoding(captureFormat);
        return WaveFormat.CreateIeeeFloatWaveFormat(captureFormat.SampleRate, captureFormat.Channels);
    }

    public static WaveFormatEncoding GetSampleEncoding(WaveFormat format) => ResolveEncoding(format);

    public static int ConvertToFloatSamples(
        byte[] source,
        int sourceOffset,
        int sourceByteCount,
        WaveFormat captureFormat,
        float[] destination,
        int destinationOffset)
    {
        if (sourceByteCount <= 0)
        {
            return 0;
        }

        var blockAlign = Math.Max(1, captureFormat.BlockAlign);
        var alignedByteCount = sourceByteCount - (sourceByteCount % blockAlign);
        if (alignedByteCount <= 0)
        {
            return 0;
        }

        return ResolveEncoding(captureFormat) switch
        {
            WaveFormatEncoding.IeeeFloat => ConvertFloatBytes(
                source,
                sourceOffset,
                alignedByteCount,
                destination,
                destinationOffset),
            WaveFormatEncoding.Pcm => ConvertPcmBytes(
                source,
                sourceOffset,
                alignedByteCount,
                captureFormat,
                destination,
                destinationOffset),
            _ => throw new NotSupportedException(
                $"Unsupported capture format: {DescribeFormat(captureFormat)}"),
        };
    }

    private static WaveFormatEncoding ResolveEncoding(WaveFormat format)
    {
        if (format is WaveFormatExtensible extensible)
        {
            if (extensible.SubFormat == IeeeFloatSubFormat)
            {
                return WaveFormatEncoding.IeeeFloat;
            }

            if (extensible.SubFormat == PcmSubFormat)
            {
                return WaveFormatEncoding.Pcm;
            }
        }

        if (format.Encoding == WaveFormatEncoding.Extensible)
        {
            return GuessEncodingFromLayout(format);
        }

        if (format.Encoding is WaveFormatEncoding.IeeeFloat or WaveFormatEncoding.Pcm)
        {
            return format.Encoding;
        }

        throw new NotSupportedException($"Unsupported capture format: {DescribeFormat(format)}");
    }

    private static WaveFormatEncoding GuessEncodingFromLayout(WaveFormat format)
    {
        if (format is WaveFormatExtensible extensible)
        {
            if (extensible.BitsPerSample is 20 or 24 ||
                (extensible.BitsPerSample == 32 && WaveFormatUtility.GetEffectiveBitsPerSample(format) == 24))
            {
                return WaveFormatEncoding.Pcm;
            }
        }

        var channels = Math.Max(1, format.Channels);
        var bytesPerFrame = Math.Max(1, format.BlockAlign);
        var bytesPerSample = bytesPerFrame / channels;

        return bytesPerSample switch
        {
            4 when format.BitsPerSample == 24 => WaveFormatEncoding.Pcm,
            4 => WaveFormatEncoding.IeeeFloat,
            2 or 3 => WaveFormatEncoding.Pcm,
            _ => throw new NotSupportedException($"Unsupported capture format: {DescribeFormat(format)}"),
        };
    }

    private static string DescribeFormat(WaveFormat format)
    {
        if (format is WaveFormatExtensible extensible)
        {
            return $"{format.Encoding} ({format.BitsPerSample}-bit, {format.Channels} ch, subformat {extensible.SubFormat})";
        }

        return $"{format.Encoding} ({format.BitsPerSample}-bit, {format.Channels} ch)";
    }

    private static int ConvertFloatBytes(
        byte[] source,
        int offset,
        int byteCount,
        float[] destination,
        int destinationOffset)
    {
        var sampleCount = byteCount / 4;
        if (sampleCount > 0)
        {
            Buffer.BlockCopy(source, offset, destination, destinationOffset * sizeof(float), sampleCount * sizeof(float));
        }

        return sampleCount;
    }

    private static int ConvertPcmBytes(
        byte[] source,
        int offset,
        int byteCount,
        WaveFormat format,
        float[] destination,
        int destinationOffset)
    {
        var blockAlign = Math.Max(1, format.BlockAlign);
        var frameCount = byteCount / blockAlign;
        var writeIndex = destinationOffset;

        for (var frame = 0; frame < frameCount; frame++)
        {
            var frameOffset = offset + (frame * blockAlign);

            for (var channel = 0; channel < format.Channels; channel++)
            {
                destination[writeIndex++] = ReadPcmSample(source, frameOffset, channel, format);
            }
        }

        return frameCount * format.Channels;
    }

    private static float ReadPcmSample(byte[] source, int frameOffset, int channel, WaveFormat format)
    {
        var bytesPerChannel = Math.Max(1, format.BlockAlign / Math.Max(1, format.Channels));
        var sampleOffset = frameOffset + (channel * bytesPerChannel);

        return bytesPerChannel switch
        {
            2 => BitConverter.ToInt16(source, sampleOffset) / 32768f,
            3 => ReadPcm24(source, sampleOffset) / 8388608f,
            4 when WaveFormatUtility.GetEffectiveBitsPerSample(format) == 24 =>
                ReadPcm24(source, sampleOffset) / 8388608f,
            4 => BitConverter.ToInt32(source, sampleOffset) / 2147483648f,
            _ => throw new NotSupportedException($"Unsupported PCM sample width: {bytesPerChannel} bytes"),
        };
    }

    private static int ReadPcm24(byte[] source, int offset)
    {
        var sample = source[offset] | (source[offset + 1] << 8) | (source[offset + 2] << 16);
        if ((sample & 0x800000) != 0)
        {
            sample |= unchecked((int)0xFF000000);
        }

        return sample;
    }
}

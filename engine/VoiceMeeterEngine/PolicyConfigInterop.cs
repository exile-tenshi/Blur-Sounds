using System.Runtime.InteropServices;
using NAudio.Wave;

namespace VoiceMeeterEngine;

[ComImport]
[Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
internal class PolicyConfigClient;

[Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig
{
    [PreserveSig]
    int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, out IntPtr formatPointer);

    [PreserveSig]
    int GetDeviceFormat(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        [MarshalAs(UnmanagedType.Bool)] bool isDefault,
        out IntPtr formatPointer);

    [PreserveSig]
    int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId);

    [PreserveSig]
    int SetDeviceFormat(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        IntPtr endpointFormatPointer,
        IntPtr mixFormatPointer);

    [PreserveSig]
    int GetProcessingPeriod(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        [MarshalAs(UnmanagedType.Bool)] bool isDefault,
        out long defaultPeriod,
        out long minimumPeriod);

    [PreserveSig]
    int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ref long period);

    [PreserveSig]
    int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, out int mode);

    [PreserveSig]
    int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ref int mode);

    [PreserveSig]
    int GetPropertyValue(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        [MarshalAs(UnmanagedType.Bool)] bool fxStore,
        ref PolicyPropertyKey key,
        out PolicyPropVariant value);

    [PreserveSig]
    int SetPropertyValue(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        [MarshalAs(UnmanagedType.Bool)] bool fxStore,
        ref PolicyPropertyKey key,
        ref PolicyPropVariant value);

    [PreserveSig]
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);

    [PreserveSig]
    int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, [MarshalAs(UnmanagedType.Bool)] bool visible);
}

[StructLayout(LayoutKind.Sequential)]
internal struct PolicyPropertyKey
{
    public Guid FormatId;
    public int PropertyId;
}

[StructLayout(LayoutKind.Explicit)]
internal struct PolicyPropVariant
{
    [FieldOffset(0)]
    public ushort VariantType;

    [FieldOffset(8)]
    public IntPtr PointerValue;

    [FieldOffset(8)]
    public uint UIntValue;
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
internal struct WaveFormatExtensibleRaw
{
    public ushort FormatTag;
    public ushort Channels;
    public uint SampleRate;
    public uint AverageBytesPerSecond;
    public ushort BlockAlign;
    public ushort BitsPerSample;
    public ushort Size;
    public ushort ValidBitsPerSample;
    public uint ChannelMask;
    public Guid SubFormat;
}

internal static class PolicyConfigInterop
{
    private static readonly Guid PcmSubFormat = new("00000001-0000-0010-8000-00aa00389b71");
    private const int WaveFormatExtensibleTag = 0xFFFE;
    private const uint SpeakerFrontLeft = 0x1;
    private const uint SpeakerFrontRight = 0x2;

    public static IPolicyConfig CreatePolicyConfig()
    {
        return (IPolicyConfig)new PolicyConfigClient();
    }

    public static IntPtr CreateStudioPropertyBlobPointer()
    {
        var pointer = Marshal.AllocHGlobal(HifiCableStudioFormatBlob.RegistryPropertyBlob.Length);
        Marshal.Copy(HifiCableStudioFormatBlob.RegistryPropertyBlob, 0, pointer, HifiCableStudioFormatBlob.RegistryPropertyBlob.Length);
        return pointer;
    }

    public static IEnumerable<IntPtr> CreateStudioFormatPointers(int sampleRate, int validBitsPerSample, int channels)
    {
        yield return CreateStudioPropertyBlobPointer();

        foreach (var pointer in CreateRawStudioFormatPointers(sampleRate, validBitsPerSample, channels))
        {
            yield return pointer;
        }
    }

    private static IEnumerable<IntPtr> CreateRawStudioFormatPointers(int sampleRate, int validBitsPerSample, int channels)
    {
        foreach (var candidate in CreateStudioFormatCandidates(sampleRate, validBitsPerSample, channels))
        {
            var pointer = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatExtensibleRaw>());
            Marshal.StructureToPtr(candidate, pointer, false);
            yield return pointer;
        }
    }

    private static IEnumerable<WaveFormatExtensibleRaw> CreateStudioFormatCandidates(
        int sampleRate,
        int validBitsPerSample,
        int channels)
    {
        yield return CreateExtensibleFormat(sampleRate, validBitsPerSample, channels, containerBits: 32);
        yield return CreateExtensibleFormat(sampleRate, validBitsPerSample, channels, containerBits: 24);
        yield return CreatePcmFormat(sampleRate, validBitsPerSample, channels);
    }

    private static WaveFormatExtensibleRaw CreateExtensibleFormat(
        int sampleRate,
        int validBitsPerSample,
        int channels,
        int containerBits)
    {
        var blockAlign = (ushort)(channels * (containerBits / 8));
        return new WaveFormatExtensibleRaw
        {
            FormatTag = WaveFormatExtensibleTag,
            Channels = (ushort)channels,
            SampleRate = (uint)sampleRate,
            AverageBytesPerSecond = (uint)(sampleRate * blockAlign),
            BlockAlign = blockAlign,
            BitsPerSample = (ushort)containerBits,
            Size = 22,
            ValidBitsPerSample = (ushort)validBitsPerSample,
            ChannelMask = SpeakerFrontLeft | SpeakerFrontRight,
            SubFormat = PcmSubFormat,
        };
    }

    private static WaveFormatExtensibleRaw CreatePcmFormat(int sampleRate, int bitsPerSample, int channels)
    {
        var blockAlign = (ushort)(channels * (bitsPerSample / 8));
        return new WaveFormatExtensibleRaw
        {
            FormatTag = 1,
            Channels = (ushort)channels,
            SampleRate = (uint)sampleRate,
            AverageBytesPerSecond = (uint)(sampleRate * blockAlign),
            BlockAlign = blockAlign,
            BitsPerSample = (ushort)bitsPerSample,
            Size = 0,
            ValidBitsPerSample = 0,
            ChannelMask = 0,
            SubFormat = Guid.Empty,
        };
    }

    public static IntPtr CreateStudioFormatPointer(int sampleRate, int validBitsPerSample, int channels)
    {
        return CreateStudioFormatPointers(sampleRate, validBitsPerSample, channels).First();
    }

    public static void FreeFormatPointer(IntPtr pointer)
    {
        if (pointer != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public static void ThrowOnFailure(int hResult, string action)
    {
        if (hResult < 0)
        {
            throw new InvalidOperationException($"{action} failed (HRESULT 0x{hResult:X8}).");
        }
    }
}

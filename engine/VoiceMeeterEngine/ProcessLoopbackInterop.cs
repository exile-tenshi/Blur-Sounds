using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wasapi.CoreAudioApi.Interfaces;

namespace VoiceMeeterEngine;

internal enum AudioClientActivationType
{
    Default = 0,
    ProcessLoopback = 1,
}

internal enum ProcessLoopbackMode
{
    IncludeTargetProcessTree = 0,
    ExcludeTargetProcessTree = 1,
}

[StructLayout(LayoutKind.Sequential)]
internal struct AudioClientProcessLoopbackParams
{
    public uint TargetProcessId;
    public ProcessLoopbackMode ProcessLoopbackMode;
}

[StructLayout(LayoutKind.Sequential)]
internal struct AudioClientActivationParams
{
    public AudioClientActivationType ActivationType;
    public AudioClientProcessLoopbackParams ProcessLoopbackParams;
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90")]
internal interface IAgileObject
{
}

internal sealed class ActivateAudioInterfaceCompletionHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
{
    private readonly Action<IAudioClient> initializeAction;
    private readonly TaskCompletionSource<IAudioClient> completionSource = new();

    public ActivateAudioInterfaceCompletionHandler(Action<IAudioClient> initializeAction)
    {
        this.initializeAction = initializeAction;
    }

    public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
    {
        activateOperation.GetActivateResult(out var hr, out var activatedInterface);
        if (hr != 0)
        {
            completionSource.TrySetException(Marshal.GetExceptionForHR(hr, new IntPtr(-1)) ?? new COMException($"ActivateAudioInterfaceAsync failed with HRESULT 0x{hr:X8}"));
            return;
        }

        var audioClient = (IAudioClient)activatedInterface;
        try
        {
            initializeAction(audioClient);
            completionSource.SetResult(audioClient);
        }
        catch (Exception ex)
        {
            completionSource.TrySetException(ex);
        }
    }

    public TaskAwaiter<IAudioClient> GetAwaiter() => completionSource.Task.GetAwaiter();
}

internal static class ProcessLoopbackNative
{
    internal const string VirtualAudioDeviceProcessLoopback = "VAD\\Process_Loopback";
    internal static readonly Guid AudioClientInterfaceId = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    internal static extern void ActivateAudioInterfaceAsync(
        [In, MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [In] IntPtr activationParams,
        [In] IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);
}

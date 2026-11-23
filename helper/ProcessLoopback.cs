// Per-application audio capture (Windows 10 2004+ process loopback). No cables needed.
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace Bsp;

public sealed class ProcessCapture : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS { public uint TargetProcessId; public int ProcessLoopbackMode; }
    [StructLayout(LayoutKind.Sequential)] struct AUDIOCLIENT_ACTIVATION_PARAMS { public int ActivationType; public AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams; }
    [StructLayout(LayoutKind.Sequential)] struct BLOB { public int cbSize; public IntPtr pBlobData; }
    [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public BLOB blob; }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }
    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation { void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }
    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

    [ClassInterface(ClassInterfaceType.None)]
    sealed class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEventSlim Done = new(false);
        public IAudioClient Client; public int Hr;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            op.GetActivateResult(out Hr, out var o);
            if (Hr == 0) Client = (IAudioClient)o;
            Done.Set();
        }
    }
    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAgileObject { }

    public readonly int Pid; readonly FloatRing ring; AudioClient client; Thread thread; volatile bool running;
    public string Error; public float Peak;
    public ProcessCapture(int pid, FloatRing ring) { Pid = pid; this.ring = ring; }

    public void Start(bool includeTree = true)
    {
        var p = new AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType = 1, ProcessLoopbackParams = new AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS { TargetProcessId = (uint)Pid, ProcessLoopbackMode = includeTree ? 0 : 1 } };
        int sz = Marshal.SizeOf(p);
        IntPtr pp = Marshal.AllocHGlobal(sz); Marshal.StructureToPtr(p, pp, false);
        var pv = new PROPVARIANT { vt = 65 /*VT_BLOB*/, blob = new BLOB { cbSize = sz, pBlobData = pp } };
        IntPtr ppv = Marshal.AllocHGlobal(Marshal.SizeOf(pv)); Marshal.StructureToPtr(pv, ppv, false);
        var h = new Handler();
        try
        {
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, ppv, h, out _);
            if (!h.Done.Wait(3000)) throw new Exception("activation timeout");
            if (h.Hr != 0) Marshal.ThrowExceptionForHR(h.Hr);
            client = new AudioClient(h.Client);
            var fmt = new WaveFormat(48000, 16, 2);
            // loopback | eventcallback | autoconvert
            client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback | AudioClientStreamFlags.AutoConvertPcm | AudioClientStreamFlags.SrcDefaultQuality, 200000, 0, fmt, Guid.Empty);
        }
        finally { Marshal.FreeHGlobal(pp); Marshal.FreeHGlobal(ppv); }
        running = true;
        thread = new Thread(Loop) { IsBackground = true, Name = "pcap" + Pid };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    void Loop()
    {
        var ev = new EventWaitHandle(false, EventResetMode.AutoReset);
        try
        {
            client.SetEventHandle(ev.SafeWaitHandle.DangerousGetHandle());
            var cap = client.AudioCaptureClient;
            client.Start();
            var fl = new float[48000 * 2];
            while (running)
            {
                ev.WaitOne(100);
                int packet = cap.GetNextPacketSize();
                while (packet > 0)
                {
                    var data = cap.GetBuffer(out int frames, out var flags);
                    int n = frames * 2; if (fl.Length < n) fl = new float[n];
                    float pk = 0;
                    if ((flags & AudioClientBufferFlags.Silent) != 0) Array.Clear(fl, 0, n);
                    else unsafe
                    {
                        short* s = (short*)data;
                        for (int i = 0; i < n; i++) { float v = s[i] / 32768f; fl[i] = v; if (v > pk) pk = v; else if (-v > pk) pk = -v; }
                    }
                    cap.ReleaseBuffer(frames);
                    ring.Write(fl, n);
                    if (pk > Peak) Peak = pk;
                    packet = cap.GetNextPacketSize();
                }
            }
            client.Stop();
        }
        catch (Exception e) { Error = e.Message; }
    }

    public void Dispose() { running = false; try { thread?.Join(500); } catch { } try { client?.Dispose(); } catch { } }
}

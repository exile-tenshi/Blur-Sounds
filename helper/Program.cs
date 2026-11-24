// Blur Sounds Pro audio helper.
// Talks JSON lines over stdin/stdout with the Electron main process.
// Uses Windows Core Audio (via NAudio) for per-app sessions and endpoints,
// Windows media sessions (GSMTC) for now playing, and the (undocumented but
// widely used, e.g. by EarTrumpet) AudioPolicyConfig factory for per-app output routing.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using Windows.Media.Control;

namespace Bsp;

static class Program
{
    static readonly object OutLock = new();
    static readonly object AudioLock = new();
    static MMDeviceEnumerator Enumerator;
    static List<MMDevice> RenderDevices = new();
    static List<MMDevice> CaptureDevices = new();
    static List<(int pid, AudioSessionControl s, string deviceId)> Sessions = new();
    static WasapiCapture MicCapture;
    static string MicCaptureId;
    static volatile float MicPeak;
    static string LastMediaJson = "";
    static string DefaultRenderId;
    static DateTime LastMediaSent = DateTime.MinValue;

    // --selftest: proves the bundled runtime and every native library load on this PC (used by the app's diagnostics/logs).
    static int SelfTest()
    {
        var r = new JsonObject
        {
            ["runtime"] = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
            ["os"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
            // "" = the runtime is bundled inside this exe (self-contained single-file), otherwise the shared .NET install it came from
            ["runtimeFrom"] = typeof(object).Assembly.Location == "" ? "bundled" : Path.GetDirectoryName(typeof(object).Assembly.Location),
        };
        var nat = new JsonObject();
        foreach (var n in new[] { "df.dll", "speexdsp.dll", "rnnoise.dll", "libvosk.dll" })
        {
            var full = Path.Combine(AppContext.BaseDirectory, n);
            if (!File.Exists(full)) { nat[n] = "missing"; continue; }
            nat[n] = System.Runtime.InteropServices.NativeLibrary.TryLoad(full, out var h) ? "ok" : "load failed";
        }
        r["natives"] = nat;
        try { using var en = new MMDeviceEnumerator(); r["renderDevices"] = en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).Count; r["captureDevices"] = en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active).Count; }
        catch (Exception e) { r["audioError"] = e.Message; }
        Console.Out.WriteLine(r.ToJsonString()); return 0;
    }

    static void Send(JsonObject o)
    {
        var s = o.ToJsonString();
        lock (OutLock) { Console.Out.WriteLine(s); Console.Out.Flush(); }
    }

    [STAThread]
    static int Main(string[] args)
    {
        // v2.2.2: plain UTF-8 pipes instead of console code pages (setting Console.*Encoding can throw on some systems).
        try { Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true }); } catch { }
        try { Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))); } catch { }
        AppDomain.CurrentDomain.UnhandledException += (_, e) => { try { Console.Error.WriteLine("fatal: " + e.ExceptionObject); } catch { } };
        if (args.Length > 0 && args[0] == "--selftest") return SelfTest();
        // v2.2: the helper must see the real Windows default, never a per-app route Windows remembered for it.
        if (args.Length == 0) { try { AppRouting.Set(Environment.ProcessId, "", "render"); } catch { } }
        if (args.Length > 0 && args[0] == "--stats")
        {
            Console.WriteLine(SysStats.Get("1.1.1.1").ToJsonString()); Thread.Sleep(1500);
            Console.WriteLine(SysStats.Get("1.1.1.1").ToJsonString()); Console.WriteLine(Adl.Probe()); return 0;
        }
        if (args.Length > 0 && args[0] == "--echorec") return EchoRec.Run(args);
        if (args.Length > 0 && args[0] == "--snapshot")
        {
            Enumerator = new MMDeviceEnumerator();
            var sw = Stopwatch.StartNew();
            Console.WriteLine(Snapshot().ToJsonString());
            Console.Error.WriteLine("snapshot ms " + sw.ElapsedMilliseconds);
            return 0;
        }
        var t = new Thread(AudioThread) { IsBackground = true };
        t.SetApartmentState(ApartmentState.MTA);
        t.Start(); t.Join();
        _ = Task.Run(MediaLoop);
        Send(new JsonObject { ["event"] = "ready", ["version"] = "1.0.0" });
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            Commands.Add(line);
        }
        return 0;
    }

    static readonly System.Collections.Concurrent.BlockingCollection<string> Commands = new();

    // Core Audio work runs on MTA threads: one for commands, one for snapshots, one for meters.
    static void StartMta(Action loop)
    {
        var t = new Thread(() =>
        {
            while (true)
            {
                try { loop(); }
                catch (Exception ex) { Send(new JsonObject { ["event"] = "log", ["message"] = ex.ToString() }); Thread.Sleep(500); }
            }
        }) { IsBackground = true };
        t.SetApartmentState(ApartmentState.MTA);
        t.Start();
    }

    static readonly AutoResetEvent SnapNow = new(false);
    public static Engine Eng;
    static void AudioThread()
    {
        try { Enumerator = new MMDeviceEnumerator(); Eng = new Engine(new MMDeviceEnumerator()) { Emit = Send }; }
        catch (Exception e)
        {
            // Windows Audio service stopped/disabled: tell the app why instead of crashing with an obscure code.
            Console.Error.WriteLine("audio service unavailable: " + e.Message);
            Send(new JsonObject { ["event"] = "fatal", ["code"] = "audio-service", ["message"] = e.Message });
            Environment.Exit(3);
        }
        StartMta(() =>
        {
            var snap = Snapshot();
            Send(new JsonObject { ["event"] = "snapshot", ["data"] = snap });
            SnapNow.WaitOne(1500);
        });
        StartMta(() =>
        {
            JsonObject lv;
            lock (AudioLock) lv = Levels();
            Send(new JsonObject { ["event"] = "levels", ["data"] = lv });
            Thread.Sleep(33); // ~30 Hz meters (UI smooths: instant attack, slow decay)
        });
        StartMta(() =>
        {
            var line = Commands.Take();
            Handle(line);
        });
    }

    static readonly bool Debug = Environment.GetEnvironmentVariable("BSP_DEBUG") == "1";
    static void Dbg(string m) { if (Debug) Console.Error.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + " " + m); }

    static void Handle(string line)
    {
        Dbg("handle " + line);
        JsonObject req = null; JsonNode result = null; string err = null;
        try
        {
            req = JsonNode.Parse(line).AsObject();
            var cmd = (string)req["cmd"];
            switch (cmd)
            {
                case "snapshot": result = Snapshot(); break;
                case "setSessionVolume": ForPid((int)req["pid"], s => s.SimpleAudioVolume.Volume = Clamp((float)(double)req["volume"])); break;
                case "setSessionMute": ForPid((int)req["pid"], s => s.SimpleAudioVolume.Mute = (bool)req["mute"]); break;
                case "setDeviceVolume": Dev((string)req["deviceId"]).AudioEndpointVolume.MasterVolumeLevelScalar = Clamp((float)(double)req["volume"]); break;
                case "setDeviceMute": Dev((string)req["deviceId"]).AudioEndpointVolume.Mute = (bool)req["mute"]; break;
                case "setDefaultDevice": PolicyConfig.SetDefault((string)req["deviceId"], (bool?)req["communications"] ?? true); break;
                case "setMicMeter": break; // v2: the engine owns the mic capture
                case "engineConfig": Eng.Configure(req["config"]); break;
                case "engineStatus": result = Eng.Status(); break;
                case "saveClip": result = Eng.SaveClip((string)req["path"], (double)req["seconds"]); break;
                case "recStart": Eng.RecStart((string)req["path"]); break;
                case "recStop": result = Eng.RecStop(); break;
                case "engineReset": Eng.Reset(); break;
                case "setAppOutput": result = AppRouting.Set((int)req["pid"], (string)req["deviceId"], (string)req["flow"] ?? "render"); break;
                case "getAppOutput": result = AppRouting.Get((int)req["pid"], (string)req["flow"] ?? "render"); break;
                case "clearAppOutputs": AppRouting.ClearAll(); break;
                case "mediaControl": _ = MediaControl((string)req["action"]); break;
                case "ping": result = "pong"; break;
                case "sysStats": result = SysStats.Get((string)req["pingHost"]); break;
                case "refresh": SnapNow.Set(); break;
                default: err = "unknown command " + cmd; break;
            }
        }
        catch (Exception ex) { err = ex.Message; }
        if (req != null && req["id"] != null)
        {
            var o = new JsonObject { ["id"] = req["id"].GetValue<int>(), ["ok"] = err == null };
            if (result != null) o["result"] = result;
            if (err != null) o["error"] = err;
            Send(o);
        }
    }

    static float Clamp(float v) => Math.Max(0f, Math.Min(1f, v));

    static MMDevice Dev(string id)
    {
        if (string.IsNullOrEmpty(id)) return Enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        return Enumerator.GetDevice(id);
    }

    static void ForPid(int pid, Action<AudioSessionControl> act)
    {
        int n = 0;
        List<(int pid, AudioSessionControl s, string deviceId)> list;
        lock (AudioLock) list = Sessions;
        foreach (var (p, s, _) in list) if (p == pid) { try { act(s); n++; } catch { } }
        if (n == 0) throw new Exception("no session for pid " + pid);
    }

    static void DisposeList(List<MMDevice> l) { foreach (var d in l) { try { d.Dispose(); } catch { } } l.Clear(); }

    static JsonObject Snapshot()
    {
        var newRender = new List<MMDevice>(); var newCapture = new List<MMDevice>();
        var newSessions = new List<(int pid, AudioSessionControl s, string deviceId)>();
        string defRender = null, defCapture = null, defCommsCapture = null;
        try { defRender = Enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { }
        try { defCapture = Enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia).ID; } catch { }
        try { defCommsCapture = Enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications).ID; } catch { }
        var outputs = new JsonArray(); var inputs = new JsonArray();
        foreach (var d in Enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)) { newRender.Add(d); outputs.Add(DevJson(d, d.ID == defRender)); }
        foreach (var d in Enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)) { newCapture.Add(d); inputs.Add(DevJson(d, d.ID == defCapture, d.ID == defCommsCapture)); }

        var apps = new Dictionary<int, JsonObject>();
        foreach (var d in newRender)
        {
            SessionCollection sc;
            try { var m = d.AudioSessionManager; m.RefreshSessions(); sc = m.Sessions; } catch { continue; }
            for (int i = 0; i < sc.Count; i++)
            {
                var s = sc[i];
                try
                {
                    if (s.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateExpired) continue;
                    int pid = (int)s.GetProcessID;
                    newSessions.Add((pid, s, d.ID));
                    if (!apps.TryGetValue(pid, out var a))
                    {
                        var info = ProcInfo(pid, s);
                        a = new JsonObject
                        {
                            ["pid"] = pid,
                            ["process"] = info.name,
                            ["name"] = info.display,
                            ["path"] = info.path,
                            ["volume"] = s.SimpleAudioVolume.Volume,
                            ["muted"] = s.SimpleAudioVolume.Mute,
                            ["active"] = false,
                            ["system"] = s.IsSystemSoundsSession,
                            ["devices"] = new JsonArray()
                        };
                        apps[pid] = a;
                    }
                    if (s.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateActive) a["active"] = true;
                    ((JsonArray)a["devices"]).Add(d.ID);
                }
                catch { }
            }
        }
        var arr = new JsonArray();
        foreach (var a in apps.Values) arr.Add(a);
        List<MMDevice> oldR, oldC;
        lock (AudioLock)
        {
            oldR = RenderDevices; oldC = CaptureDevices;
            RenderDevices = newRender; CaptureDevices = newCapture; Sessions = newSessions;
            DefaultRenderId = defRender;
        }
        DisposeList(oldR); DisposeList(oldC);
        return new JsonObject
        {
            ["outputs"] = outputs,
            ["inputs"] = inputs,
            ["defaultOutput"] = defRender,
            ["defaultInput"] = defCapture,
            ["defaultCommsInput"] = defCommsCapture,
            ["sessions"] = arr,
            ["routingSupported"] = AppRouting.Supported
        };
    }

    static JsonObject DevJson(MMDevice d, bool isDefault, bool isComms = false)
    {
        var o = new JsonObject { ["id"] = d.ID, ["name"] = d.FriendlyName, ["default"] = isDefault, ["comms"] = isComms };
        try { o["volume"] = d.AudioEndpointVolume.MasterVolumeLevelScalar; o["muted"] = d.AudioEndpointVolume.Mute; } catch { }
        return o;
    }

    // v2.3: cache is keyed by pid + process start time, so a restarted app (or a reused pid) is re-identified.
    static readonly Dictionary<int, (string name, string display, string path, long started)> ProcCache = new();
    // Audio that plays from a helper/host process belongs to the app that launched it (WebView2, CEF, Qt WebEngine...).
    static readonly HashSet<string> HostProcs = new(StringComparer.OrdinalIgnoreCase) { "msedgewebview2", "CefSharp.BrowserSubprocess", "QtWebEngineProcess", "steamwebhelper", "CefSubprocess", "cef_subprocess", "WebViewHost" };
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
    [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr r1, peb, r2a, r2b, pid, parent; }
    static int ParentPid(Process p) { try { var b = new PBI(); return NtQueryInformationProcess(p.Handle, 0, ref b, Marshal.SizeOf(b), out _) == 0 ? (int)b.parent : 0; } catch { return 0; } }
    static long StartTicks(int pid) { try { using var p = Process.GetProcessById(pid); return p.StartTime.Ticks; } catch { return 0; } }
    static (string name, string display, string path) ProcInfo(int pid, AudioSessionControl s)
    {
        if (pid == 0 || s.IsSystemSoundsSession) return ("System", "System sounds", null);
        long st = StartTicks(pid);
        if (ProcCache.TryGetValue(pid, out var c) && c.started == st) return (c.name, c.display, c.path);
        string name = "pid " + pid, display = null, path = null;
        try
        {
            var p = Process.GetProcessById(pid);
            // climb out of host/helper processes to the owning app (max 4 levels)
            for (int k = 0; k < 4 && HostProcs.Contains(p.ProcessName); k++)
            {
                int pp = ParentPid(p); if (pp <= 4) break;
                try { var par = Process.GetProcessById(pp); if (par.StartTime > p.StartTime) break; p.Dispose(); p = par; } catch { break; }
            }
            name = p.ProcessName;
            try { path = p.MainModule?.FileName; display = p.MainModule?.FileVersionInfo?.FileDescription; } catch { }
            if (string.IsNullOrWhiteSpace(display)) { try { display = p.MainWindowTitle; } catch { } }
            p.Dispose();
        }
        catch { }
        var dn = s.DisplayName;
        if (!string.IsNullOrWhiteSpace(dn) && !dn.StartsWith("@")) display = dn;
        if (string.IsNullOrWhiteSpace(display)) display = name;
        var r = (name, display.Trim(), path);
        ProcCache[pid] = (r.name, r.Item2, r.path, st);
        return r;
    }

    static JsonObject Levels()
    {
        var o = new JsonObject();
        var per = new Dictionary<int, float>();
        foreach (var (pid, s, _) in Sessions)
        {
            try { var v = s.AudioMeterInformation.MasterPeakValue; per[pid] = Math.Max(per.TryGetValue(pid, out var e) ? e : 0, v); } catch { }
        }
        var sess = new JsonObject();
        foreach (var kv in per) sess[kv.Key.ToString()] = Math.Round(kv.Value, 3);
        o["sessions"] = sess;
        var el = Eng?.Levels();
        o["mic"] = el != null ? Math.Max(Math.Round(MicPeak, 3), (double)el["micPre"]) : Math.Round(MicPeak, 3);
        MicPeak *= 0.6f;
        if (el != null) o["engine"] = el;
        try
        {
            var def = RenderDevices.FirstOrDefault(d => d.ID == DefaultRenderId);
            o["master"] = def != null ? Math.Round(def.AudioMeterInformation.MasterPeakValue, 3) : 0;
        }
        catch { }
        return o;
    }

    static void SetMicMeter(string id)
    {
        if (MicCaptureId == id && MicCapture != null) return;
        try { MicCapture?.StopRecording(); MicCapture?.Dispose(); } catch { }
        MicCapture = null; MicCaptureId = id;
        if (string.IsNullOrEmpty(id)) return;
        var dev = Enumerator.GetDevice(id);
        var cap = new WasapiCapture(dev, true, 50);
        cap.DataAvailable += (s, e) =>
        {
            var fmt = cap.WaveFormat; float peak = 0;
            if (fmt.Encoding == WaveFormatEncoding.IeeeFloat || (fmt.Encoding == WaveFormatEncoding.Extensible && fmt.BitsPerSample == 32))
            {
                for (int i = 0; i + 4 <= e.BytesRecorded; i += 4) { var v = Math.Abs(BitConverter.ToSingle(e.Buffer, i)); if (v > peak) peak = v; }
            }
            else if (fmt.BitsPerSample == 16)
            {
                for (int i = 0; i + 2 <= e.BytesRecorded; i += 2) { var v = Math.Abs(BitConverter.ToInt16(e.Buffer, i) / 32768f); if (v > peak) peak = v; }
            }
            if (peak > MicPeak) MicPeak = Math.Min(1f, peak);
        };
        cap.StartRecording();
        MicCapture = cap;
    }

    // ---------- media sessions / focused window ----------
    static GlobalSystemMediaTransportControlsSessionManager Gsmtc;
    static async Task MediaLoop()
    {
        while (true)
        {
            try
            {
                Gsmtc ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var o = new JsonObject();
                var sessions = Gsmtc.GetSessions();
                GlobalSystemMediaTransportControlsSession pick = null;
                // Prefer a playing session, Spotify first.
                foreach (var s in sessions.OrderByDescending(x => x.SourceAppUserModelId.Contains("Spotify", StringComparison.OrdinalIgnoreCase)))
                {
                    var pi = s.GetPlaybackInfo();
                    if (pi.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) { pick = s; break; }
                }
                pick ??= Gsmtc.GetCurrentSession();
                if (pick != null)
                {
                    var props = await pick.TryGetMediaPropertiesAsync();
                    var pb = pick.GetPlaybackInfo();
                    var tl = pick.GetTimelineProperties();
                    o["app"] = pick.SourceAppUserModelId;
                    o["title"] = props?.Title ?? "";
                    o["artist"] = props?.Artist ?? "";
                    o["album"] = props?.AlbumTitle ?? "";
                    o["status"] = pb.PlaybackStatus.ToString().ToLowerInvariant();
                    o["position"] = tl.Position.TotalSeconds;
                    o["duration"] = (tl.EndTime - tl.StartTime).TotalSeconds;
                    o["updated"] = tl.LastUpdatedTime.ToUnixTimeMilliseconds();
                }
                var fg = Foreground();
                o["focus"] = fg;
                var js = o.ToJsonString();
                var key = (string)o["title"] + "|" + (string)o["artist"] + "|" + (string)o["status"] + "|" + fg?.ToJsonString();
                if (key != LastMediaJson || (DateTime.UtcNow - LastMediaSent).TotalSeconds > 5)
                { LastMediaJson = key; LastMediaSent = DateTime.UtcNow; Send(new JsonObject { ["event"] = "media", ["data"] = JsonNode.Parse(js) }); }
            }
            catch (Exception ex) { Send(new JsonObject { ["event"] = "log", ["message"] = "media: " + ex.Message }); Gsmtc = null; await Task.Delay(5000); }
            await Task.Delay(1000);
        }
    }

    static async Task MediaControl(string action)
    {
        try
        {
            Gsmtc ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var s = Gsmtc.GetCurrentSession(); if (s == null) return;
            switch (action)
            {
                case "toggle": await s.TryTogglePlayPauseAsync(); break;
                case "next": await s.TrySkipNextAsync(); break;
                case "prev": await s.TrySkipPreviousAsync(); break;
            }
        }
        catch { }
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);

    static JsonObject Foreground()
    {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero) return null;
        GetWindowThreadProcessId(h, out var pid);
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        string name = null, desc = null;
        try { using var p = Process.GetProcessById((int)pid); name = p.ProcessName; try { desc = p.MainModule?.FileVersionInfo?.FileDescription; } catch { } } catch { }
        long started = 0; try { using var p2 = Process.GetProcessById((int)pid); started = new DateTimeOffset(p2.StartTime).ToUnixTimeMilliseconds(); } catch { }
        return new JsonObject { ["process"] = name, ["name"] = string.IsNullOrWhiteSpace(desc) ? name : desc, ["title"] = sb.ToString(), ["started"] = started };
    }
}

// Set Windows default endpoint (IPolicyConfig, used by many audio switchers).
static class PolicyConfig
{
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
        [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
        [PreserveSig] int ResetDeviceFormat(IntPtr a);
        [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
        [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility(IntPtr a, int b);
    }
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class CPolicyConfigClient { }

    public static void SetDefault(string id, bool comms)
    {
        var pc = (IPolicyConfig)new CPolicyConfigClient();
        Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 0)); // console
        Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 1)); // multimedia
        if (comms) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 2)); // communications
        Marshal.ReleaseComObject(pc);
    }
}

// Per-app output device (same mechanism as Windows "App volume and device preferences").
static unsafe class AppRouting
{
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string s, int len, out IntPtr h);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
    [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr h, out uint len);

    const string RenderIface = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
    const string CaptureIface = "#{2eef81be-33fa-4800-9670-1cd474972c3f}";
    const string Token = @"\\?\SWD#MMDEVAPI#";
    static IntPtr Factory;
    static bool Tried;

    public static bool Supported { get { Init(); return Factory != IntPtr.Zero; } }

    static void Init()
    {
        if (Tried) return; Tried = true;
        try
        {
            WindowsCreateString("Windows.Media.Internal.AudioPolicyConfig", "Windows.Media.Internal.AudioPolicyConfig".Length, out var cls);
            var iid = new Guid("ab3d4648-e242-459f-b02f-541c70306324"); // 21H2+ variant
            if (RoGetActivationFactory(cls, ref iid, out var f) == 0) Factory = f;
            WindowsDeleteString(cls);
        }
        catch { }
    }

    // vtable: IUnknown(3) + IInspectable(3) + 19 unrelated methods, then Set/Get/ClearAll.
    const int SetIdx = 25, GetIdx = 26, ClearIdx = 27;
    static IntPtr Slot(int i) => (*(IntPtr**)Factory)[i];

    public static JsonNode Set(int pid, string deviceId, string flow)
    {
        Init(); if (Factory == IntPtr.Zero) throw new Exception("per-app routing not supported on this Windows build");
        int f = flow == "capture" ? 1 : 0;
        IntPtr h = IntPtr.Zero;
        if (!string.IsNullOrEmpty(deviceId))
        {
            var full = Token + deviceId + (f == 1 ? CaptureIface : RenderIface);
            WindowsCreateString(full, full.Length, out h);
        }
        var fn = (delegate* unmanaged[Stdcall]<IntPtr, uint, int, int, IntPtr, int>)Slot(SetIdx);
        int hr1 = fn(Factory, (uint)pid, f, 0, h); // eConsole
        int hr2 = fn(Factory, (uint)pid, f, 1, h); // eMultimedia
        if (h != IntPtr.Zero) WindowsDeleteString(h);
        if (hr1 != 0) Marshal.ThrowExceptionForHR(hr1);
        return hr2;
    }

    public static JsonNode Get(int pid, string flow)
    {
        Init(); if (Factory == IntPtr.Zero) return null;
        int f = flow == "capture" ? 1 : 0;
        var fn = (delegate* unmanaged[Stdcall]<IntPtr, uint, int, int, IntPtr*, int>)Slot(GetIdx);
        IntPtr h;
        int hr = fn(Factory, (uint)pid, f, 1, &h);
        if (hr != 0 || h == IntPtr.Zero) return null;
        var raw = WindowsGetStringRawBuffer(h, out var len);
        var s = Marshal.PtrToStringUni(raw, (int)len);
        WindowsDeleteString(h);
        // strip token/interface suffix -> MMDevice ID
        if (s.StartsWith(Token)) s = s.Substring(Token.Length);
        var hash = s.LastIndexOf("#{", StringComparison.Ordinal);
        if (hash > 0) s = s.Substring(0, hash);
        return s;
    }

    public static void ClearAll()
    {
        Init(); if (Factory == IntPtr.Zero) return;
        var fn = (delegate* unmanaged[Stdcall]<IntPtr, int>)Slot(ClearIdx);
        fn(Factory);
    }
}

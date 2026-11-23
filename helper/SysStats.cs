// PC stats for the chatbox: GPU load/VRAM (PDH), temperatures (ACPI thermal zone + AMD ADL when available),
// battery, input idle time, uptime, ping and whether VRChat is running.
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Microsoft.Win32;

static class SysStats
{
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQuery(string src, IntPtr user, out IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounterW(IntPtr q, string path, IntPtr user, out IntPtr c);
    [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetFormattedCounterArrayW(IntPtr c, uint fmt, ref uint size, out uint count, IntPtr buf);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
    [StructLayout(LayoutKind.Sequential)] struct SYSTEM_POWER_STATUS { public byte AC, Flag, Percent, Saver; public int LifeTime, FullLifeTime; }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);

    static IntPtr q, cGpu, cVram, cTherm; static bool pdhOk; static string pdhErr;
    static double? lastPing; static string pingHost; static Task pingTask; static string pingErr;
    static long vramTotal; static string gpuName;

    static void InitPdh()
    {
        if (q != IntPtr.Zero || pdhErr != null) return;
        try
        {
            int hr = PdhOpenQuery(null, IntPtr.Zero, out q); if (hr != 0) throw new Exception("PdhOpenQuery " + hr.ToString("X"));
            PdhAddEnglishCounterW(q, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out cGpu);
            PdhAddEnglishCounterW(q, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out cVram);
            PdhAddEnglishCounterW(q, @"\Thermal Zone Information(*)\Temperature", IntPtr.Zero, out cTherm);
            PdhCollectQueryData(q); pdhOk = true;
            try
            {
                using var cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
                foreach (var sub in cls?.GetSubKeyNames() ?? Array.Empty<string>())
                {
                    try
                    {
                        using var k = cls.OpenSubKey(sub); var mem = k?.GetValue("HardwareInformation.qwMemorySize");
                        long m = mem is long l ? l : mem is byte[] b && b.Length >= 8 ? BitConverter.ToInt64(b, 0) : 0;
                        if (m > vramTotal) { vramTotal = m; gpuName = k.GetValue("DriverDesc") as string; }
                    }
                    catch { }
                }
            }
            catch { }
        }
        catch (Exception e) { pdhErr = e.Message; }
    }

    static List<(string name, double v)> Read(IntPtr c)
    {
        var list = new List<(string, double)>(); if (c == IntPtr.Zero) return list;
        uint size = 0; int hr = PdhGetFormattedCounterArrayW(c, 0x200 | 0x8000, ref size, out uint count, IntPtr.Zero);
        if (size == 0) return list;
        var buf = Marshal.AllocHGlobal((int)size);
        try
        {
            hr = PdhGetFormattedCounterArrayW(c, 0x200 | 0x8000, ref size, out count, buf);
            if (hr != 0) return list;
            for (int i = 0; i < count; i++)
            {
                var p = buf + i * 24;
                var name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(p)) ?? "";
                var status = (uint)Marshal.ReadInt32(p + 8);
                if (status != 0 && status != 1) continue;
                list.Add((name, BitConverter.Int64BitsToDouble(Marshal.ReadInt64(p + 16))));
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return list;
    }

    public static JsonObject Get(string host)
    {
        InitPdh();
        var o = new JsonObject();
        if (pdhOk)
        {
            PdhCollectQueryData(q);
            // GPU: sum per (adapter, engine type), report the busiest — same as Task Manager
            var g = Read(cGpu).GroupBy(x => { var n = x.name; int a = n.IndexOf("luid_"), e = n.IndexOf("engtype_"); return (a >= 0 ? n.Substring(a, Math.Min(26, n.Length - a)) : "") + "|" + (e >= 0 ? n.Substring(e) : ""); })
                .Select(gr => gr.Sum(x => x.v)).DefaultIfEmpty(0).Max();
            o["gpu"] = Math.Round(Math.Min(100, g), 0);
            var vr = Read(cVram).Select(x => x.v).DefaultIfEmpty(0).Max();
            o["vramUsed"] = Math.Round(vr / 1073741824.0, 1);
            if (vramTotal > 0) o["vramTotal"] = Math.Round(vramTotal / 1073741824.0, 0);
            var th = Read(cTherm).Select(x => x.v - 273.15).Where(t => t > 5 && t < 120).DefaultIfEmpty(double.NaN).Max();
            if (!double.IsNaN(th)) o["boardTemp"] = Math.Round(th, 0);
        }
        else o["pdhError"] = pdhErr;
        if (gpuName != null) o["gpuName"] = gpuName;
        var gt = Adl.Temps(); if (gt != null) { o["gpuTemp"] = gt.Value.edge; if (gt.Value.hotspot > 0) o["gpuHotspot"] = gt.Value.hotspot; } else if (Adl.Error != null) o["gpuTempError"] = Adl.Error;
        var li = new LASTINPUTINFO { cbSize = 8 }; if (GetLastInputInfo(ref li)) o["idleSec"] = Math.Round(((uint)Environment.TickCount - li.dwTime) / 1000.0, 1);
        if (GetSystemPowerStatus(out var ps)) { o["battery"] = (ps.Flag & 128) != 0 || ps.Percent == 255 ? null : ps.Percent; o["charging"] = ps.AC == 1; }
        o["uptimeSec"] = Environment.TickCount64 / 1000;
        try { o["vrchat"] = Process.GetProcessesByName("VRChat").Length > 0; } catch { }
        // ping runs in the background; return the last result
        if (!string.IsNullOrWhiteSpace(host))
        {
            if (host != pingHost) { pingHost = host; lastPing = null; pingErr = null; }
            if (pingTask == null || pingTask.IsCompleted)
                pingTask = Task.Run(async () =>
                {
                    try { using var p = new Ping(); var r = await p.SendPingAsync(host, 1500); if (r.Status == IPStatus.Success) { lastPing = r.RoundtripTime; pingErr = null; } else { lastPing = null; pingErr = r.Status.ToString(); } }
                    catch (Exception e) { lastPing = null; pingErr = e.InnerException?.Message ?? e.Message; }
                });
            if (lastPing != null) o["ping"] = lastPing; if (pingErr != null) o["pingError"] = pingErr;
        }
        return o;
    }
}

// Minimal AMD ADL2 binding: reads GPU edge/hotspot temperature from the driver's PM log (no admin needed).
static class Adl
{
    delegate IntPtr AllocCb(int size);
    [DllImport("atiadlxx.dll")] static extern int ADL2_Main_Control_Create(AllocCb cb, int connected, out IntPtr ctx);
    [DllImport("atiadlxx.dll")] static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr ctx, out int n);
    [DllImport("atiadlxx.dll")] static extern int ADL2_Adapter_AdapterInfo_Get(IntPtr ctx, IntPtr info, int size);
    [DllImport("atiadlxx.dll")] static extern int ADL2_New_QueryPMLogData_Get(IntPtr ctx, int adapter, IntPtr output);
    [DllImport("atiadlxx.dll")] static extern int ADL2_Adapter_Active_Get(IntPtr ctx, int adapter, out int active);
    static readonly AllocCb alloc = s => Marshal.AllocCoTaskMem(s);
    static IntPtr ctx; static List<int> adapters; public static string Error; static bool tried;
    // ADLSensorType indices (adl_defines.h)
    public const int EDGE = 8, HOTSPOT = 27;
    static bool Init()
    {
        if (tried) return ctx != IntPtr.Zero && adapters?.Count > 0;
        tried = true;
        try
        {
            if (ADL2_Main_Control_Create(alloc, 1, out ctx) != 0) { Error = "ADL init failed"; return false; }
            ADL2_Adapter_NumberOfAdapters_Get(ctx, out int n); adapters = new List<int>();
            if (n <= 0) { Error = "no AMD adapters"; return false; }
            int stride = 1568; var buf = Marshal.AllocHGlobal(stride * n);
            try
            {
                ADL2_Adapter_AdapterInfo_Get(ctx, buf, stride * n);
                var seenBus = new HashSet<int>();
                for (int i = 0; i < n; i++)
                {
                    var p = buf + i * stride; int idx = Marshal.ReadInt32(p + 4); int bus = Marshal.ReadInt32(p + 8 + 256);
                    if (seenBus.Add(bus)) adapters.Add(idx);
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return adapters.Count > 0;
        }
        catch (DllNotFoundException) { Error = "no AMD driver"; return false; }
        catch (Exception e) { Error = e.Message; return false; }
    }
    public static int[] Sensors(int adapter)
    {
        var buf = Marshal.AllocHGlobal(4 + 256 * 8);
        try
        {
            for (int i = 0; i < 4 + 256 * 8; i += 4) Marshal.WriteInt32(buf + i, 0);
            Marshal.WriteInt32(buf, 4 + 256 * 8);
            if (ADL2_New_QueryPMLogData_Get(ctx, adapter, buf) != 0) return null;
            var r = new int[256];
            for (int s = 0; s < 256; s++) r[s] = Marshal.ReadInt32(buf + 4 + s * 8) != 0 ? Marshal.ReadInt32(buf + 4 + s * 8 + 4) : int.MinValue;
            return r;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }
    public static (int edge, int hotspot)? Temps()
    {
        if (!Init()) return null;
        foreach (var a in adapters)
        {
            try
            {
                var s = Sensors(a); if (s == null) continue;
                int e = s[EDGE], h = s[HOTSPOT];
                if (e > 0 && e < 130) return (e, h > 0 && h < 150 ? h : 0);
            }
            catch (Exception ex) { Error = ex.Message; }
        }
        Error ??= "GPU temperature not exposed by this driver";
        return null;
    }
    public static string Probe()
    {
        if (!Init()) return "ADL: " + Error;
        var sb = new System.Text.StringBuilder();
        foreach (var a in adapters)
        {
            var s = Sensors(a); sb.Append($"adapter {a}: ");
            if (s == null) { sb.AppendLine("PMLog not supported"); continue; }
            for (int i = 0; i < 256; i++) if (s[i] != int.MinValue) sb.Append($"[{i}]={s[i]} ");
            sb.AppendLine();
        }
        return sb.ToString();
    }
}

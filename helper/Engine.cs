// Blur Sounds Pro audio engine: mic chain, cable channels, per-app capture, personal/stream mixes,
// clip ring buffer, recorder and voice trigger. Configured by JSON from the Electron main process.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Bsp;

static class Fmt
{
    // Converts a capture buffer to interleaved float.
    public static int ToFloat(byte[] b, int bytes, WaveFormat f, ref float[] dst)
    {
        bool isFloat = f.Encoding == WaveFormatEncoding.IeeeFloat ||
            (f is WaveFormatExtensible x && x.SubFormat == NAudio.Dmo.AudioMediaSubtypes.MEDIASUBTYPE_IEEE_FLOAT) ||
            (f.Encoding == WaveFormatEncoding.Extensible && f.BitsPerSample == 32 && !(f is WaveFormatExtensible));
        int bps = f.BitsPerSample / 8; int n = bytes / bps;
        if (dst.Length < n) dst = new float[n];
        if (isFloat) Buffer.BlockCopy(b, 0, dst, 0, n * 4);
        else if (bps == 2) for (int i = 0; i < n; i++) dst[i] = BitConverter.ToInt16(b, i * 2) / 32768f;
        else if (bps == 3) for (int i = 0; i < n; i++) dst[i] = ((b[i * 3] << 8 | b[i * 3 + 1] << 16 | b[i * 3 + 2] << 24) >> 8) / 8388608f;
        else if (bps == 4) for (int i = 0; i < n; i++) dst[i] = BitConverter.ToInt32(b, i * 4) / 2147483648f;
        return n;
    }
}

// A device capture (mic or loopback of a render endpoint such as "CABLE Input") into a 48k stereo ring.
sealed class DeviceSource : IDisposable
{
    public readonly string DeviceId; public readonly bool Loopback; public readonly FloatRing Ring = new(48000 * 2 * 2);
    WasapiCapture cap; Resampler rs; float[] tmp = new float[4096];
    public string Error; public float Peak; public Action<float[], int, int> OnRaw; // (interleaved, frames, channels) for mic chain
    public DeviceSource(MMDeviceEnumerator en, string id, bool loopback)
    {
        DeviceId = id; Loopback = loopback;
        var dev = en.GetDevice(id);
        cap = loopback ? new WasapiLoopbackCapture(dev) : new WasapiCapture(dev, true, 20);
        rs = new Resampler(cap.WaveFormat.SampleRate);
        cap.DataAvailable += (s, e) =>
        {
            try
            {
                int n = Fmt.ToFloat(e.Buffer, e.BytesRecorded, cap.WaveFormat, ref tmp);
                int ch = cap.WaveFormat.Channels; int frames = n / ch;
                float pk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(tmp[i]); if (a > pk) pk = a; }
                if (pk > Peak) Peak = pk;
                if (OnRaw != null) OnRaw(tmp, frames, ch);
                else rs.Push(tmp, frames, ch, Ring);
            }
            catch (Exception ex) { Error = ex.Message; }
        };
        cap.RecordingStopped += (s, e) => { if (e.Exception != null) Error = e.Exception.Message; };
        cap.StartRecording();
    }
    public int SampleRate => cap.WaveFormat.SampleRate;
    public void Dispose() { try { cap.StopRecording(); } catch { } try { cap.Dispose(); } catch { } }
}

// A render endpoint fed from the engine (personal mix, stream mix, processed mic).
// v2.3.1: opens the device at its own shared-mode mix format (any rate / channel count, e.g. Hi-Fi Cable at
// 96/192 kHz or 8 ch) and converts the engine's 48 kHz stereo itself, instead of relying on Windows/DMO resampling.
sealed class OutputSink : IDisposable
{
    public readonly string DeviceId; WasapiOut wo; BufferedWaveProvider bwp; byte[] bytes = new byte[0];
    public string Error; public readonly int Rate, Channels; public float Peak; public long Written;
    RateOut conv;
    readonly int maxQueueMs;
    public OutputSink(MMDeviceEnumerator en, string id, int latencyMs = 30, int maxQueueMs = 120)
    {
        this.maxQueueMs = maxQueueMs;
        DeviceId = id;
        var dev = en.GetDevice(id);
        int rate = 48000, chans = 2;
        try { var mf = dev.AudioClient.MixFormat; if (mf != null && mf.SampleRate >= 8000) { rate = mf.SampleRate; chans = Math.Clamp(mf.Channels, 1, 8); } } catch { }
        Exception last = null;
        foreach (var (r, c) in new[] { (rate, chans), (48000, 2) })
        {
            try
            {
                bwp = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(r, c)) { DiscardOnBufferOverflow = true, BufferDuration = TimeSpan.FromMilliseconds(600), ReadFully = true };
                wo = new WasapiOut(dev, AudioClientShareMode.Shared, true, latencyMs);
                wo.Init(bwp); wo.Play(); Rate = r; Channels = c; conv = new RateOut(r, c); last = null; break;
            }
            catch (Exception e) { last = e; try { wo?.Dispose(); } catch { } wo = null; }
        }
        if (last != null) throw new Exception($"could not open {dev.FriendlyName} ({rate} Hz, {chans} ch): {last.Message}");
        wo.PlaybackStopped += (s, e) => { if (e.Exception != null) Error = e.Exception.Message; };
    }
    public void Write(float[] stereo, int count)
    {
        // keep latency bounded: if more than 120 ms queued, drop this block
        if (bwp.BufferedDuration.TotalMilliseconds > maxQueueMs) return;
        float pk = 0; for (int i = 0; i < count; i++) { var a = Math.Abs(stereo[i]); if (a > pk) pk = a; }
        if (pk > Peak) Peak = pk; Written += count / 2;
        float[] src = stereo; int n = count;
        if (Rate != 48000 || Channels != 2) n = conv.Convert(stereo, count, out src);
        int nb = n * 4; if (bytes.Length < nb) bytes = new byte[nb];
        Buffer.BlockCopy(src, 0, bytes, 0, nb);
        bwp.AddSamples(bytes, 0, nb);
    }
    public void Dispose() { try { wo.Stop(); } catch { } try { wo.Dispose(); } catch { } }
}

sealed class ChannelCfg
{
    public string Id; public string Mode = "direct"; public string CableId; public int[] Pids = Array.Empty<int>();
    public float Vol = 1, StreamVol = 1; public bool Muted, StreamMuted; public bool InClip = true, InRec = true;
    public Equalizer Eq = new(), EqS = new(); // EqS: the stream copy when some of the channel's apps are left out of the stream
    public float Peak;
    // v2.4.2 "EQ what you hear" for Direct channels: the app's session is turned down to Comp^-1 (Windows applies it before
    // process loopback), the capture is scaled back up by Comp, EQ'd and played to HearOut. Process loopback can't capture a muted app.
    public bool Hear; public float Comp = 1; public string HearOut;
}

public sealed class Engine
{
    readonly MMDeviceEnumerator en;
    readonly object l = new();
    readonly Dictionary<string, DeviceSource> cables = new();
    readonly Dictionary<int, ProcessCapture> procs = new();
    readonly Dictionary<int, FloatRing> procRings = new();
    readonly Dictionary<string, ChannelCfg> chans = new();
    DeviceSource mic; string micId;
    OutputSink personal, stream, micOut;
    float streamGain = 1; HashSet<int> streamExclude = new();
    readonly Dictionary<string, OutputSink> hearSinks = new(); readonly Dictionary<string, float[]> hearBus = new(); readonly Dictionary<string, Limiter> hearLim = new();
    readonly FloatRing micRing = new(48000 * 2);
    // mic chain
    readonly NoiseGate gate = new(); readonly Compressor comp = new(); readonly Equalizer micEq = new(); readonly Limiter micLim = new();
    readonly BusMixer bus = new(); // v2.6.0
    readonly VoiceChain vc = new(); readonly VoiceChanger changer = new(); bool changerOn; bool nsOn, clearcast, bypass; float micGain = 1; bool micMuted, micToCable = true;
    DeviceSource aecRef; string aecRefId; OutputSink monitor; bool monitorOn; float monitorVol = 0.8f;
    bool micInStream = true, micInClip = true, micInRec = true, streamMode, chainOn;
    Resampler micRs; float[] micMono = new float[4096];
    public float MicPeakPre, MicPeakPost;
    // clips + recording
    short[] clipRing = new short[48000 * 2 * 30]; long clipWritten; bool clipOn;
    // v2.1: clip audio is kept as two tracks: desktop (stereo) and mic (mono), mixed on save.
    short[] clipMic = new short[48000 * 30];
    string clipSource = "auto"; string clipSysWant; DeviceSource sysLoop; public string ClipUsing = "apps";
    public float ClipDeskPeak, ClipMicPeak; int appSilentBlocks, sysQuietBlocks;
    WaveFileWriter rec; string recPath; long recFrames;
    public readonly VoiceTrigger Voice = new(); bool voiceOn; string voiceModel = "", voicePhrase = "clip it";
    Thread thread; volatile bool running;
    public Action<JsonObject> Emit;
    readonly List<string> errors = new();
    static readonly HashSet<string> NoCapture = new(StringComparer.OrdinalIgnoreCase) { "audiodg", "SteelSeriesSonar", "BlurSoundsPro", "BspAudioHelper", "SteelSeriesCaptureSvc" };

    [DllImport("winmm.dll")] static extern int timeBeginPeriod(int p);

    public Engine(MMDeviceEnumerator en)
    {
        this.en = en;
        Voice.Fired += (t) => Emit?.Invoke(new JsonObject { ["event"] = "voice", ["data"] = new JsonObject { ["text"] = t } });
    }

    void Err(string where, Exception e) { lock (errors) { errors.Add(where + ": " + e.Message); if (errors.Count > 20) errors.RemoveAt(0); } }

    public void Configure(JsonNode cfg)
    {
        lock (l)
        {
            streamMode = (bool?)cfg["streamMode"] ?? false;
            streamGain = (float)Math.Clamp((double?)cfg["streamGain"] ?? 1, 0, 2);
            streamExclude = new HashSet<int>(((cfg["streamExclude"] as JsonArray) ?? new JsonArray()).Select(p => (int)p));
            // ----- channels -----
            var seen = new HashSet<string>(); var wantCables = new HashSet<string>(); var wantPids = new HashSet<int>();
            bool needCaptures = streamMode || ((bool?)cfg["clip"]?["enabled"] ?? false) || ((bool?)cfg["record"]?["active"] ?? false);
            string personalId = (string)cfg["personalOut"]; string streamId = (string)cfg["streamOut"];
            try { bus.Configure(cfg["bus"], en, Err); } catch (Exception e) { Err("bus mixer", e); }
            foreach (var c in (cfg["channels"] as JsonArray) ?? new JsonArray())
            {
                var id = (string)c["id"]; seen.Add(id);
                if (!chans.TryGetValue(id, out var ch)) chans[id] = ch = new ChannelCfg { Id = id };
                ch.Mode = (string)c["mode"] ?? "direct"; ch.CableId = (string)c["cableId"];
                ch.Vol = (float)((double?)c["volume"] ?? 1); ch.Muted = (bool?)c["muted"] ?? false;
                ch.StreamVol = (float)((double?)c["streamVolume"] ?? 1); ch.StreamMuted = (bool?)c["streamMuted"] ?? false;
                ch.InClip = (bool?)c["inClip"] ?? true; ch.InRec = (bool?)c["inRec"] ?? true;
                ch.Eq.Configure(c["eq"]); ch.EqS.Configure(c["eq"]);
                ch.Hear = (bool?)c["hear"] ?? false; ch.Comp = (float)Math.Clamp((double?)c["comp"] ?? 1, 1, 1000); ch.HearOut = (string)c["hearOut"];
                if (!ch.Hear) ch.Comp = 1;
                ch.Pids = ((c["pids"] as JsonArray) ?? new JsonArray()).Select(p => (int)p).ToArray();
                if (ch.Mode == "cable" && !string.IsNullOrEmpty(ch.CableId) && ch.CableId != personalId && ch.CableId != streamId) wantCables.Add(ch.CableId);
                else if (needCaptures || ch.Hear || bus.NeedsCapture(id)) foreach (var p in ch.Pids) wantPids.Add(p);
            }
            foreach (var k in chans.Keys.Where(k => !seen.Contains(k)).ToList()) chans.Remove(k);
            // cable loopbacks
            foreach (var k in cables.Keys.Where(k => !wantCables.Contains(k)).ToList()) { cables[k].Dispose(); cables.Remove(k); }
            foreach (var id in wantCables) if (!cables.ContainsKey(id)) { try { cables[id] = new DeviceSource(en, id, true); } catch (Exception e) { Err("cable", e); } }
            // per-app captures
            foreach (var p in procs.Keys.Where(p => !wantPids.Contains(p)).ToList()) { procs[p].Dispose(); procs.Remove(p); procRings.Remove(p); }
            foreach (var p in wantPids)
            {
                if (procs.ContainsKey(p) || p <= 0) continue;
                try { using var pr = Process.GetProcessById(p); if (NoCapture.Contains(pr.ProcessName)) continue; } catch { continue; }
                var ring = new FloatRing(48000 * 2); var pc = new ProcessCapture(p, ring);
                try { pc.Start(); procs[p] = pc; procRings[p] = ring; } catch (Exception e) { Err("app " + p, e); pc.Dispose(); }
            }
            // ----- outputs -----
            bool anyCable = chans.Values.Any(c => c.Mode == "cable" && cables.ContainsKey(c.CableId ?? ""));
            string pid2 = anyCable || bus.InputsTo("A1") ? (personalId ?? DefaultRender()) : null;
            personal = Swap(personal, pid2, "personal");
            stream = Swap(stream, streamMode ? streamId : null, "stream");
            // v2.4.2: one low-latency sink per device that EQ'd Direct channels play on
            var wantHear = new HashSet<string>();
            foreach (var ch in chans.Values) if (ch.Hear && ch.Mode != "cable") { ch.HearOut ??= DefaultRender(); if (ch.HearOut != null) wantHear.Add(ch.HearOut); }
            foreach (var k in hearSinks.Keys.Where(k => !wantHear.Contains(k)).ToList()) { hearSinks[k]?.Dispose(); hearSinks.Remove(k); hearBus.Remove(k); hearLim.Remove(k); }
            foreach (var id in wantHear) if (!hearSinks.ContainsKey(id)) { try { hearSinks[id] = new OutputSink(en, id, 15, 60); hearBus[id] = new float[9600]; hearLim[id] = new Limiter(); } catch (Exception e) { Err("eq output", e); } }
            // ----- mic -----
            var m = cfg["mic"];
            chainOn = (bool?)m?["chain"] ?? false;
            gate.Enabled = (bool?)m?["gate"]?["enabled"] ?? false; gate.ThresholdDb = (double?)m?["gate"]?["thresholdDb"] ?? -45;
            gate.ReleaseMs = (double?)m?["gate"]?["releaseMs"] ?? 120; gate.HoldMs = (double?)m?["gate"]?["holdMs"] ?? 150;
            gate.AttackMs = (double?)m?["gate"]?["attackMs"] ?? 2; gate.RangeDb = (double?)m?["gate"]?["rangeDb"] ?? -60;
            nsOn = (bool?)m?["ns"]?["enabled"] ?? false;
            clearcast = (bool?)m?["clearcast"] ?? false;
            bypass = (bool?)m?["bypass"] ?? false;
            vc.NsOn = nsOn || clearcast; vc.ClearCast = clearcast;
            vc.NsAmount = nsOn ? Math.Clamp((double?)m?["ns"]?["amount"] ?? 0.9, 0, 1) : 0;
            vc.NsEngine = (string)m?["ns"]?["engine"] ?? "deep"; vc.ModelPath = (string)m?["ns"]?["modelPath"];
            vc.HpfOn = (bool?)m?["hpf"]?["enabled"] ?? true; vc.HpfFreq = Math.Clamp((double?)m?["hpf"]?["freq"] ?? 90, 40, 300);
            bool aecOn = chainOn && ((bool?)m?["aec"]?["enabled"] ?? false);
            vc.AecOn = aecOn; vc.AecStrength = ((string)m?["aec"]?["strength"] ?? "strong") switch { "mild" => 0, "max" => 2, _ => 1 };
            vc.AecFixedDelayMs = (int?)m?["aec"]?["delayMs"] ?? -1;
            string refWant = aecOn ? ((string)m?["aec"]?["refId"] ?? DefaultRender()) : null;
            if (refWant != aecRefId)
            {
                try { aecRef?.Dispose(); } catch { }
                aecRef = null; aecRefId = refWant; vc.Reference = null;
                if (refWant != null) { try { aecRef = new DeviceSource(en, refWant, true); vc.Reference = aecRef.Ring; } catch (Exception e) { Err("echo reference", e); } }
            }
            monitorOn = (chainOn || ((bool?)m?["changer"]?["enabled"] ?? false)) && ((bool?)m?["monitor"]?["enabled"] ?? false); // v2.5.0: "hear myself" also works for the voice changer alone
            monitorVol = (float)Math.Clamp((double?)m?["monitor"]?["volume"] ?? 0.8, 0, 1.5);
            monitor = Swap(monitor, monitorOn ? ((string)m?["monitor"]?["deviceId"] ?? personalId ?? DefaultRender()) : null, "mic monitor");
            comp.Enabled = (bool?)m?["comp"]?["enabled"] ?? false; comp.ThresholdDb = (double?)m?["comp"]?["thresholdDb"] ?? -18;
            comp.Ratio = (double?)m?["comp"]?["ratio"] ?? 3; comp.MakeupDb = (double?)m?["comp"]?["makeupDb"] ?? 4;
            comp.AttackMs = (double?)m?["comp"]?["attackMs"] ?? 5; comp.ReleaseMs = (double?)m?["comp"]?["releaseMs"] ?? 120;
            micEq.Configure(m?["eq"]);
            micGain = Db.ToLin((double?)m?["gainDb"] ?? 0); micMuted = (bool?)m?["muted"] ?? false; micToCable = (bool?)m?["toCable"] ?? true; // v2.6.0 bus matrix: mic -> B1 off keeps the cable fed with silence
            micInStream = (bool?)m?["inStream"] ?? true; micInClip = (bool?)m?["inClip"] ?? true; micInRec = (bool?)m?["inRec"] ?? true;
            // v2.3.1: the virtual-mic cable gets your mic whenever one is chosen (processed if the chain is on, raw otherwise)
            string micOutId = (string)m?["outId"]; if (string.IsNullOrEmpty(micOutId)) micOutId = null;
            micOut = Swap(micOut, micOutId, "mic out");
            // ----- v2.5.0 voice changer (off unless the user turns it on) -----
            var vcc = VcConfig.From(m?["changer"]); changerOn = vcc.Enabled;
            try { changer.Configure(vcc); } catch (Exception e) { Err("voice changer", e); }
            // ----- voice -----
            var v = cfg["voice"];
            voiceOn = (bool?)v?["enabled"] ?? false; voiceModel = (string)v?["modelPath"] ?? ""; voicePhrase = (string)v?["phrase"] ?? "clip it";
            if (voiceOn) Voice.Configure(voiceModel, voicePhrase);
            // ----- clips -----
            var cl = cfg["clip"];
            clipOn = (bool?)cl?["enabled"] ?? false;
            int secs = Math.Clamp((int?)cl?["bufferSeconds"] ?? 60, 10, 1200);
            if (clipRing.Length != secs * 96000) { clipRing = new short[secs * 96000]; clipMic = new short[secs * 48000]; clipWritten = 0; }
            clipSource = (string)cl?["source"] ?? "auto";
            string sysId = clipOn && clipSource != "apps" ? ((string)cl?["systemDevice"] ?? DefaultRender()) : null;
            if (sysId != clipSysWant)
            {
                try { sysLoop?.Dispose(); } catch { }
                sysLoop = null; clipSysWant = sysId;
                if (sysId != null) { try { sysLoop = new DeviceSource(en, sysId, true); } catch (Exception e) { Err("system loopback", e); } }
            }
            // mic capture needed?
            bool needMic = (bool?)m?["meter"] ?? true;
            needMic |= chainOn || voiceOn || changerOn || micOutId != null || ((streamMode && micInStream) || (clipOn && micInClip) || (rec != null && micInRec));
            string wantMic = needMic ? (string)m?["deviceId"] : null;
            if (wantMic != micId)
            {
                try { mic?.Dispose(); } catch { }
                mic = null; micId = wantMic; micRing.Clear();
                if (!string.IsNullOrEmpty(wantMic))
                {
                    try
                    {
                        mic = new DeviceSource(en, wantMic, false);
                        micRs = new Resampler(mic.SampleRate);
                        mic.OnRaw = MicRaw;
                    }
                    catch (Exception e) { Err("mic", e); mic = null; }
                }
            }
            if (!running) Start();
        }
    }

    string DefaultRender() { try { return en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { return null; } }

    static JsonNode SinkJson(OutputSink s) => s == null ? null : new JsonObject { ["id"] = s.DeviceId, ["rate"] = s.Rate, ["channels"] = s.Channels, ["written"] = s.Written, ["error"] = s.Error };
    OutputSink Swap(OutputSink cur, string id, string what)
    {
        if (cur != null && cur.DeviceId == id) return cur;
        cur?.Dispose();
        if (string.IsNullOrEmpty(id)) return null;
        try { return new OutputSink(en, id); } catch (Exception e) { Err(what, e); return null; }
    }

    // Mic chain runs on the capture thread for minimum latency.
    readonly FloatRing micTmpRing = new(48000 * 2);
    float[] micStereoTmp = new float[8192];
    void MicRaw(float[] buf, int frames, int ch)
    {
        // -> 48k stereo via resampler into temp ring, then fold to mono
        micRs.Push(buf, frames, ch, micTmpRing);
        int avail = micTmpRing.Count / 2; if (avail == 0) return;
        if (micStereoTmp.Length < avail * 2) micStereoTmp = new float[avail * 2];
        micTmpRing.Read(micStereoTmp, avail * 2, 48000 * 2);
        if (micMono.Length < avail) micMono = new float[avail];
        float pre = 0;
        for (int i = 0; i < avail; i++) { float v = ch > 1 ? (micStereoTmp[i * 2] + micStereoTmp[i * 2 + 1]) * 0.5f : micStereoTmp[i * 2]; micMono[i] = v; if (Math.Abs(v) > pre) pre = Math.Abs(v); }
        if (pre > MicPeakPre) MicPeakPre = pre;
        if (voiceOn) { try { Voice.Feed(micMono, avail); } catch (Exception e) { Err("voice", e); } }
        MicChain(micMono, avail);
        float g = micMuted ? 0 : micGain; float post = 0;
        for (int i = 0; i < avail; i++) { micMono[i] *= g; if (Math.Abs(micMono[i]) > post) post = Math.Abs(micMono[i]); }
        micLim.Process(micMono, avail);
        if (post > MicPeakPost) MicPeakPost = post;
        var st = new float[avail * 2];
        for (int i = 0; i < avail; i++) { st[i * 2] = micMono[i]; st[i * 2 + 1] = micMono[i]; }
        micRing.Write(st, st.Length);
        if (micOut != null)
        {
            if (bus.Enabled)
            {   // v2.6.0 B1 bus: extra inputs routed to the virtual mic + B1 processing
                try { var b1 = micToCable ? (float[])st.Clone() : new float[st.Length]; var ex = new float[b1.Length]; int got = bus.B1Ring.Count >= b1.Length ? bus.B1Ring.Read(ex, b1.Length, 9600) : 0; if (got > 0) for (int i = 0; i < b1.Length; i++) b1[i] += ex[i]; bus.ApplyFx("B1", b1, b1.Length); micOut.Write(b1, b1.Length); }
                catch (Exception e) { Err("B1", e); micOut.Write(st, st.Length); }
            }
            else micOut.Write(micToCable ? st : new float[st.Length], st.Length);
        }
        if (monitor != null) { if (monitorVol != 1) for (int i = 0; i < st.Length; i++) st[i] *= monitorVol; monitor.Write(st, st.Length); }
    }

    // v2.6.0 calibration recording: raw mic + exactly what the voice changer receives, local files only
    WaveFileWriter calRaw, calIn; long calFrames, calMax; float calPeak; readonly object calL = new();
    public void CalStart(string inPath, string rawPath, double maxSec)
    {
        lock (calL) { CalStopInner(); Directory.CreateDirectory(Path.GetDirectoryName(inPath)); calIn = new WaveFileWriter(inPath, WaveFormat.CreateIeeeFloatWaveFormat(48000, 1)); calRaw = new WaveFileWriter(rawPath, WaveFormat.CreateIeeeFloatWaveFormat(48000, 1)); calFrames = 0; calPeak = 0; calMax = (long)(Math.Clamp(maxSec, 5, 60) * 48000); }
        lock (l) { if (mic == null) throw new Exception("no microphone is open"); }
    }
    void CalStopInner() { try { calIn?.Dispose(); } catch { } try { calRaw?.Dispose(); } catch { } calIn = null; calRaw = null; }
    public JsonObject CalStop() { lock (calL) { var r = new JsonObject { ["seconds"] = Math.Round(calFrames / 48000.0, 2), ["peakDb"] = Math.Round(20 * Math.Log10(calPeak + 1e-9), 1) }; CalStopInner(); return r; } }
    public JsonObject CalState() { lock (calL) return new JsonObject { ["recording"] = calIn != null, ["seconds"] = Math.Round(calFrames / 48000.0, 2), ["peak"] = Math.Round(calPeak, 3) }; }
    void CalWrite(WaveFileWriter w, float[] x, int n, bool count)
    {
        lock (calL)
        {
            if (w == null || calIn == null) return;
            w.WriteSamples(x, 0, n);
            if (count) { for (int i = 0; i < n; i++) { var a = Math.Abs(x[i]); if (a > calPeak) calPeak = a; } calFrames += n; if (calFrames >= calMax) CalStopInner(); }
        }
    }

    void MicChain(float[] mono, int n)
    {
        bool on = chainOn && !bypass;
        if (calIn != null) CalWrite(calRaw, mono, n, false);
        // HPF -> echo cancel -> DeepFilterNet/RNNoise, then the voice gate (much easier once the noise floor is gone)
        if (on) { try { vc.Process(mono, n); } catch (Exception e) { Err("voice chain", e); } gate.Process(mono, n); }
        if (calIn != null) CalWrite(calIn, mono, n, true);
        // v2.5.0: voice changer works on the cleaned-up voice, before EQ/compressor shape the final sound
        if (changerOn) { try { changer.Process(mono, n); } catch (Exception e) { Err("voice changer", e); } }
        if (on) { micEq.Process(mono, n, 1); comp.Process(mono, n); }
    }

    // v2.4.2 EQ check: tones through the real mic-chain code (configured from the same JSON the app sends) and through a
    // playback channel's EQ, reporting the gain at each frequency.
    public static string EqTest()
    {
        var sb = new System.Text.StringBuilder(); bool ok = true;
        string Bands(string type, double f, double g) => $"[{{\"type\":\"lowcut\",\"f\":30,\"g\":0,\"q\":0.7,\"on\":false}},{{\"type\":\"lowshelf\",\"f\":90,\"g\":{(type == "lowshelf" ? g : 0)},\"q\":0.7,\"on\":true}},{{\"type\":\"peak\",\"f\":250,\"g\":{(type == "peak" && f == 250 ? g : 0)},\"q\":1,\"on\":true}},{{\"type\":\"peak\",\"f\":1000,\"g\":{(type == "peak" && f == 1000 ? g : 0)},\"q\":1,\"on\":true}},{{\"type\":\"peak\",\"f\":3000,\"g\":{(type == "peak" && f == 3000 ? g : 0)},\"q\":1,\"on\":true}},{{\"type\":\"highshelf\",\"f\":9000,\"g\":{(type == "highshelf" ? g : 0)},\"q\":0.7,\"on\":true}},{{\"type\":\"highcut\",\"f\":20000,\"g\":0,\"q\":0.7,\"on\":false}}]";
        double Rms(float[] x, int from) { double a = 0; for (int i = from; i < x.Length; i++) a += x[i] * x[i]; return Math.Sqrt(a / (x.Length - from)); }
        float[] Tone(double f, int ch) { var t = new float[48000 * ch]; for (int i = 0; i < 48000; i++) for (int c = 0; c < ch; c++) t[i * ch + c] = (float)(0.1 * Math.Sin(2 * Math.PI * f * i / 48000)); return t; }
        var cases = new[] { ("peak", 1000.0, 6.0, 1000.0, 6.0), ("peak", 1000.0, 6.0, 250.0, 0.0), ("peak", 1000.0, 6.0, 4000.0, 0.0), ("peak", 250.0, 6.0, 250.0, 6.0), ("peak", 3000.0, -6.0, 3000.0, -6.0), ("lowshelf", 90.0, 6.0, 40.0, 6.0), ("highshelf", 9000.0, 6.0, 16000.0, 6.0) };
        // mic chain: gate / NS / comp / HPF / AEC off so only the EQ shapes the level
        var eng = new Engine(new MMDeviceEnumerator());
        foreach (var (type, f, g, at, want) in cases)
        {
            foreach (var path in new[] { "mic", "playback" })
            {
                var eqJson = JsonNode.Parse($"{{\"enabled\":true,\"preampDb\":0,\"bands\":{Bands(type, f, g)}}}");
                double gotDb;
                if (path == "mic")
                {
                    eng.Configure(JsonNode.Parse($"{{\"channels\":[],\"mic\":{{\"deviceId\":null,\"meter\":false,\"chain\":true,\"gate\":{{\"enabled\":false}},\"ns\":{{\"enabled\":false}},\"comp\":{{\"enabled\":false}},\"hpf\":{{\"enabled\":false}},\"aec\":{{\"enabled\":false}},\"eq\":{eqJson.ToJsonString()}}}}}"));
                    var x = Tone(at, 1); double before = Rms(x, 9600);
                    for (int p = 0; p < x.Length; p += 480) { var blk = new float[480]; Array.Copy(x, p, blk, 0, 480); eng.MicChain(blk, 480); Array.Copy(blk, 0, x, p, 480); }
                    gotDb = 20 * Math.Log10(Rms(x, 9600) / before);
                }
                else
                {
                    var e = new Equalizer(); e.Configure(eqJson); var x = Tone(at, 2); double before = Rms(x, 19200);
                    for (int p = 0; p < x.Length; p += 960) { var blk = new float[960]; Array.Copy(x, p, blk, 0, 960); e.Process(blk, 480, 2); Array.Copy(blk, 0, x, p, 960); }
                    gotDb = 20 * Math.Log10(Rms(x, 19200) / before);
                }
                bool pass = Math.Abs(gotDb - want) < (want == 0 ? 1.0 : 0.6); ok &= pass;
                sb.AppendLine($"{(pass ? "PASS" : "FAIL")} {path,-8} {type} {f} Hz {g:+0;-0} dB -> tone {at} Hz changed {gotDb:+0.00;-0.00} dB (expected ~{want:+0;-0;0})");
            }
        }
        eng.Reset();
        sb.AppendLine(ok ? "ALL EQ CHECKS PASSED" : "EQ CHECK FAILED");
        return sb.ToString();
    }

    void Start()
    {
        running = true;
        try { timeBeginPeriod(1); } catch { }
        thread = new Thread(Loop) { IsBackground = true, Name = "mixer", Priority = ThreadPriority.AboveNormal };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    void Loop()
    {
        var sw = Stopwatch.StartNew(); long produced = 0;
        float[] chBuf = new float[9600], exBuf = new float[9600], src = new float[9600], pBus = new float[9600], sBus = new float[9600], cBus = new float[9600], rBus = new float[9600], micBuf = new float[9600];
        var lastStatus = DateTime.UtcNow;
        while (running)
        {
            Thread.Sleep(5);
            long target = sw.ElapsedTicks * 48000 / Stopwatch.Frequency;
            int frames = (int)Math.Min(4800, target - produced);
            if (frames < 240) continue;
            produced += frames;
            int n = frames * 2;
            lock (l)
            {
                try
                {
                    Array.Clear(pBus, 0, n); Array.Clear(sBus, 0, n); Array.Clear(cBus, 0, n); Array.Clear(rBus, 0, n);
                    foreach (var hb in hearBus.Values) Array.Clear(hb, 0, n);
                    bus.Begin(n);
                    bool chatMixApplied = false; long nowTicks = DateTime.UtcNow.Ticks;
                    foreach (var ch in chans.Values)
                    {
                        Array.Clear(chBuf, 0, n); bool has = false, excluded = false;
                        if (ch.Mode == "cable" && ch.CableId != null && cables.TryGetValue(ch.CableId, out var cs))
                        { cs.Ring.Read(src, n, 9600); Add(chBuf, src, n, 1); has = true; }
                        else foreach (var p in ch.Pids)
                            if (procRings.TryGetValue(p, out var r))
                            {
                                // Hear: only an app whose session is already turned down is scaled up by Comp (else silence for that moment, never a burst)
                                float g = !ch.Hear ? 1 : (Program.Ducked.TryGetValue(p, out var dt) && dt <= nowTicks ? 1 : 0);
                                r.Read(src, n, ch.Hear ? 2880 : 9600); Add(chBuf, src, n, g); has = true;
                                if (streamMode && streamExclude.Contains(p)) { if (!excluded) { Array.Clear(exBuf, 0, n); excluded = true; } Add(exBuf, src, n, g); }
                            }
                        if (!has) { ch.Peak = 0; continue; }
                        if (ch.Comp != 1) { for (int i = 0; i < n; i++) chBuf[i] *= ch.Comp; if (excluded) for (int i = 0; i < n; i++) exBuf[i] *= ch.Comp; }
                        // stream copy without the left-out apps (voice chat on the mic cable), EQ'd on its own filter state
                        if (excluded) { for (int i = 0; i < n; i++) exBuf[i] = chBuf[i] - exBuf[i]; ch.EqS.Process(exBuf, frames, 2); }
                        ch.Eq.Process(chBuf, frames, 2);
                        bus.ChannelFx(ch.Id, chBuf, frames);
                        bus.AddStrip("ch:" + ch.Id, chBuf, n, ch.Muted ? 0 : ch.Vol);
                        float pk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(chBuf[i]); if (a > pk) pk = a; }
                        ch.Peak = Math.Max(ch.Peak * 0.7f, pk * (ch.Muted ? 0 : ch.Vol));
                        if (ch.Mode == "cable" && !ch.Muted) Add(pBus, chBuf, n, ch.Vol);
                        else if (ch.Hear && !ch.Muted && ch.HearOut != null && hearBus.TryGetValue(ch.HearOut, out var hb2)) Add(hb2, chBuf, n, ch.Vol);
                        float bv = streamMode ? (ch.StreamMuted ? 0 : ch.StreamVol * (ch.Hear ? ch.Vol : 1)) : (ch.Muted ? 0 : ch.Vol); // Hear: the session no longer carries the channel volume, so apply it here to keep stream levels as before
                        if (streamMode) Add(sBus, excluded ? exBuf : chBuf, n, bv);
                        float pv = ch.Muted ? 0 : ch.Vol; // clips & recordings follow what you hear, not the stream mix
                        if (ch.InClip) Add(cBus, chBuf, n, pv);
                        if (ch.InRec) Add(rBus, chBuf, n, pv);
                        chatMixApplied = true;
                    }
                    // system loopback (fallback / forced source for clips)
                    float appPk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(cBus[i]); if (a > appPk) appPk = a; }
                    bool useSys = false;
                    if (sysLoop != null)
                    {
                        sysLoop.Ring.Read(src, n, 9600);
                        float sysPk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(src[i]); if (a > sysPk) sysPk = a; }
                        if (clipSource == "system") useSys = true;
                        else
                        {
                            // auto: per-app capture unless it has been silent ~1 s while the output device is playing
                            appSilentBlocks = appPk < 0.0015f ? appSilentBlocks + 1 : 0;
                            sysQuietBlocks = sysPk < 0.003f ? sysQuietBlocks + 1 : 0;
                            if (ClipUsing == "apps" && appSilentBlocks > 100 && sysPk > 0.003f) ClipUsing = "system";
                            else if (ClipUsing == "system" && appPk > 0.004f) ClipUsing = "apps";
                            useSys = ClipUsing == "system";
                        }
                        if (useSys) { Array.Copy(src, cBus, n); if (rec != null) Array.Copy(src, rBus, n); }
                    }
                    if (clipSource == "system") ClipUsing = sysLoop != null ? "system" : "apps";
                    else if (sysLoop == null) ClipUsing = "apps";
                    Array.Clear(micBuf, 0, n);
                    if (mic != null)
                    {
                        micRing.Read(micBuf, n, 4800);
                        if (streamMode && micInStream) Add(sBus, micBuf, n, 1);
                        if (micInRec) Add(rBus, micBuf, n, 1);
                        bus.AddStrip("mic", micBuf, n, 1);
                    }
                    bus.Inputs(n, personal != null ? pBus : null, sBus, stream != null);
                    if (personal != null) { bus.ApplyFx("A1", pBus, n); Clip(pBus, n); personal.Write(pBus, n); }
                    foreach (var (hid, hs) in hearSinks) { var hb = hearBus[hid]; bus.ApplyFx("A1", hb, n); hearLim[hid].Process(hb, n); Clip(hb, n); hs.Write(hb, n); }
                    if (stream != null) { if (streamGain != 1) for (int i = 0; i < n; i++) sBus[i] *= streamGain; bus.ApplyFx("B2", sBus, n); Clip(sBus, n); stream.Write(sBus, n); }
                    bus.End(n);
                    if (clipOn)
                    {
                        Clip(cBus, n); float dk = 0, mk = 0;
                        long fw = clipWritten / 2; int mlen = clipMic.Length;
                        for (int i = 0; i < n; i++) { clipRing[(clipWritten + i) % clipRing.Length] = (short)(cBus[i] * 32767); var a = Math.Abs(cBus[i]); if (a > dk) dk = a; }
                        bool mOn = mic != null && micInClip;
                        for (int f = 0; f < frames; f++) { float v = mOn ? Math.Clamp(micBuf[f * 2], -1f, 1f) : 0f; clipMic[(fw + f) % mlen] = (short)(v * 32767); var a = Math.Abs(v); if (a > mk) mk = a; }
                        clipWritten += n;
                        if (dk > ClipDeskPeak) ClipDeskPeak = dk; if (mk > ClipMicPeak) ClipMicPeak = mk;
                    }
                    if (rec != null) { Clip(rBus, n); rec.WriteSamples(rBus, 0, n); recFrames += frames; }
                }
                catch (Exception e) { Err("mixer", e); }
            }
            if ((DateTime.UtcNow - lastStatus).TotalMilliseconds > 1000) { lastStatus = DateTime.UtcNow; Emit?.Invoke(new JsonObject { ["event"] = "engine", ["data"] = Status() }); }
        }
    }

    static void Add(float[] dst, float[] s, int n, float g) { if (g == 0) return; for (int i = 0; i < n; i++) dst[i] += s[i] * g; }
    static void Clip(float[] b, int n) { for (int i = 0; i < n; i++) { var v = b[i]; b[i] = v > 1 ? 1 : v < -1 ? -1 : v; } }

    public JsonObject Levels()
    {
        var o = new JsonObject(); var pp = new JsonObject(); JsonArray captured; string hearErr;
        lock (l)
        {
            foreach (var c in chans.Values) { o[c.Id] = Math.Round(c.Peak, 3); }
            // v2.3: each captured app's own level (pre channel volume/mute), so its bar moves with its own audio
            var comp = new Dictionary<int, float>(); foreach (var c in chans.Values) if (c.Comp != 1) foreach (var q in c.Pids) comp[q] = c.Comp;
            foreach (var p in procs.Values) { pp[p.Pid.ToString()] = Math.Round(Math.Min(1, p.Peak * (comp.TryGetValue(p.Pid, out var k) ? k : 1)), 3); p.Peak *= 0.5f; }
            captured = new JsonArray(procs.Values.Where(p => p.Error == null).Select(p => (JsonNode)p.Pid).ToArray());
            hearErr = string.Join("; ", hearSinks.Values.Where(h => h?.Error != null).Select(h => h.Error));
        }
        var r = new JsonObject { ["channels"] = o, ["procs"] = pp, ["captured"] = captured, ["hearError"] = hearErr == "" ? null : hearErr, ["micPre"] = Math.Round(MicPeakPre, 3), ["micPost"] = Math.Round(MicPeakPost, 3), ["gr"] = Math.Round(comp.GainReductionDb, 1), ["gate"] = gate.Open, ["vad"] = Math.Round(vc.Vad, 2) };
        // v2.3.1: what actually went into the virtual-mic / stream cables
        var mo = micOut; var so = stream; r["micOutPk"] = mo != null ? Math.Round(mo.Peak, 3) : -1; r["streamPk"] = so != null ? Math.Round(so.Peak, 3) : -1; if (mo != null) mo.Peak *= 0.5f; if (so != null) so.Peak *= 0.5f;
        r["changer"] = changer.Status();
        lock (l) r["bus"] = bus.Levels();
        r["ns"] = new JsonObject { ["engine"] = vc.NsActive, ["cutDb"] = Math.Round(vc.NsCutDb, 1), ["lsnr"] = Math.Round(vc.Lsnr, 1), ["cpuMs"] = Math.Round(vc.CpuMs, 2), ["error"] = vc.NsError,
            ["aecCutDb"] = Math.Round(vc.AecCutDb, 1), ["refActive"] = vc.RefActive, ["nearTalk"] = vc.NearTalk, ["aecDelayMs"] = Math.Round(vc.AecDelayMs), ["aec"] = vc.AecOn && aecRef != null, ["bypass"] = bypass };
        MicPeakPre *= 0.5f; MicPeakPost *= 0.5f;
        r["clipDesk"] = Math.Round(ClipDeskPeak, 3); r["clipMic"] = Math.Round(ClipMicPeak, 3); r["clipUsing"] = ClipUsing;
        ClipDeskPeak *= 0.5f; ClipMicPeak *= 0.5f;
        return r;
    }

    public JsonObject Status()
    {
        lock (l)
        {
            JsonArray errs; lock (errors) errs = new JsonArray(errors.Select(e => (JsonNode)e).ToArray());
            var srcErr = new JsonArray();
            foreach (var c in cables.Values) if (c.Error != null) srcErr.Add("cable: " + c.Error);
            foreach (var p in procs.Values) if (p.Error != null) srcErr.Add("app " + p.Pid + ": " + p.Error);
            if (mic?.Error != null) srcErr.Add("mic: " + mic.Error);
            foreach (var s in new[] { personal, stream, micOut }) if (s?.Error != null) srcErr.Add("output: " + s.Error);
            return new JsonObject
            {
                ["running"] = running, ["cables"] = cables.Count, ["appCaptures"] = new JsonArray(procs.Keys.Select(k => (JsonNode)k).ToArray()),
                ["personalOut"] = personal?.DeviceId, ["streamOut"] = stream?.DeviceId, ["micOut"] = micOut?.DeviceId, ["mic"] = micId,
                ["sinks"] = new JsonObject { ["stream"] = SinkJson(stream), ["micOut"] = SinkJson(micOut), ["personal"] = SinkJson(personal) },
                ["rnnoise"] = vc.NsActive, ["nsError"] = vc.NsError,
                ["voice"] = new JsonObject { ["enabled"] = voiceOn, ["ready"] = Voice.Ready, ["error"] = Voice.Error, ["heard"] = Voice.LastHeard, ["phrase"] = voicePhrase },
                ["clip"] = new JsonObject { ["source"] = clipSource, ["using"] = ClipUsing, ["systemDevice"] = sysLoop?.DeviceId, ["systemError"] = sysLoop?.Error, ["enabled"] = clipOn, ["buffered"] = Math.Round(Math.Min(clipWritten, clipRing.Length) / 96000.0, 1), ["capacity"] = clipRing.Length / 96000 },
                ["record"] = new JsonObject { ["active"] = rec != null, ["seconds"] = Math.Round(recFrames / 48000.0, 1), ["path"] = recPath },
                ["errors"] = errs, ["sourceErrors"] = srcErr,
                ["captured"] = new JsonArray(procs.Values.Where(p => p.Error == null).Select(p => (JsonNode)p.Pid).ToArray()),
                ["hearError"] = hearSinks.Values.Any(h => h?.Error != null) ? string.Join("; ", hearSinks.Values.Where(h => h?.Error != null).Select(h => h.Error)) : null,
                ["ducked"] = new JsonArray(Program.Ducked.Keys.Select(k => (JsonNode)k).ToArray()),
            };
        }
    }

    // Writes the last `seconds` of the clip audio: <path> = desktop+mic mix, <path>.desk.wav and <path>.mic.wav as separate tracks.
    public JsonNode SaveClip(string path, double seconds)
    {
        short[] copy, mcopy; long written; int len; bool hasMic;
        lock (l) { written = clipWritten; len = clipRing.Length; copy = (short[])clipRing.Clone(); mcopy = (short[])clipMic.Clone(); hasMic = mic != null && micInClip; }
        long want = Math.Min((long)(seconds * 96000), Math.Min(written, len)); want -= want % 2;
        if (want <= 0) throw new Exception("clip buffer is empty");
        long start = written - want; long frames = want / 2; long fstart = start / 2; int mlen = mcopy.Length;
        var mix = new byte[want * 2]; var desk = new byte[want * 2]; var mb = new byte[frames * 2];
        double dSum = 0, mSum = 0;
        for (long f = 0; f < frames; f++)
        {
            short m = mcopy[(fstart + f) % mlen]; mb[f * 2] = (byte)m; mb[f * 2 + 1] = (byte)(m >> 8); mSum += (double)m * m;
            for (int c = 0; c < 2; c++)
            {
                long i = f * 2 + c; short d = copy[(start + i) % len];
                desk[i * 2] = (byte)d; desk[i * 2 + 1] = (byte)(d >> 8); dSum += (double)d * d;
                int x = Math.Clamp(d + m, -32768, 32767); mix[i * 2] = (byte)x; mix[i * 2 + 1] = (byte)(x >> 8);
            }
        }
        using (var w = new WaveFileWriter(path, new WaveFormat(48000, 16, 2))) w.Write(mix, 0, mix.Length);
        using (var w = new WaveFileWriter(path + ".desk.wav", new WaveFormat(48000, 16, 2))) w.Write(desk, 0, desk.Length);
        if (hasMic) using (var w = new WaveFileWriter(path + ".mic.wav", new WaveFormat(48000, 16, 1))) w.Write(mb, 0, mb.Length);
        double dRms = Math.Sqrt(dSum / Math.Max(1, want)) / 32768, mRms = Math.Sqrt(mSum / Math.Max(1, frames)) / 32768;
        return new JsonObject { ["path"] = path, ["seconds"] = want / 96000.0, ["desk"] = path + ".desk.wav", ["mic"] = hasMic ? path + ".mic.wav" : null,
            ["deskDb"] = Math.Round(Db.ToDb(dRms), 1), ["micDb"] = Math.Round(Db.ToDb(mRms), 1), ["using"] = ClipUsing };
    }

    public void RecStart(string path)
    {
        lock (l) { rec?.Dispose(); rec = new WaveFileWriter(path, WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)); recPath = path; recFrames = 0; }
    }
    public JsonNode RecStop()
    {
        lock (l) { var p = recPath; var s = recFrames / 48000.0; rec?.Dispose(); rec = null; return new JsonObject { ["path"] = p, ["seconds"] = s }; }
    }

    public void Reset()
    {
        lock (l)
        {
            foreach (var c in cables.Values) c.Dispose(); cables.Clear();
            foreach (var p in procs.Values) p.Dispose(); procs.Clear(); procRings.Clear();
            personal?.Dispose(); personal = null; stream?.Dispose(); stream = null; micOut?.Dispose(); micOut = null;
            foreach (var hs in hearSinks.Values) hs?.Dispose(); hearSinks.Clear(); hearBus.Clear(); hearLim.Clear();
            try { changer.Configure(new VcConfig()); } catch { } changerOn = false;
            monitor?.Dispose(); monitor = null; try { aecRef?.Dispose(); } catch { } aecRef = null; aecRefId = null; vc.Reference = null;
            chans.Clear(); streamMode = false; bus.Dispose();
            try { sysLoop?.Dispose(); } catch { } sysLoop = null; clipSysWant = null;
        }
    }
}

// v2.4.1 real-device pitch test: 440 Hz through the engine's OutputSink into a render endpoint (e.g. Hi-Fi Cable Input),
// recorded from a capture endpoint (e.g. Hi-Fi Cable Output) through the engine's DeviceSource (-> 48 kHz).
static class ToneTest
{
    // Test source: plays sine tones (comma list, Hz) on a render device (id or name prefix) for secs at level each.
    public static void Play(string dev, double secs, string freqs, double level)
    {
        var en = new MMDeviceEnumerator(); string id = dev;
        foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)) if (d.ID == dev || d.FriendlyName.StartsWith(dev, StringComparison.OrdinalIgnoreCase)) { id = d.ID; break; }
        var fs = freqs.Split(',').Select(x => double.Parse(x, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        var sink = new OutputSink(en, id); var sw = Stopwatch.StartNew(); long made = 0; var blk = new float[960];
        while (sw.Elapsed.TotalSeconds < secs)
        {
            long target = (long)(sw.Elapsed.TotalSeconds * 48000) + 2400;
            while (made < target) { for (int i = 0; i < 480; i++) { double v = 0; foreach (var f in fs) v += level * Math.Sin(2 * Math.PI * f * (made + i) / 48000.0); blk[i * 2] = (float)v; blk[i * 2 + 1] = (float)v; } sink.Write(blk, 960); made += 480; }
            Thread.Sleep(5);
        }
        sink.Dispose();
    }
    public static int Run(string renderId, string captureId, double secs, double level)
    {
        var en = new MMDeviceEnumerator(); var sink = new OutputSink(en, renderId); var src = new DeviceSource(en, captureId, captureId == renderId); // same id = loopback of that output
        var rec = new List<float>(); var sw = Stopwatch.StartNew(); long made = 0; var blk = new float[960]; var rd = new float[48000 * 2];
        while (sw.Elapsed.TotalSeconds < secs)
        {
            long target = (long)(sw.Elapsed.TotalSeconds * 48000) + 2400;
            while (made < target) { for (int i = 0; i < 480; i++) { float v = (float)(level * Math.Sin(2 * Math.PI * 440 * (made + i) / 48000.0)); blk[i * 2] = v; blk[i * 2 + 1] = v; } sink.Write(blk, 960); made += 480; }
            int got = src.Ring.Count; if (got > 0) { src.Ring.Read(rd, Math.Min(got, rd.Length), 48000 * 8); for (int k = 0; k < Math.Min(got, rd.Length); k++) rec.Add(rd[k]); }
            Thread.Sleep(5);
        }
        sink.Dispose(); src.Dispose();
        var a = rec.ToArray(); int sk = Math.Min(a.Length, 48000); var b = a.Skip(sk).ToArray(); // skip the first second (start-up)
        float pk = 0; foreach (var v in b) pk = Math.Max(pk, Math.Abs(v));
        double f = PitchCheck.Freq(b, b.Length, 2, 48000);
        var o = new JsonObject { ["render"] = en.GetDevice(renderId).FriendlyName, ["renderRate"] = sink.Rate, ["capture"] = en.GetDevice(captureId).FriendlyName, ["captureRate"] = src.SampleRate,
            ["sentHz"] = 440, ["gotHz"] = Math.Round(f, 2), ["cents"] = f > 0 ? Math.Round(1200 * Math.Log2(f / 440), 1) : null, ["peakDb"] = pk > 0 ? Math.Round(20 * Math.Log10(pk), 1) : null };
        o["pass"] = f > 0 && Math.Abs(1200 * Math.Log2(f / 440)) < 10;
        Console.WriteLine(o.ToJsonString()); return 0;
    }
}

// v2.4.2: level of given frequencies on an output (WASAPI loopback, Goertzel), one line per 500 ms with a UTC timestamp.
static class ToneLevel
{
    public static void Run(string renderId, double secs, string freqs)
    {
        var fs = freqs.Split(',').Select(x => double.Parse(x, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        var en = new MMDeviceEnumerator(); var src = new DeviceSource(en, renderId, en.GetDevice(renderId).DataFlow == DataFlow.Render); // output: loopback, input: record it
        var sw = Stopwatch.StartNew(); var win = new List<float>(); double rmsAcc = 0; var rd = new float[48000 * 2];
        Console.WriteLine($"device {en.GetDevice(renderId).FriendlyName}");
        while (sw.Elapsed.TotalSeconds < secs)
        {
            Thread.Sleep(20); int got = src.Ring.Count; if (got > 0) { src.Ring.Read(rd, Math.Min(got, rd.Length), 48000 * 8); for (int k = 0; k + 1 < Math.Min(got, rd.Length); k += 2) win.Add((rd[k] + rd[k + 1]) * 0.5f); }
            if (win.Count >= 24000)
            {
                var x = win.Take(24000).ToArray(); win.RemoveRange(0, 24000);
                var parts = fs.Select(f => { double w = 2 * Math.PI * f / 48000, c = 2 * Math.Cos(w), s1 = 0, s2 = 0; foreach (var v in x) { double s0 = v + c * s1 - s2; s2 = s1; s1 = s0; } double p = Math.Sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) * 2 / x.Length; return $"{f}Hz={(p > 1e-7 ? 20 * Math.Log10(p) : -140):F1}dB"; });
                rmsAcc = Math.Sqrt(x.Select(v => (double)v * v).Average());
                Console.WriteLine($"{DateTime.UtcNow:HH:mm:ss.fff} " + string.Join(" ", parts) + $" all={(rmsAcc > 1e-7 ? 20 * Math.Log10(rmsAcc) : -140):F1}dB");
            }
        }
        src.Dispose();
    }
}

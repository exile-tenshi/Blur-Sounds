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
sealed class OutputSink : IDisposable
{
    public readonly string DeviceId; readonly WasapiOut wo; readonly BufferedWaveProvider bwp; byte[] bytes = new byte[0];
    public string Error;
    public OutputSink(MMDeviceEnumerator en, string id)
    {
        DeviceId = id;
        var dev = en.GetDevice(id);
        bwp = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)) { DiscardOnBufferOverflow = true, BufferDuration = TimeSpan.FromMilliseconds(600), ReadFully = true };
        wo = new WasapiOut(dev, AudioClientShareMode.Shared, true, 30);
        wo.Init(bwp); wo.Play();
        wo.PlaybackStopped += (s, e) => { if (e.Exception != null) Error = e.Exception.Message; };
    }
    public void Write(float[] stereo, int count)
    {
        // keep latency bounded: if more than 120 ms queued, drop this block
        if (bwp.BufferedDuration.TotalMilliseconds > 120) return;
        int nb = count * 4; if (bytes.Length < nb) bytes = new byte[nb];
        Buffer.BlockCopy(stereo, 0, bytes, 0, nb);
        bwp.AddSamples(bytes, 0, nb);
    }
    public void Dispose() { try { wo.Stop(); } catch { } try { wo.Dispose(); } catch { } }
}

sealed class ChannelCfg
{
    public string Id; public string Mode = "direct"; public string CableId; public int[] Pids = Array.Empty<int>();
    public float Vol = 1, StreamVol = 1; public bool Muted, StreamMuted; public bool InClip = true, InRec = true;
    public Equalizer Eq = new();
    public float Peak;
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
    readonly FloatRing micRing = new(48000 * 2);
    // mic chain
    readonly NoiseGate gate = new(); readonly Compressor comp = new(); readonly Equalizer micEq = new(); readonly Limiter micLim = new();
    readonly VoiceChain vc = new(); bool nsOn, clearcast, bypass; float micGain = 1; bool micMuted;
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
            // ----- channels -----
            var seen = new HashSet<string>(); var wantCables = new HashSet<string>(); var wantPids = new HashSet<int>();
            bool needCaptures = streamMode || ((bool?)cfg["clip"]?["enabled"] ?? false) || ((bool?)cfg["record"]?["active"] ?? false);
            string personalId = (string)cfg["personalOut"]; string streamId = (string)cfg["streamOut"];
            foreach (var c in (cfg["channels"] as JsonArray) ?? new JsonArray())
            {
                var id = (string)c["id"]; seen.Add(id);
                if (!chans.TryGetValue(id, out var ch)) chans[id] = ch = new ChannelCfg { Id = id };
                ch.Mode = (string)c["mode"] ?? "direct"; ch.CableId = (string)c["cableId"];
                ch.Vol = (float)((double?)c["volume"] ?? 1); ch.Muted = (bool?)c["muted"] ?? false;
                ch.StreamVol = (float)((double?)c["streamVolume"] ?? 1); ch.StreamMuted = (bool?)c["streamMuted"] ?? false;
                ch.InClip = (bool?)c["inClip"] ?? true; ch.InRec = (bool?)c["inRec"] ?? true;
                ch.Eq.Configure(c["eq"]);
                ch.Pids = ((c["pids"] as JsonArray) ?? new JsonArray()).Select(p => (int)p).ToArray();
                if (ch.Mode == "cable" && !string.IsNullOrEmpty(ch.CableId) && ch.CableId != personalId && ch.CableId != streamId) wantCables.Add(ch.CableId);
                else if (needCaptures) foreach (var p in ch.Pids) wantPids.Add(p);
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
            string pid2 = anyCable ? (personalId ?? DefaultRender()) : null;
            personal = Swap(personal, pid2, "personal");
            stream = Swap(stream, streamMode ? streamId : null, "stream");
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
            monitorOn = chainOn && ((bool?)m?["monitor"]?["enabled"] ?? false); monitorVol = (float)Math.Clamp((double?)m?["monitor"]?["volume"] ?? 0.8, 0, 1.5);
            monitor = Swap(monitor, monitorOn ? ((string)m?["monitor"]?["deviceId"] ?? personalId ?? DefaultRender()) : null, "mic monitor");
            comp.Enabled = (bool?)m?["comp"]?["enabled"] ?? false; comp.ThresholdDb = (double?)m?["comp"]?["thresholdDb"] ?? -18;
            comp.Ratio = (double?)m?["comp"]?["ratio"] ?? 3; comp.MakeupDb = (double?)m?["comp"]?["makeupDb"] ?? 4;
            comp.AttackMs = (double?)m?["comp"]?["attackMs"] ?? 5; comp.ReleaseMs = (double?)m?["comp"]?["releaseMs"] ?? 120;
            micEq.Configure(m?["eq"]);
            micGain = Db.ToLin((double?)m?["gainDb"] ?? 0); micMuted = (bool?)m?["muted"] ?? false;
            micInStream = (bool?)m?["inStream"] ?? true; micInClip = (bool?)m?["inClip"] ?? true; micInRec = (bool?)m?["inRec"] ?? true;
            string micOutId = chainOn ? (string)m?["outId"] : null;
            micOut = Swap(micOut, micOutId, "mic out");
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
            needMic |= chainOn || voiceOn || ((streamMode && micInStream) || (clipOn && micInClip) || (rec != null && micInRec));
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
        if (chainOn && !bypass)
        {
            // HPF -> echo cancel -> DeepFilterNet/RNNoise, then the voice gate (much easier once the noise floor is gone)
            try { vc.Process(micMono, avail); } catch (Exception e) { Err("voice chain", e); }
            gate.Process(micMono, avail);
            micEq.Process(micMono, avail, 1);
            comp.Process(micMono, avail);
        }
        float g = micMuted ? 0 : micGain; float post = 0;
        for (int i = 0; i < avail; i++) { micMono[i] *= g; if (Math.Abs(micMono[i]) > post) post = Math.Abs(micMono[i]); }
        micLim.Process(micMono, avail);
        if (post > MicPeakPost) MicPeakPost = post;
        var st = new float[avail * 2];
        for (int i = 0; i < avail; i++) { st[i * 2] = micMono[i]; st[i * 2 + 1] = micMono[i]; }
        micRing.Write(st, st.Length);
        micOut?.Write(st, st.Length);
        if (monitor != null) { if (monitorVol != 1) for (int i = 0; i < st.Length; i++) st[i] *= monitorVol; monitor.Write(st, st.Length); }
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
        float[] chBuf = new float[9600], src = new float[9600], pBus = new float[9600], sBus = new float[9600], cBus = new float[9600], rBus = new float[9600], micBuf = new float[9600];
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
                    bool chatMixApplied = false;
                    foreach (var ch in chans.Values)
                    {
                        Array.Clear(chBuf, 0, n); bool has = false;
                        if (ch.Mode == "cable" && ch.CableId != null && cables.TryGetValue(ch.CableId, out var cs))
                        { cs.Ring.Read(src, n, 9600); Add(chBuf, src, n, 1); has = true; }
                        else foreach (var p in ch.Pids)
                            if (procRings.TryGetValue(p, out var r)) { r.Read(src, n, 9600); Add(chBuf, src, n, 1); has = true; }
                        if (!has) { ch.Peak = 0; continue; }
                        ch.Eq.Process(chBuf, frames, 2);
                        float pk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(chBuf[i]); if (a > pk) pk = a; }
                        ch.Peak = Math.Max(ch.Peak * 0.7f, pk * (ch.Muted ? 0 : ch.Vol));
                        if (ch.Mode == "cable" && !ch.Muted) Add(pBus, chBuf, n, ch.Vol);
                        float bv = streamMode ? (ch.StreamMuted ? 0 : ch.StreamVol) : (ch.Muted ? 0 : ch.Vol);
                        if (streamMode) Add(sBus, chBuf, n, bv);
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
                    }
                    if (personal != null) { Clip(pBus, n); personal.Write(pBus, n); }
                    if (stream != null) { Clip(sBus, n); stream.Write(sBus, n); }
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
        var o = new JsonObject();
        lock (l)
        {
            foreach (var c in chans.Values) { o[c.Id] = Math.Round(c.Peak, 3); }
            foreach (var p in procs.Values) p.Peak *= 0.5f;
        }
        var r = new JsonObject { ["channels"] = o, ["micPre"] = Math.Round(MicPeakPre, 3), ["micPost"] = Math.Round(MicPeakPost, 3), ["gr"] = Math.Round(comp.GainReductionDb, 1), ["gate"] = gate.Open, ["vad"] = Math.Round(vc.Vad, 2) };
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
                ["rnnoise"] = vc.NsActive, ["nsError"] = vc.NsError,
                ["voice"] = new JsonObject { ["enabled"] = voiceOn, ["ready"] = Voice.Ready, ["error"] = Voice.Error, ["heard"] = Voice.LastHeard, ["phrase"] = voicePhrase },
                ["clip"] = new JsonObject { ["source"] = clipSource, ["using"] = ClipUsing, ["systemDevice"] = sysLoop?.DeviceId, ["systemError"] = sysLoop?.Error, ["enabled"] = clipOn, ["buffered"] = Math.Round(Math.Min(clipWritten, clipRing.Length) / 96000.0, 1), ["capacity"] = clipRing.Length / 96000 },
                ["record"] = new JsonObject { ["active"] = rec != null, ["seconds"] = Math.Round(recFrames / 48000.0, 1), ["path"] = recPath },
                ["errors"] = errs, ["sourceErrors"] = srcErr,
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
            monitor?.Dispose(); monitor = null; try { aecRef?.Dispose(); } catch { } aecRef = null; aecRefId = null; vc.Reference = null;
            chans.Clear(); streamMode = false;
            try { sysLoop?.Dispose(); } catch { } sysLoop = null; clipSysWant = null;
        }
    }
}

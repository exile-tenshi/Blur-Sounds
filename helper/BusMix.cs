// v2.6.0 bus mixer (Voicemeeter-style): strips (mic, playback channels, extra inputs) x buses (A1-A3 hardware, B1-B2 virtual).
// The existing routing stays the engine's own paths (A1 = personal/EQ'd playback, B1 = virtual-mic cable, B2 = stream mix);
// this class adds per-bus processing (gain, mute, EQ, limiter, delay, mono) for those, extra hardware buses A2/A3, extra input
// strips, and per-strip gate / compressor / pan / solo. With no "bus" config every path is untouched.
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;

namespace Bsp;

sealed class StripDyn
{
    // Stereo-linked gate + compressor on interleaved 48 kHz stereo.
    public bool GateOn, CompOn; public double GateDb = -50, GateRangeDb = -60, CompThr = -18, CompRatio = 3, CompMakeup = 0;
    double env, gg = 1, hold, cenv = -120;
    public double Gr { get; private set; }
    public void Process(float[] b, int frames)
    {
        if (!GateOn && !CompOn) return;
        double aE = Math.Exp(-1.0 / (0.005 * 48000)), aAtk = Math.Exp(-1.0 / (0.002 * 48000)), aRel = Math.Exp(-1.0 / (0.12 * 48000));
        double thr = Db.ToLin(GateDb), floor = Db.ToLin(GateRangeDb), cA = Math.Exp(-1.0 / (0.005 * 48000)), cR = Math.Exp(-1.0 / (0.12 * 48000)), mk = Db.ToLin(CompMakeup), maxGr = 0;
        for (int i = 0; i < frames; i++)
        {
            double x = Math.Max(Math.Abs(b[i * 2]), Math.Abs(b[i * 2 + 1])), g = 1;
            if (GateOn)
            {
                env = x > env ? x : aE * env + (1 - aE) * x;
                double t; if (env >= thr) { t = 1; hold = 7200; } else if (hold > 0) { t = 1; hold--; } else t = floor;
                gg = t > gg ? aAtk * gg + (1 - aAtk) * t : aRel * gg + (1 - aRel) * t; g *= gg;
            }
            if (CompOn)
            {
                double xd = Db.ToDb(x); cenv = xd > cenv ? cA * cenv + (1 - cA) * xd : cR * cenv + (1 - cR) * xd;
                double over = cenv - CompThr, gr = over <= -3 ? 0 : over >= 3 ? over - over / CompRatio : (1 - 1 / CompRatio) * (over + 3) * (over + 3) / 12;
                if (gr > maxGr) maxGr = gr; g *= Db.ToLin(-gr) * mk;
            }
            b[i * 2] = (float)(b[i * 2] * g); b[i * 2 + 1] = (float)(b[i * 2 + 1] * g);
        }
        Gr = maxGr;
    }
}

sealed class BusFx
{
    public string Id, DeviceId; public float Gain = 1; public bool Mute, Mono, LimOn; public double CeilDb = -1; public int DelaySamples;
    public readonly Equalizer Eq = new(); bool eqOn; float[] dl = new float[48000 * 2 * 2]; int dlPos; double lg = 1; public float Peak;
    public bool Neutral => Gain == 1 && !Mute && !Mono && !eqOn && DelaySamples == 0;
    public void Configure(JsonNode b)
    {
        Gain = (float)Db.ToLin(Math.Clamp((double?)b?["gainDb"] ?? 0, -60, 12)); Mute = (bool?)b?["mute"] ?? false; Mono = (bool?)b?["mono"] ?? false;
        LimOn = (bool?)b?["limiter"]?["enabled"] ?? false; CeilDb = Math.Clamp((double?)b?["limiter"]?["ceilingDb"] ?? -1, -24, 0);
        DelaySamples = (int)Math.Clamp(((double?)b?["delayMs"] ?? 0) * 48, 0, 48000 - 1);
        eqOn = (bool?)b?["eq"]?["enabled"] ?? false; Eq.Configure(b?["eq"]);
    }
    // interleaved stereo, in place
    public void Process(float[] s, int frames, bool limit)
    {
        int n = frames * 2;
        if (eqOn) Eq.Process(s, frames, 2);
        if (Mono) for (int i = 0; i < frames; i++) { float m = (s[i * 2] + s[i * 2 + 1]) * 0.5f; s[i * 2] = m; s[i * 2 + 1] = m; }
        float g = Mute ? 0 : Gain; if (g != 1) for (int i = 0; i < n; i++) s[i] *= g;
        if (DelaySamples > 0)
        {
            int len = dl.Length, d = DelaySamples * 2;
            for (int i = 0; i < n; i++) { dl[dlPos] = s[i]; int r = dlPos - d; if (r < 0) r += len; s[i] = dl[r]; dlPos = (dlPos + 1) % len; }
        }
        if (limit && LimOn)
        {
            double c = Db.ToLin(CeilDb);
            for (int i = 0; i < frames; i++)
            {
                double a = Math.Max(Math.Abs(s[i * 2]), Math.Abs(s[i * 2 + 1])) * lg;
                if (a > c) lg = c / Math.Max(Math.Abs(s[i * 2]), Math.Abs(s[i * 2 + 1])); else lg = Math.Min(1, lg + 0.0002);
                s[i * 2] = (float)(s[i * 2] * lg); s[i * 2 + 1] = (float)(s[i * 2 + 1] * lg);
            }
        }
        float pk = 0; for (int i = 0; i < n; i++) { var a = Math.Abs(s[i]); if (a > pk) pk = a; } if (pk > Peak) Peak = pk;
    }
}

sealed class StripCfg
{
    public string Id, Kind; public float Gain = 1, Pan; public bool Mute, Solo; public HashSet<string> Routes = new();
    public readonly StripDyn Dyn = new(); public readonly Equalizer Eq = new(); public bool EqOn; public float Peak;
    public DeviceSource Src; public string SrcId; public bool Loopback;
    public bool Neutral => Gain == 1 && Pan == 0 && !Mute && !Dyn.GateOn && !Dyn.CompOn;
    public void Configure(JsonNode s)
    {
        Kind = (string)s["kind"] ?? "channel"; Gain = (float)Db.ToLin(Math.Clamp((double?)s["gainDb"] ?? 0, -60, 12)); Pan = (float)Math.Clamp((double?)s["pan"] ?? 0, -1, 1);
        Mute = (bool?)s["mute"] ?? false; Solo = (bool?)s["solo"] ?? false;
        Routes = new HashSet<string>(((s["routes"] as JsonArray) ?? new JsonArray()).Select(r => (string)r));
        Dyn.GateOn = (bool?)s["gate"]?["enabled"] ?? false; Dyn.GateDb = (double?)s["gate"]?["thresholdDb"] ?? -50;
        Dyn.CompOn = (bool?)s["comp"]?["enabled"] ?? false; Dyn.CompThr = (double?)s["comp"]?["thresholdDb"] ?? -18; Dyn.CompRatio = Math.Max(1, (double?)s["comp"]?["ratio"] ?? 3); Dyn.CompMakeup = (double?)s["comp"]?["makeupDb"] ?? 0;
        EqOn = (bool?)s["eq"]?["enabled"] ?? false; Eq.Configure(s["eq"]);
    }
    public void Apply(float[] b, int frames, bool withGainEq)
    {
        if (withGainEq && EqOn) Eq.Process(b, frames, 2);
        Dyn.Process(b, frames);
        if (Pan != 0 || (withGainEq && (Gain != 1 || Mute)))
        {
            float g = withGainEq ? (Mute ? 0 : Gain) : 1; double th = (Pan + 1) * Math.PI / 4; float gl = (float)(Math.Cos(th) * Math.Sqrt(2)) * g, gr = (float)(Math.Sin(th) * Math.Sqrt(2)) * g;
            if (Pan == 0) { gl = g; gr = g; }
            for (int i = 0; i < frames; i++) { b[i * 2] *= gl; b[i * 2 + 1] *= gr; }
        }
        float pk = 0; for (int i = 0; i < frames * 2; i++) { var a = Math.Abs(b[i]); if (a > pk) pk = a; } Peak = Math.Max(Peak * 0.7f, pk);
    }
}

sealed class BusMixer
{
    public readonly Dictionary<string, BusFx> Fx = new();             // A1..A3, B1, B2
    public readonly Dictionary<string, OutputSink> Sinks = new();     // engine-rendered extra buses (A2, A3)
    public readonly Dictionary<string, float[]> Buf = new();
    public readonly Dictionary<string, StripCfg> Strips = new();
    public readonly FloatRing B1Ring = new(48000 * 2);
    public bool Enabled, AnySolo;
    float[] tmp = new float[9600], rd = new float[9600]; readonly float[] b1Acc = new float[9600]; bool b1Has; // B1: strips summed once per block, then handed to the mic thread
    static readonly string[] Extra = { "A2", "A3" };

    public void Configure(JsonNode cfg, MMDeviceEnumerator en, Action<string, Exception> err)
    {
        Enabled = cfg != null && ((bool?)cfg["enabled"] ?? true);
        var seenFx = new HashSet<string>();
        foreach (var b in (cfg?["outs"] as JsonArray) ?? new JsonArray())
        {
            var id = (string)b["id"]; if (id == null) continue; seenFx.Add(id);
            if (!Fx.TryGetValue(id, out var f)) Fx[id] = f = new BusFx { Id = id };
            f.Configure(b); f.DeviceId = (string)b["deviceId"];
        }
        foreach (var k in Fx.Keys.Where(k => !seenFx.Contains(k)).ToList()) Fx.Remove(k);
        var seen = new HashSet<string>();
        foreach (var s in (cfg?["strips"] as JsonArray) ?? new JsonArray())
        {
            var id = (string)s["id"]; if (id == null) continue; seen.Add(id);
            if (!Strips.TryGetValue(id, out var st)) Strips[id] = st = new StripCfg { Id = id };
            st.Configure(s);
            if (st.Kind == "input")
            {
                string want = Enabled ? (string)s["deviceId"] : null; bool lb = (bool?)s["loopback"] ?? false;
                if (want != st.SrcId || lb != st.Loopback)
                {
                    try { st.Src?.Dispose(); } catch { } st.Src = null; st.SrcId = want; st.Loopback = lb;
                    if (!string.IsNullOrEmpty(want)) { try { st.Src = new DeviceSource(en, want, lb); } catch (Exception e) { err("input " + want, e); } }
                }
            }
        }
        foreach (var k in Strips.Keys.Where(k => !seen.Contains(k)).ToList()) { try { Strips[k].Src?.Dispose(); } catch { } Strips.Remove(k); }
        AnySolo = Strips.Values.Any(s => s.Solo);
        // extra hardware buses only exist while something is routed to them
        foreach (var id in Extra)
        {
            string dev = Enabled && Fx.TryGetValue(id, out var f) && Strips.Values.Any(s => s.Routes.Contains(id)) ? f.DeviceId : null;
            Sinks.TryGetValue(id, out var cur);
            if (cur != null && cur.DeviceId == dev) continue;
            cur?.Dispose(); Sinks.Remove(id); Buf.Remove(id);
            if (!string.IsNullOrEmpty(dev)) { try { Sinks[id] = new OutputSink(en, dev, 20, 80); Buf[id] = new float[9600]; } catch (Exception e) { err(id + " output", e); } }
        }
    }
    public bool Routed(string strip, string bus) => Enabled && Strips.TryGetValue(strip, out var s) && s.Routes.Contains(bus);
    public bool NeedsCapture(string chId) => Enabled && Strips.TryGetValue("ch:" + chId, out var s) && s.Routes.Any(r => Sinks.ContainsKey(r) || Extra.Contains(r) || r == "B1");
    bool SoloMuted(StripCfg s, string bus) => AnySolo && !s.Solo && bus.StartsWith("A");
    public void Begin(int n) { foreach (var b in Buf.Values) Array.Clear(b, 0, n); Array.Clear(b1Acc, 0, Math.Min(n, b1Acc.Length)); b1Has = false; }
    // channel strip: processing that applies to every path of the channel (gate / comp / pan); gain & mute stay the channel fader
    public void ChannelFx(string chId, float[] b, int frames) { if (Enabled && Strips.TryGetValue("ch:" + chId, out var s) && !s.Neutral) s.Apply(b, frames, false); }
    public void AddStrip(string stripId, float[] b, int n, float vol)
    {
        if (!Enabled || !Strips.TryGetValue(stripId, out var s)) return;
        foreach (var r in s.Routes)
        {
            if (SoloMuted(s, r)) continue;
            if (Buf.TryGetValue(r, out var dst)) for (int i = 0; i < n; i++) dst[i] += b[i] * vol;
            else if (r == "B1" && stripId != "mic" && n <= b1Acc.Length) { for (int i = 0; i < n; i++) b1Acc[i] += b[i] * vol; b1Has = true; } // the mic reaches B1 on its own path
        }
    }
    // extra input strips -> A1 (pBus), B2 (sBus), B1 (ring to the mic thread), A2/A3
    public void Inputs(int n, float[] pBus, float[] sBus, bool streamOn)
    {
        if (!Enabled) return;
        foreach (var s in Strips.Values)
        {
            if (s.Kind != "input" || s.Src == null) continue;
            if (tmp.Length < n) tmp = new float[n];
            s.Src.Ring.Read(tmp, n, 9600);
            s.Apply(tmp, n / 2, true);
            foreach (var r in s.Routes)
            {
                if (SoloMuted(s, r)) continue;
                if (r == "A1" && pBus != null) for (int i = 0; i < n; i++) pBus[i] += tmp[i];
                else if (r == "B2" && streamOn) for (int i = 0; i < n; i++) sBus[i] += tmp[i];
                else if (r == "B1" && n <= b1Acc.Length) { for (int i = 0; i < n; i++) b1Acc[i] += tmp[i]; b1Has = true; }
                else if (Buf.TryGetValue(r, out var dst)) for (int i = 0; i < n; i++) dst[i] += tmp[i];
            }
        }
    }
    public bool InputsTo(string bus) => Enabled && Strips.Values.Any(s => s.Kind == "input" && s.Src != null && s.Routes.Contains(bus));
    public void End(int n)
    {
        if (b1Has) { for (int i = 0; i < n; i++) b1Acc[i] = Math.Clamp(b1Acc[i], -1f, 1f); B1Ring.Write(b1Acc, n); }
        foreach (var (id, sink) in Sinks) { var b = Buf[id]; if (Fx.TryGetValue(id, out var f)) f.Process(b, n / 2, true); for (int i = 0; i < n; i++) b[i] = Math.Clamp(b[i], -1f, 1f); sink.Write(b, n); }
    }
    public void ApplyFx(string bus, float[] b, int n) { if (Enabled && Fx.TryGetValue(bus, out var f) && (!f.Neutral || f.LimOn)) f.Process(b, n / 2, true); }
    public JsonObject Levels()
    {
        var o = new JsonObject(); var bo = new JsonObject();
        foreach (var s in Strips.Values) { o[s.Id] = Math.Round(s.Peak, 3); s.Peak *= 0.5f; }
        foreach (var f in Fx.Values) { bo[f.Id] = Math.Round(f.Peak, 3); f.Peak *= 0.5f; }
        return new JsonObject { ["strips"] = o, ["buses"] = bo, ["sinks"] = new JsonArray(Sinks.Keys.Select(k => (JsonNode)k).ToArray()) };
    }
    public void Dispose() { foreach (var s in Sinks.Values) s.Dispose(); Sinks.Clear(); Buf.Clear(); foreach (var s in Strips.Values) { try { s.Src?.Dispose(); } catch { } } Strips.Clear(); }

    // --bustest: the strip / bus DSP and the B1 / solo routing on synthetic signals (no audio devices needed).
    public static string Test()
    {
        var sb = new System.Text.StringBuilder(); int fails = 0;
        void Check(string what, bool ok, string detail) { sb.AppendLine($"{(ok ? "PASS" : "FAIL")}  {what}: {detail}"); if (!ok) fails++; }
        float[] Tone(double f, double dbfs, int frames, bool stereo = true) { var a = Db.ToLin(dbfs); var t = new float[frames * 2]; for (int i = 0; i < frames; i++) { float v = (float)(a * Math.Sin(2 * Math.PI * f * i / 48000)); t[i * 2] = v; t[i * 2 + 1] = stereo ? v : 0; } return t; }
        double RmsDb(float[] x, int ch, int from) { double s = 0; int n = 0; for (int i = from; i < x.Length / 2; i++) { s += x[i * 2 + ch] * x[i * 2 + ch]; n++; } return 10 * Math.Log10(s / Math.Max(1, n) + 1e-20); }
        double PeakDb(float[] x, int from) { double p = 0; for (int i = from * 2; i < x.Length; i++) p = Math.Max(p, Math.Abs(x[i])); return 20 * Math.Log10(p + 1e-20); }
        JsonNode J(string s) => JsonNode.Parse(s);
        // pan
        { var st = new StripCfg(); st.Configure(J("{\"kind\":\"channel\",\"pan\":-1}")); var x = Tone(1000, -20, 48000); double l0 = RmsDb(x, 0, 0); st.Apply(x, 48000, false);
          Check("pan hard left", RmsDb(x, 1, 0) < -80 && Math.Abs(RmsDb(x, 0, 0) - (l0 + 3.01)) < 0.2, $"L {RmsDb(x, 0, 0) - l0:+0.0;-0.0} dB, R {RmsDb(x, 1, 0):F0} dBFS"); }
        // gate
        { var st = new StripCfg(); st.Configure(J("{\"kind\":\"channel\",\"gate\":{\"enabled\":true,\"thresholdDb\":-40}}")); var q = Tone(500, -60, 96000); st.Apply(q, 96000, false); var loud = Tone(500, -20, 48000); st.Apply(loud, 48000, false);
          Check("gate closes below threshold", RmsDb(q, 0, 48000) < -60 - 3 - 50, $"-60 dBFS tone -> {RmsDb(q, 0, 48000):F0} dBFS"); Check("gate opens above threshold", Math.Abs(RmsDb(loud, 0, 24000) - (-23.01)) < 0.5, $"-20 dBFS tone -> {RmsDb(loud, 0, 24000) + 3.01:F1} dBFS peak-equivalent"); }
        // compressor: -6 dBFS peak, threshold -18, ratio 3 -> ~8 dB reduction
        { var st = new StripCfg(); st.Configure(J("{\"kind\":\"channel\",\"comp\":{\"enabled\":true,\"thresholdDb\":-18,\"ratio\":3,\"makeupDb\":0}}")); var x = Tone(1000, -6, 48000); double r0 = RmsDb(x, 0, 24000); st.Apply(x, 48000, false); double gr = r0 - RmsDb(x, 0, 24000);
          Check("compressor 3:1 at -18 dB", gr > 6.5 && gr < 9.5, $"-6 dBFS tone reduced {gr:F1} dB (expected ~8)"); }
        // input strip gain + mute
        { var st = new StripCfg(); st.Configure(J("{\"kind\":\"input\",\"gainDb\":-6}")); var x = Tone(1000, -20, 4800); double r0 = RmsDb(x, 0, 0); st.Apply(x, 4800, true); Check("input gain -6 dB", Math.Abs(RmsDb(x, 0, 0) - r0 + 6) < 0.05, $"{RmsDb(x, 0, 0) - r0:F2} dB");
          st.Configure(J("{\"kind\":\"input\",\"mute\":true}")); var y = Tone(1000, -20, 4800); st.Apply(y, 4800, true); Check("input mute", PeakDb(y, 0) < -200, "silent"); }
        // bus limiter / gain / delay / EQ / mono
        { var b = new BusFx(); b.Configure(J("{\"limiter\":{\"enabled\":true,\"ceilingDb\":-6}}")); var x = Tone(200, 0, 48000); b.Process(x, 48000, true); Check("bus limiter ceiling -6 dB", PeakDb(x, 100) <= -5.9, $"0 dBFS tone -> peak {PeakDb(x, 100):F2} dBFS"); }
        { var b = new BusFx(); b.Configure(J("{\"gainDb\":-12}")); var x = Tone(1000, -10, 4800); double r0 = RmsDb(x, 0, 0); b.Process(x, 4800, true); Check("bus gain -12 dB", Math.Abs(RmsDb(x, 0, 0) - r0 + 12) < 0.05, $"{RmsDb(x, 0, 0) - r0:F2} dB"); }
        { var b = new BusFx(); b.Configure(J("{\"delayMs\":100}")); var x = new float[48000 * 2]; x[0] = 1; x[1] = 1; b.Process(x, 48000, true); int at = -1; for (int i = 0; i < 48000; i++) if (x[i * 2] > 0.5f) { at = i; break; } Check("bus delay 100 ms", at == 4800, $"impulse at frame {at} (expected 4800)"); }
        { var b = new BusFx(); b.Configure(J("{\"eq\":{\"enabled\":true,\"preampDb\":0,\"bands\":[{\"type\":\"peak\",\"f\":1000,\"g\":6,\"q\":1,\"on\":true}]}}")); var x = Tone(1000, -20, 48000); double r0 = RmsDb(x, 0, 24000); b.Process(x, 48000, true); double g = RmsDb(x, 0, 24000) - r0; var y = Tone(100, -20, 48000); double r1 = RmsDb(y, 0, 24000); b.Process(y, 48000, true); double g2 = RmsDb(y, 0, 24000) - r1;
          Check("bus EQ +6 dB @ 1 kHz", Math.Abs(g - 6) < 0.3 && Math.Abs(g2) < 1, $"1 kHz {g:+0.00} dB, 100 Hz {g2:+0.00;-0.00} dB"); }
        { var b = new BusFx(); b.Configure(J("{\"mono\":true}")); var x = Tone(1000, -20, 4800, false); b.Process(x, 4800, true); Check("bus mono", Math.Abs(RmsDb(x, 0, 0) - RmsDb(x, 1, 0)) < 0.01, $"L {RmsDb(x, 0, 0):F1} / R {RmsDb(x, 1, 0):F1} dBFS"); }
        // routing: two strips -> B1 are summed once per block; solo keeps non-solo strips off A buses
        {
            var m = new BusMixer(); m.Configure(J("{\"enabled\":true,\"strips\":[{\"id\":\"ch:game\",\"kind\":\"channel\",\"routes\":[\"B1\",\"A2\"]},{\"id\":\"ch:media\",\"kind\":\"channel\",\"routes\":[\"B1\",\"A2\"],\"solo\":true},{\"id\":\"mic\",\"kind\":\"mic\",\"routes\":[\"B1\"]}],\"outs\":[]}"), null, (a, e) => { });
            m.Buf["A2"] = new float[9600]; int n = 960; m.Begin(n);
            var g = Tone(1000, -20, n / 2); var md = Tone(1000, -20, n / 2); m.AddStrip("ch:game", g, n, 1); m.AddStrip("ch:media", md, n, 1); m.AddStrip("mic", g, n, 1); m.End(n);
            var outB1 = new float[n]; int got = m.B1Ring.Read(outB1, n, 9600);
            double ratio = 20 * Math.Log10((Math.Abs(outB1[2 * 10]) + 1e-12) / (Math.Abs(g[2 * 10]) + 1e-12));
            Check("B1: two app strips summed once per block (mic excluded)", got == n && m.B1Ring.Count == 0 && Math.Abs(ratio - 6.02) < 0.1, $"{got} samples, level {ratio:+0.00} dB vs one strip (expected +6.02)");
            double a2 = 20 * Math.Log10(Math.Abs(m.Buf["A2"][20]) / Math.Abs(g[20]));
            Check("solo: only the soloed strip reaches A2", Math.Abs(a2) < 0.05, $"A2 level {a2:+0.00} dB vs one strip (expected 0)");
        }
        sb.AppendLine(fails == 0 ? "BUS CHECK OK" : $"BUS CHECK FAILED ({fails})");
        return sb.ToString();
    }
}

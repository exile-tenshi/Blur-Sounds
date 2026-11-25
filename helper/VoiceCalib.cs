// v2.6.0 "Calibrate from my voice": a 20-30 s reading sample is checked (noise, clipping, level), measured (pitch median
// and range, formants, loudness and noise floor) and run through each candidate voice on this PC. The result is a personal
// preset per voice: exact pitch shift onto the voice's natural pitch, intonation range, formant amount for natural sounds,
// a per-user feature offset (adaptation), an input gate threshold and the quality mode this GPU can hold in real time.
// Everything stays in the local calibration folder; nothing is uploaded.
using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.ML.OnnxRuntime;

namespace Bsp;

public static class Calib
{
    // Gender norms measured with this same analysis on CMU Arctic voices (5 female, 5 male).
    public static double FemStdSemis = 2.32, MaleStdSemis = 2.65;
    public static readonly double[] FemFormants = { 466, 1774, 2968 }, MaleFormants = { 392, 1564, 2706 };

    // ---------- small helpers ----------
    static double Pct(IEnumerable<double> v, double p) { var a = v.OrderBy(x => x).ToArray(); if (a.Length == 0) return double.NaN; return a[Math.Clamp((int)Math.Round(p / 100 * (a.Length - 1)), 0, a.Length - 1)]; }
    public static int Lag(float[] a, float[] b, int maxLag)
    {
        const int h = 48; int na = a.Length / h, nb = b.Length / h; var ea = new double[na]; var eb = new double[nb];
        for (int i = 0; i < na; i++) { double s = 0; for (int j = 0; j < h; j++) s += a[i * h + j] * a[i * h + j]; ea[i] = Math.Sqrt(s / h); }
        for (int i = 0; i < nb; i++) { double s = 0; for (int j = 0; j < h; j++) s += b[i * h + j] * b[i * h + j]; eb[i] = Math.Sqrt(s / h); }
        double best = double.NegativeInfinity; int bl = 0;
        for (int L = 0; L <= maxLag / h; L++)
        {
            int n = Math.Min(na, nb - L); if (n < 50) break;
            double ma = 0, mb = 0; for (int i = 0; i < n; i++) { ma += ea[i]; mb += eb[i + L]; } ma /= n; mb /= n;
            double num = 0, da = 0, db = 0; for (int i = 0; i < n; i++) { double u = ea[i] - ma, v = eb[i + L] - mb; num += u * v; da += u * u; db += v * v; }
            double c = num / Math.Sqrt(da * db + 1e-20); if (c > best) { best = c; bl = L; }
        }
        return bl * h;
    }
    public static float[] Down16(float[] x48) => new Rational(1, 3, 7600.0 / 48000, 96).Process(x48, x48.Length);
    static double[] FrameDb(float[] x, int hop)
    {
        int n = x.Length / hop; var r = new double[n];
        for (int i = 0; i < n; i++) { double s = 0; for (int j = 0; j < hop; j++) { double v = x[i * hop + j]; s += v * v; } r[i] = 10 * Math.Log10(s / hop + 1e-12); }
        return r;
    }

    // ---------- formants: LPC envelope peaks on voiced frames (16 kHz) ----------
    public static double[] Formants(float[] x16, float[] f0)
    {
        var F = new List<double>[] { new(), new(), new() }; const int N = 400, P = 16; var w = new double[N]; var a = new double[P + 1]; var r = new double[P + 1];
        for (int f = 0; f < f0.Length; f++)
        {
            if (f0[f] <= 0) continue; int s0 = f * 160 - N / 2; if (s0 < 1 || s0 + N >= x16.Length) continue;
            double e = 0;
            for (int i = 0; i < N; i++) { double v = x16[s0 + i] - 0.97 * x16[s0 + i - 1]; w[i] = v * (0.54 - 0.46 * Math.Cos(2 * Math.PI * i / (N - 1))); e += w[i] * w[i]; }
            if (e < 1e-6) continue;
            for (int k = 0; k <= P; k++) { double s = 0; for (int i = k; i < N; i++) s += w[i] * w[i - k]; r[k] = s; }
            r[0] *= 1.0001; Array.Clear(a); a[0] = 1; double err = r[0];
            for (int i = 1; i <= P; i++)
            {
                double acc = r[i]; for (int j = 1; j < i; j++) acc += a[j] * r[i - j];
                double k = -acc / err; var na = (double[])a.Clone();
                for (int j = 1; j < i; j++) na[j] = a[j] + k * a[i - j]; na[i] = k; Array.Copy(na, a, P + 1); err *= 1 - k * k; if (err <= 0) break;
            }
            // envelope 0..5000 Hz in 10 Hz steps
            var env = new double[501];
            for (int b = 0; b <= 500; b++) { double om = 2 * Math.PI * b * 10 / 16000, re = 0, im = 0; for (int k = 0; k <= P; k++) { re += a[k] * Math.Cos(om * k); im -= a[k] * Math.Sin(om * k); } env[b] = -10 * Math.Log10(re * re + im * im + 1e-20); }
            var peaks = new List<double>(); for (int b = 2; b < 500; b++) if (env[b] > env[b - 1] && env[b] >= env[b + 1]) peaks.Add(b * 10);
            double f1 = peaks.FirstOrDefault(p => p >= 220 && p <= 1000); if (f1 == 0) continue;
            double f2 = peaks.FirstOrDefault(p => p >= Math.Max(800, f1 + 200) && p <= 3000); if (f2 == 0) continue;
            double f3 = peaks.FirstOrDefault(p => p >= Math.Max(1800, f2 + 200) && p <= 4200);
            F[0].Add(f1); F[1].Add(f2); if (f3 > 0) F[2].Add(f3);
        }
        return F.Select(l => l.Count > 10 ? Pct(l, 50) : double.NaN).ToArray();
    }

    // ---------- 1. quality + voice measurements ----------
    public sealed class Measure
    {
        public double SpeechDb, NoiseDb, SnrDb, PeakDb, ClipPct, VoicedSec, MedianHz, P10Hz, P90Hz, RangeSemis, StdSemis, GateDb = double.NaN;
        public double[] Formants = new double[3]; public float[] F0; public float[] X16; public bool[] Active; public List<JsonObject> Checks = new(); public bool Ok = true;
        public string Likely => MedianHz < 160 ? "male" : "female";
    }
    public static Measure Analyze(float[] x48, float[] raw48)
    {
        var m = new Measure();
        var db = FrameDb(raw48, 480);
        m.NoiseDb = Pct(db, 10); var act = db.Select(d => d > m.NoiseDb + 10 && d > -62).ToArray();
        m.SpeechDb = act.Any(v => v) ? Pct(db.Where((d, i) => act[i]), 50) : -100; m.SnrDb = m.SpeechDb - m.NoiseDb;
        double pk = 0; long clip = 0; foreach (var v in raw48) { double a = Math.Abs(v); if (a > pk) pk = a; if (a >= 0.985) clip++; }
        m.PeakDb = 20 * Math.Log10(pk + 1e-9); m.ClipPct = 100.0 * clip / Math.Max(1, raw48.Length);
        m.X16 = Down16(x48); var f0 = new Yin().Track(m.X16, 0, m.X16.Length);
        var v0 = f0.Where(f => f > 0).Select(f => (double)f).ToArray();
        double med0 = v0.Length > 0 ? Pct(v0, 50) : 0;
        for (int i = 0; i < f0.Length; i++) if (f0[i] > 0 && (f0[i] > med0 * 1.8 || f0[i] < med0 / 1.8)) f0[i] = 0; // octave slips out of the statistics
        m.F0 = f0; var vv = f0.Where(f => f > 0).Select(f => (double)f).ToArray();
        m.VoicedSec = vv.Length / 100.0;
        if (vv.Length > 50)
        {
            m.MedianHz = Pct(vv, 50); m.P10Hz = Pct(vv, 10); m.P90Hz = Pct(vv, 90); m.RangeSemis = 12 * Math.Log2(m.P90Hz / m.P10Hz);
            var st = vv.Select(f => 12 * Math.Log2(f / m.MedianHz)).ToArray(); m.StdSemis = Math.Sqrt(st.Select(s => s * s).Average());
        }
        m.Formants = Formants(m.X16, f0);
        // gate threshold on the same 5 ms peak envelope the gate uses
        var env = new double[db.Length]; { double e = 0, ae = Math.Exp(-1.0 / (0.005 * 48000)); int fi = 0; double mx = 0; for (int i = 0; i < x48.Length && fi < env.Length; i++) { double a = Math.Abs(x48[i]); e = a > e ? a : ae * e + (1 - ae) * a; if (e > mx) mx = e; if ((i + 1) % 480 == 0) { env[fi++] = 20 * Math.Log10(mx + 1e-9); mx = 0; } } }
        var dbx = FrameDb(x48, 480); double nfx = Pct(dbx, 10); var actx = dbx.Select(d => d > nfx + 10 && d > -62).ToArray(); m.Active = actx;
        var nEnv = env.Where((e, i) => i < actx.Length && !actx[i]).ToArray(); var sEnv = env.Where((e, i) => i < actx.Length && actx[i]).ToArray();
        if (nEnv.Length > 20 && sEnv.Length > 20) { double n95 = Pct(nEnv, 95), s20 = Pct(sEnv, 20); double g = Math.Min(Math.Min(n95 + 3, s20 - 15), -40); if (s20 - n95 > 18) m.GateDb = Math.Round(Math.Clamp(g, -80, -40), 1); } // v2.5.3: only well below your quietest words (a -30 dB gate cost 0.11 UTMOS in tests)
        // checks
        void Check(string id, bool fail, bool warn, string msg) { var lvl = fail ? "fail" : warn ? "warn" : "ok"; if (fail) m.Ok = false; m.Checks.Add(new JsonObject { ["id"] = id, ["level"] = lvl, ["text"] = msg }); }
        Check("level", m.SpeechDb < -50, m.SpeechDb < -40, m.SpeechDb < -40 ? $"Too quiet ({m.SpeechDb:F0} dBFS). Move closer or raise the mic level." : $"Level is good ({m.SpeechDb:F0} dBFS).");
        Check("clip", m.ClipPct > 0.5, m.ClipPct > 0.02, m.ClipPct > 0.02 ? $"Clipping in {m.ClipPct:F2}% of the sample. Lower the mic level a little." : "No clipping.");
        Check("noise", m.SnrDb < 15, m.SnrDb < 25, m.SnrDb < 25 ? $"Background noise is high (only {m.SnrDb:F0} dB below your voice). Turn on noise suppression or reduce the noise." : $"Background is quiet ({m.SnrDb:F0} dB below your voice).");
        Check("length", m.VoicedSec < 6, m.VoicedSec < 10, m.VoicedSec < 10 ? $"Only {m.VoicedSec:F0} s of voice. Read a little longer." : $"{m.VoicedSec:F0} s of voice recorded.");
        return m;
    }

    public static JsonObject MeasureJson(Measure m) => new()
    {
        ["ok"] = m.Ok, ["checks"] = new JsonArray(m.Checks.Select(c => (JsonNode)c).ToArray()),
        ["speechDb"] = Math.Round(m.SpeechDb, 1), ["noiseDb"] = Math.Round(m.NoiseDb, 1), ["snrDb"] = Math.Round(m.SnrDb, 1), ["peakDb"] = Math.Round(m.PeakDb, 1), ["clipPct"] = Math.Round(m.ClipPct, 3),
        ["voicedSec"] = Math.Round(m.VoicedSec, 1), ["medianHz"] = Math.Round(m.MedianHz, 1), ["p10Hz"] = Math.Round(m.P10Hz), ["p90Hz"] = Math.Round(m.P90Hz), ["rangeSemis"] = Math.Round(m.RangeSemis, 1), ["stdSemis"] = Math.Round(m.StdSemis, 2),
        ["f1"] = double.IsNaN(m.Formants[0]) ? null : Math.Round(m.Formants[0]), ["f2"] = double.IsNaN(m.Formants[1]) ? null : Math.Round(m.Formants[1]), ["f3"] = double.IsNaN(m.Formants[2]) ? null : Math.Round(m.Formants[2]),
        ["gateDb"] = double.IsNaN(m.GateDb) ? null : m.GateDb, ["likely"] = m.Likely,
    };

    // ---------- 2. per-voice preset ----------
    public sealed class VoiceInfo { public string Key, Name, Gender, VoicePath, SpkPath; public int Sid; public double TargetHz, CeilHz; }
    public static JsonObject PresetFor(Measure m, VoiceInfo v)
    {
        bool fem = v.Gender == "F";
        double shift = 12 * Math.Log2(v.TargetHz / Math.Max(60, m.MedianHz));
        double rs = 1; // v2.6.4: never widen or compress your intonation (x1.2 pushed lively speech into a child's pitch range; compressing sounded flat)
        var norm = fem ? FemFormants : MaleFormants; double num = 0, den = 0; int n = 0;
        for (int i = 0; i < 3; i++) if (!double.IsNaN(m.Formants[i])) { num += Math.Log(norm[i]); den += Math.Log(m.Formants[i]); n++; }
        double fpct = n > 0 ? Math.Clamp(100 * (Math.Exp((num - den) / n) - 1), -20, 25) : (fem ? 15 : -12);
        return new JsonObject { ["voice"] = v.Key, ["engine"] = "ai", ["autoPitch"] = true, ["pitch"] = 0, ["userHz"] = Math.Round(m.MedianHz, 1), ["targetHz"] = v.TargetHz,
            ["shift"] = Math.Round(shift, 2), ["rangeScale"] = Math.Round(rs, 3), ["natFormant"] = Math.Round(fpct, 1), ["gateDb"] = double.IsNaN(m.GateDb) ? null : m.GateDb };
    }

    // ---------- 3. full run: measure, try each voice, rank ----------
    public static JsonObject Run(JsonNode req, Action<string, double> progress)
    {
        string sample = (string)req["sample"], rawPath = (string)req["raw"], outDir = (string)req["outDir"], cvPath = (string)req["cvPath"], f0Path = (string)req["f0Path"], device = (string)req["device"] ?? "gpu";
        double alpha = (double?)req["adapt"] ?? 0; bool tryVoices = (bool?)req["tryVoices"] ?? true; // v2.5.3: feature adaptation measured no gain (within ±0.06 UTMOS), so it is off unless asked for bool tryVoices = (bool?)req["tryVoices"] ?? true;
        Directory.CreateDirectory(outDir);
        progress("Checking the recording", 0.02);
        var x = Wav.ReadMono48(sample); var raw = !string.IsNullOrEmpty(rawPath) && File.Exists(rawPath) ? Wav.ReadMono48(rawPath) : x;
        var m = Analyze(x, raw);
        var res = new JsonObject { ["measure"] = MeasureJson(m) };
        if (m.MedianHz <= 0 || m.VoicedSec < 4) { res["error"] = "Not enough voice in the recording to calibrate."; return res; }
        var voices = ((req["voices"] as JsonArray) ?? new JsonArray()).Select(n => new VoiceInfo { Key = (string)n["key"], Name = (string)n["name"], Gender = (string)n["gender"], VoicePath = (string)n["voicePath"], SpkPath = (string)n["spkPath"], Sid = (int?)n["sid"] ?? 0, TargetHz = (double?)n["targetHz"] ?? 200, CeilHz = (double?)n["ceilHz"] ?? 0 }).ToList();
        // excerpt with the most voice (10 s) for the listening tests and the preview
        int len = Math.Min(x.Length, 48000 * 10), bestStart = 0, bestV = -1;
        for (int s = 0; s + len <= x.Length; s += 48000) { int v = 0; for (int f = s / 480; f < (s + len) / 480 && f < m.F0.Length; f++) if (m.F0[f] > 0) v++; if (v > bestV) { bestV = v; bestStart = s; } }
        var xe = new float[len]; Array.Copy(x, bestStart, xe, 0, len);
        var x16 = Down16(xe); var fi = new Yin().Track(x16, 0, x16.Length);
        int pv = Math.Min(len, 48000 * 6); var before = new float[pv]; Array.Copy(xe, before, pv);
        string beforePath = Path.Combine(outDir, "before.wav"); Wav.Write(beforePath, before, 48000); res["before"] = beforePath;
        var cands = new JsonArray(); double p95 = double.NaN; string provider = "";
        var cache = new Dictionary<string, (InferenceSession s, bool dml)>(); float[][] fin = null;
        try
        {
            int idx = 0;
            foreach (var v in voices)
            {
                var pre = PresetFor(m, v); var c = new JsonObject { ["key"] = v.Key, ["name"] = v.Name, ["gender"] = v.Gender, ["preset"] = pre };
                if (!tryVoices || string.IsNullOrEmpty(v.VoicePath) || !File.Exists(v.VoicePath)) { cands.Add(c); continue; }
                progress($"Trying {v.Name} ({++idx} of {voices.Count})", 0.1 + 0.85 * (idx - 1) / Math.Max(1, voices.Count));
                double shift = (double)pre["shift"];
                var vc = new VcConfig { Enabled = true, Engine = "ai", CvPath = cvPath, F0Path = f0Path, VoicePath = v.VoicePath, SpkPath = v.SpkPath, Sid = v.Sid, AutoPitch = true, UserHz = m.MedianHz, TargetHz = v.TargetHz, CeilHz = v.CeilHz,
                    RangeScale = (double)pre["rangeScale"], Quality = "balanced", Device = device, Natural = false };
                float[] y; float[][] fout; string adaptPath = Path.Combine(outDir, v.Key + ".adapt");
                using (var a = new AiVoice(vc, cache))
                {
                    y = a.ConvertOffline(xe); provider = a.Provider; if (double.IsNaN(p95) || a.InferP95 > p95) p95 = a.InferP95;
                    fin ??= a.Features(x16); fout = a.Features(Down16(y));
                }
                var (cs, pacc, oct, vuv) = Score(x16, fi, fin, fout, Down16(y), Math.Pow(2, shift / 12), m.Active);
                // adaptation: the mean feature difference between your voice and the same words in the target voice
                int nf = Math.Min(fin.Length, fout.Length); var mu = new double[768]; int cnt = 0;
                for (int k = 0; k < nf; k++) { int fr = k * 2; if (fr >= fi.Length || fi[fr] <= 0) continue; for (int d = 0; d < 768; d++) mu[d] += fout[k][d] - fin[k][d]; cnt++; }
                if (cnt > 20 && alpha > 0) { var delta = mu.Select(q => (float)(q / cnt)).ToArray(); var b = new byte[768 * 4]; Buffer.BlockCopy(delta, 0, b, 0, b.Length); File.WriteAllBytes(adaptPath, b); pre["adaptPath"] = adaptPath; pre["adapt"] = alpha; }
                // preview with the full preset
                if (cnt > 20 && alpha > 0)
                {
                    vc.AdaptPath = adaptPath; vc.Adapt = alpha;
                    using var a2 = new AiVoice(vc, cache); y = a2.ConvertOffline(xe);
                }
                var after = new float[pv]; Array.Copy(y, after, Math.Min(pv, y.Length)); string ap = Path.Combine(outDir, "after_" + v.Key + ".wav"); Wav.Write(ap, after, 48000);
                double fit = Math.Exp(-Math.Pow((Math.Abs(shift) - 10) / 5, 2));
                double score = 100 * (0.5 * Math.Clamp((cs - 0.5) / 0.4, 0, 1) + 0.3 * pacc + 0.1 * (1 - vuv) + 0.1 * fit);
                c["preview"] = ap; c["score"] = Math.Round(score, 1); c["contentSim"] = Math.Round(cs, 3); c["pitchAcc"] = Math.Round(pacc, 3); c["octaveErr"] = Math.Round(oct, 3); c["vuv"] = Math.Round(vuv, 3); c["fit"] = Math.Round(fit, 2);
                cands.Add(c);
            }
        }
        finally { foreach (var s in cache.Values) s.s.Dispose(); }
        // rank within each target gender
        var ranked = cands.Select(n => n.AsObject()).OrderByDescending(o => (double?)o["score"] ?? 0).ToList();
        foreach (var g in new[] { "F", "M" }) { int r = 1; foreach (var o in ranked.Where(o => (string)o["gender"] == g)) o["rank"] = r++; }
        res["candidates"] = new JsonArray(ranked.Select(o => (JsonNode)o.DeepClone()).ToArray());
        // quality mode this PC can hold: the AI block must finish well inside its 100 ms (balanced)
        string q = double.IsNaN(p95) ? "balanced" : p95 < 70 ? "balanced" : "dsp";
        res["recommend"] = new JsonObject { ["quality"] = q == "dsp" ? "balanced" : q, ["engine"] = q == "dsp" ? "dsp" : "ai", ["p95Ms"] = double.IsNaN(p95) ? null : Math.Round(p95, 1), ["provider"] = provider,
            ["note"] = q == "dsp" ? "This PC can't run the AI voice in real time; the Pitch & formant engine is recommended." : $"The AI voice runs comfortably here ({p95:F0} ms per 100 ms block)." };
        progress("Done", 1);
        return res;
    }

    static (double cs, double pacc, double oct, double vuv) Score(float[] x16, float[] fi, float[][] fin, float[][] fout, float[] y16, double ratio, bool[] active)
    {
        int n = Math.Min(fin.Length, fout.Length); double s = 0; int c = 0;
        for (int k = 0; k < n; k++)
        {
            int fr = k * 2; if (active != null && fr < active.Length && !active[fr]) continue;
            double dot = 0, na = 0, nb = 0; for (int d = 0; d < 768; d++) { dot += fin[k][d] * fout[k][d]; na += fin[k][d] * fin[k][d]; nb += fout[k][d] * fout[k][d]; }
            s += dot / Math.Sqrt(na * nb + 1e-12); c++;
        }
        var fo = new Yin().Track(y16, 0, y16.Length); int m = Math.Min(fi.Length, fo.Length), both = 0, good = 0, octv = 0, mis = 0, act = 0;
        for (int k = 0; k < m; k++)
        {
            bool a = fi[k] > 0, b = fo[k] > 0; if (active == null || k >= active.Length || active[k]) { act++; if (a != b) mis++; }
            if (!a || !b) continue; both++; double cents = Math.Abs(1200 * Math.Log2(fo[k] / (fi[k] * ratio)));
            if (cents < 50) good++; if (cents > 600) octv++;
        }
        return (c > 0 ? s / c : 0, both > 0 ? (double)good / both : 0, both > 0 ? (double)octv / both : 0, act > 0 ? (double)mis / act : 0);
    }
}

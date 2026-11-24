// v2.5.0 real-time voice changer.
//  AI engine: RVC v2 (ContentVec features + RMVPE/YIN pitch + NSF-HiFiGAN voice) on ONNX Runtime, DirectML GPU with CPU fallback.
//  DSP engine: pitch-synchronous overlap-add (PSOLA) with independent formant scaling; needs no model.
// Sits in the mic chain after noise suppression + gate, before EQ/compressor and the virtual-mic cable. Off by default.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Bsp;

public sealed class VcConfig
{
    public bool Enabled; public string Engine = "ai"; public bool Bypass;
    public string CvPath, F0Path, VoicePath, SpkPath; public int Sid, Sid2 = -1; public double Blend;
    public double Pitch; public bool AutoPitch = true; public double TargetHz = 210; public double Formant; // formant: percent (DSP engine)
    public string Quality = "balanced", Device = "gpu", F0Method = "auto"; public double Expressive = 1.0, EnvMix = 0.35;
    public static VcConfig From(JsonNode v)
    {
        var c = new VcConfig();
        if (v == null) return c;
        c.Enabled = (bool?)v["enabled"] ?? false; c.Engine = (string)v["engine"] ?? "ai"; c.Bypass = (bool?)v["bypass"] ?? false;
        c.CvPath = (string)v["cvPath"]; c.F0Path = (string)v["f0Path"]; c.VoicePath = (string)v["voicePath"]; c.SpkPath = (string)v["spkPath"];
        c.Sid = (int?)v["sid"] ?? 0; c.Sid2 = (int?)v["sid2"] ?? -1; c.Blend = Math.Clamp((double?)v["blend"] ?? 0, 0, 1);
        c.Pitch = Math.Clamp((double?)v["pitch"] ?? 0, -24, 24); c.AutoPitch = (bool?)v["autoPitch"] ?? true; c.TargetHz = Math.Clamp((double?)v["targetHz"] ?? 210, 60, 600);
        c.Formant = Math.Clamp((double?)v["formant"] ?? 0, -40, 60);
        c.Quality = (string)v["quality"] ?? "balanced"; c.Device = (string)v["device"] ?? "gpu"; c.F0Method = (string)v["f0"] ?? "auto";
        c.Expressive = Math.Clamp((double?)v["expressive"] ?? 1.0, 0, 1.5); c.EnvMix = Math.Clamp((double?)v["envMix"] ?? 0.35, 0, 1);
        return c;
    }
    public string ModelKey => $"{CvPath}|{F0Path}|{VoicePath}|{Quality}|{Device}|{F0Method}";
}

public sealed class VoiceChanger : IDisposable
{
    public string State = "off", Error, Provider = "", F0Engine = "";
    public double InferMs, InferP95, LatencyMs, InHz, OutHz, ShiftSemis; public int Dropouts;
    public bool Ready => ai?.Ready == true;
    VcConfig cfg = new(); AiVoice ai; PsolaVoice dsp; string loadedKey; Task loading;
    readonly object l = new(); float bypassGain = 0; // 0 = wet, 1 = dry
    float[] dry = new float[4096];

    public void Configure(VcConfig c)
    {
        lock (l)
        {
            cfg = c;
            if (!c.Enabled) { ai?.Dispose(); ai = null; dsp = null; loadedKey = null; State = "off"; Error = null; return; }
            if (c.Engine == "dsp") { ai?.Dispose(); ai = null; loadedKey = null; dsp ??= new PsolaVoice(); dsp.Set(c); State = "running"; Error = null; Provider = "DSP (no model)"; return; }
            dsp = null;
            if (c.ModelKey != loadedKey)
            {
                loadedKey = c.ModelKey; var old = ai; ai = null; old?.Dispose(); State = "loading"; Error = null;
                var key = loadedKey;
                loading = Task.Run(() =>
                {
                    try
                    {
                        var a = new AiVoice(c);
                        lock (l) { if (loadedKey == key && cfg.Enabled) { ai = a; State = "running"; Provider = a.Provider; F0Engine = a.F0Name; } else a.Dispose(); }
                    }
                    catch (Exception e) { lock (l) { if (loadedKey == key) { State = "error"; Error = e.Message; } } }
                });
            }
            ai?.Set(c);
        }
    }

    // In place on the capture thread, 48 kHz mono.
    public void Process(float[] mono, int n)
    {
        AiVoice a; PsolaVoice d; VcConfig c;
        lock (l) { a = ai; d = dsp; c = cfg; }
        if (!c.Enabled || (a == null && d == null)) return; // pass-through while loading or on error, so the mic never goes silent
        if (dry.Length < n) dry = new float[n];
        Array.Copy(mono, dry, n);
        if (a != null)
        {
            a.Set(c); a.Process(mono, n);
            InferMs = a.InferMs; InferP95 = a.InferP95; LatencyMs = a.LatencyMs; Dropouts = a.Dropouts; InHz = a.InHz; OutHz = a.OutHz; ShiftSemis = a.Shift;
        }
        else
        {
            d.Set(c); d.Process(mono, n);
            LatencyMs = d.LatencyMs; InHz = d.InHz; OutHz = d.OutHz; ShiftSemis = d.Shift; InferMs = d.CpuMs; InferP95 = 0;
        }
        float target = c.Bypass ? 1 : 0;
        for (int i = 0; i < n; i++) { bypassGain += (target - bypassGain) * 0.002f; mono[i] = mono[i] * (1 - bypassGain) + dry[i] * bypassGain; }
    }

    public JsonObject Status() => new()
    {
        ["state"] = State, ["error"] = Error, ["provider"] = Provider, ["f0"] = F0Engine, ["inferMs"] = Math.Round(InferMs, 1), ["inferP95"] = Math.Round(InferP95, 1),
        ["latencyMs"] = Math.Round(LatencyMs), ["dropouts"] = Dropouts, ["inHz"] = Math.Round(InHz), ["outHz"] = Math.Round(OutHz), ["shift"] = Math.Round(ShiftSemis, 1),
        ["bypass"] = cfg.Bypass, ["engine"] = cfg.Engine,
    };

    public void Dispose() { lock (l) { ai?.Dispose(); ai = null; dsp = null; } }

    // ---------------- offline / timing test: --vctest in.wav out.wav settings.json [realtime] ----------------
    public static string Test(string inWav, string outWav, string settingsJson, bool realtime)
    {
        var c = VcConfig.From(JsonNode.Parse(File.ReadAllText(settingsJson))); c.Enabled = true;
        var x = Wav.ReadMono48(inWav);
        var vc = new VoiceChanger(); vc.Configure(c);
        var sw = Stopwatch.StartNew();
        while (vc.State == "loading" && sw.ElapsedMilliseconds < 120000) Thread.Sleep(20);
        if (vc.State != "running") return "ERROR " + vc.State + " " + vc.Error;
        double loadS = sw.Elapsed.TotalSeconds;
        var y = new float[x.Length]; var chunk = new float[480]; var clock = Stopwatch.StartNew();
        for (int p = 0; p + 480 <= x.Length; p += 480)
        {
            Array.Copy(x, p, chunk, 0, 480);
            if (!realtime) vc.ai?.WaitIdle();
            vc.Process(chunk, 480); Array.Copy(chunk, 0, y, p, 480);
            if (realtime) { double due = (p + 480) / 48.0; double now = clock.Elapsed.TotalMilliseconds; if (due > now) Thread.Sleep((int)(due - now)); }
        }
        Wav.Write(outWav, y, 48000);
        var a2 = vc.ai; string stages = a2 != null ? $" f0Ms={a2.MsF0:F1} cvMs={a2.MsCv:F1} genMs={a2.MsGen:F1}" : "";
        var r = $"provider={vc.Provider} f0={vc.F0Engine}{stages} load={loadS:F1}s inferMs={vc.InferMs:F1} p95={vc.InferP95:F1} latencyMs={vc.LatencyMs:F0} dropouts={vc.Dropouts} inHz={vc.InHz:F0} outHz={vc.OutHz:F0} shift={vc.ShiftSemis:F1}";
        r = r.Replace(" dropouts=", " dropouts=") ; vc.Dispose(); return r;
    }
}

// ---------------------------------------------------------------- AI (RVC v2) ----------------------------------------------------------------
public sealed class AiVoice : IDisposable
{
    readonly InferenceSession cv, f0s, gen; readonly float[] spkTable; readonly int spkCount;
    public readonly string Provider, F0Name; public bool Ready = true;
    readonly int B, X, C, S, W, T, skip; // 16 kHz samples / 10 ms frames
    readonly float[] win16; readonly float[] f0hist; readonly float[] rndHist; bool first = true;
    readonly FloatRing inRing = new(48000 * 4), outRing = new(48000 * 4);
    readonly Rational down = new(1, 3, 7600.0 / 48000, 96); Rational up; int spf = 320; // output samples per 10 ms frame: 320 (32k voices), 400 (40k), 480 (48k)
    readonly Thread worker; volatile bool stop; readonly AutoResetEvent kick = new(false); readonly ManualResetEventSlim idle = new(true);
    readonly float[] sola; float[] fadeIn; bool haveSola;
    VcConfig cfg; readonly Random rng = new(1234);
    int jitter; bool started; readonly Queue<double> times = new();
    public double InferMs, InferP95, LatencyMs, InHz, OutHz, Shift; public int Dropouts; public double MsF0, MsCv, MsGen;
    double medLogF0 = Math.Log(120); bool medInit; float[] tmpIn = new float[1];
    readonly Yin yin = new();

    public AiVoice(VcConfig c)
    {
        cfg = c;
        foreach (var p in new[] { c.CvPath, c.VoicePath }) if (string.IsNullOrEmpty(p) || !File.Exists(p)) throw new Exception("voice model file missing: " + Path.GetFileName(p ?? "(none)"));
        (B, X, C, S) = c.Quality switch { "fast" => (960, 16000, 480, 160), "quality" => (3200, 24000, 960, 320), _ => (1600, 16000, 640, 160) };
        var ov = Environment.GetEnvironmentVariable("BSP_VC_PARAMS"); // experiments: B,X,C,S in 16 kHz samples
        if (!string.IsNullOrEmpty(ov)) { var q = ov.Split(',').Select(int.Parse).ToArray(); (B, X, C, S) = (q[0], q[1], q[2], q[3]); }
        W = X + C + S + B; T = W / 160; skip = X / 160;
        win16 = new float[W]; f0hist = new float[T]; rndHist = new float[192 * T];
        for (int i = 0; i < rndHist.Length; i++) rndHist[i] = Gauss();
        string prov = "CPU";
        int rFrames = 32 * (((C + S + B + 160 * 32) / 160 + 1 - 1) / 32 + 1);
        SessionOptions Opt(bool gpu, string p)
        {
            var o = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR };
            if (Environment.GetEnvironmentVariable("BSP_VC_STATIC") != "0")
            { // every block has the same shape: tell ORT so it can plan static kernels (big win on DirectML)
                if (p == c.VoicePath) o.AddFreeDimensionOverrideByName("T", T);
                if (p == c.CvPath) o.AddFreeDimensionOverrideByName("N", W);
                if (p == c.F0Path) o.AddFreeDimensionOverrideByName("time", rFrames);
            }
            if (gpu) { o.EnableMemoryPattern = false; o.ExecutionMode = ExecutionMode.ORT_SEQUENTIAL; o.AppendExecutionProvider_DML(Gpu.BestAdapter(out _)); }
            else o.IntraOpNumThreads = Math.Clamp(Environment.ProcessorCount / 2, 2, 8);
            return o;
        }
        bool wantGpu = c.Device != "cpu" && OperatingSystem.IsWindows();
        var gpuOnly = Environment.GetEnvironmentVariable("BSP_VC_GPU"); // diagnostics: comma list of cv,f0,gen to put on the GPU
        InferenceSession Load(string p)
        {
            if (wantGpu && gpuOnly != null && !gpuOnly.Split(',').Any(k => (k == "cv" && p == c.CvPath) || (k == "f0" && p == c.F0Path) || (k == "gen" && p == c.VoicePath))) return new InferenceSession(p, Opt(false, p));
            if (wantGpu) { try { var s = new InferenceSession(p, Opt(true, p)); prov = "DirectML"; return s; } catch { wantGpu = false; } }
            return new InferenceSession(p, Opt(false, p));
        }
        gen = Load(c.VoicePath); cv = Load(c.CvPath);
        bool useRmvpe = c.F0Method != "yin" && !string.IsNullOrEmpty(c.F0Path) && File.Exists(c.F0Path) && (c.F0Method == "rmvpe" || prov == "DirectML");
        if (useRmvpe) f0s = Load(c.F0Path);
        F0Name = f0s != null ? "RMVPE" : "YIN";
        if (prov == "DirectML") { Gpu.BestAdapter(out var name); prov = "DirectML GPU" + (string.IsNullOrEmpty(name) ? "" : " (" + name + ")"); }
        Provider = prov;
        if (!string.IsNullOrEmpty(c.SpkPath) && File.Exists(c.SpkPath)) { var b = File.ReadAllBytes(c.SpkPath); spkTable = new float[b.Length / 4]; Buffer.BlockCopy(b, 0, spkTable, 0, b.Length); }
        else spkTable = new float[256];
        spkCount = spkTable.Length / 256;
        // warm up (DirectML compiles kernels for the fixed window shape on first run)
        spf = ProbeSpf();
        up = spf == 320 ? new Rational(3, 2, 15000.0 / 96000, 144) : spf == 400 ? new Rational(6, 5, 18000.0 / 240000, 360) : new Rational(1, 1, 0.49, 3);
        sola = new float[C * spf / 160]; fadeIn = new float[sola.Length];
        for (int i = 0; i < fadeIn.Length; i++) { double s = Math.Sin(0.5 * Math.PI * i / fadeIn.Length); fadeIn[i] = (float)(s * s); }
        RunBlock(); RunBlock(); var t0 = Stopwatch.StartNew(); for (int i = 0; i < 3; i++) RunBlock(); first = true; // first runs compile kernels; time the steady state Array.Clear(win16); Array.Clear(f0hist); haveSola = false;
        double warm = t0.Elapsed.TotalMilliseconds / 3;
        jitter = (int)Math.Clamp(warm * 1.2 * 48 + 240, 960, 48 * 150); // grows by 10 ms on any dropout
        worker = new Thread(Loop) { IsBackground = true, Priority = ThreadPriority.AboveNormal, Name = "bsp-voice" }; worker.Start();
    }

    int ProbeSpf()
    {
        int t = T, sk = skip;
        using var r = gen.Run(new[] {
            NamedOnnxValue.CreateFromTensor("phone", new DenseTensor<float>(new float[t * 768], new[] { 1, t, 768 })),
            NamedOnnxValue.CreateFromTensor("phone_lengths", new DenseTensor<long>(new long[] { t }, new[] { 1 })),
            NamedOnnxValue.CreateFromTensor("pitch", new DenseTensor<long>(Enumerable.Repeat(50L, t).ToArray(), new[] { 1, t })),
            NamedOnnxValue.CreateFromTensor("nsff0", new DenseTensor<float>(Enumerable.Repeat(150f, t).ToArray(), new[] { 1, t })),
            NamedOnnxValue.CreateFromTensor("spk", new DenseTensor<float>(new float[256], new[] { 1, 256 })),
            NamedOnnxValue.CreateFromTensor("rnd", new DenseTensor<float>(new float[192 * t], new[] { 1, 192, t })),
            NamedOnnxValue.CreateFromTensor("skip_head", new DenseTensor<long>(new long[] { sk }, new[] { 1 })) });
        int n = (int)r.First().AsTensor<float>().Length / (t - sk);
        if (n != 320 && n != 400 && n != 480) throw new Exception($"unsupported voice sample rate ({n * 100} Hz)");
        return n;
    }
    float Gauss() { double u1 = 1 - rng.NextDouble(), u2 = rng.NextDouble(); return (float)(Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2)); }
    public void Set(VcConfig c) => cfg = c;
    public void WaitIdle() { while (inRing.Count >= B * 3 || !idle.IsSet) { idle.Wait(50); Thread.Yield(); if (inRing.Count >= B * 3) kick.Set(); } }

    public void Process(float[] mono, int n)
    {
        inRing.Write(mono, n);
        if (inRing.Count >= B * 3) kick.Set();
        if (!started) { if (outRing.Count >= B * 3) { started = true; } else { Array.Clear(mono, 0, n); return; } }
        int maxBacklog = B * 3 + jitter + 960;
        int got = outRing.Read(mono, n, maxBacklog);
        if (got < n) { Dropouts++; jitter = Math.Min(jitter + 480, 48 * 200); started = false; }
        LatencyMs = (B + C + S) / 16.0 + jitter / 48.0 + 3;
    }

    void Loop()
    {
        var blk = new float[B * 3];
        while (!stop)
        {
            kick.WaitOne(100);
            while (!stop && inRing.Count >= B * 3)
            {
                idle.Reset();
                inRing.Read(blk, B * 3, 48000 * 4);
                var d16 = down.Process(blk, blk.Length);
                Array.Copy(win16, d16.Length, win16, 0, W - d16.Length); Array.Copy(d16, 0, win16, W - d16.Length, d16.Length);
                var sw = Stopwatch.StartNew();
                float[] y;
                try { y = RunBlock(); }
                catch (Exception) { y = new float[B * spf / 160]; }
                var y48 = up.Process(y, y.Length);
                if (!started && outRing.Count == 0) { var z = new float[jitter]; outRing.Write(z, z.Length); }
                outRing.Write(y48, y48.Length);
                double ms = sw.Elapsed.TotalMilliseconds;
                lock (times) { times.Enqueue(ms); while (times.Count > 50) times.Dequeue(); InferMs = times.Average(); var s = times.OrderBy(v => v).ToArray(); InferP95 = s[(int)(s.Length * 0.95)]; }
                idle.Set();
            }
        }
    }

    float[] RunBlock()
    {
        var c = cfg;
        // ----- pitch (shift history by one block, analyse the newest part) -----
        int nb = B / 160;
        Array.Copy(f0hist, nb, f0hist, 0, T - nb);
        int R = Math.Min(W, C + S + B + 160 * 32);
        int keepFrom = first ? 0 : 12; // re-estimate everything but a little context at the left edge of the tail
        var stw = Stopwatch.StartNew();
        float[] f0tail = f0s != null ? Rmvpe(win16, W - R, R) : yin.Track(win16, W - R, R);
        MsF0 = MsF0 * 0.9 + 0.1 * stw.Elapsed.TotalMilliseconds; stw.Restart();
        int baseFrame = (W - R) / 160;
        for (int k = keepFrom; k < f0tail.Length && baseFrame + k < T; k++) f0hist[baseFrame + k] = f0tail[k];
        first = false;
        // auto pitch: running median of your voiced pitch -> shift that lands it on the voice's natural pitch
        double sumL = 0; int cnt = 0;
        for (int k = T - nb; k < T; k++) if (f0hist[k] > 0) { sumL += Math.Log(f0hist[k]); cnt++; }
        if (cnt > 0)
        {
            double m = sumL / cnt; InHz = Math.Exp(m);
            if (!medInit) { medLogF0 = m; medInit = true; } else medLogF0 += Math.Clamp(m - medLogF0, -0.02, 0.02); // slew-limited, ~5 s to settle
        }
        double shift = c.AutoPitch && medInit ? 12 * (Math.Log(c.TargetHz) - medLogF0) / Math.Log(2) + c.Pitch * 0 : c.Pitch;
        if (c.AutoPitch) shift += c.Pitch; // manual offset on top of auto
        shift = Math.Clamp(shift, -24, 24); Shift = shift;
        double ratio = Math.Pow(2, shift / 12);
        var f0 = new float[T]; var pitch = new long[T];
        for (int k = 0; k < T; k++)
        {
            f0[k] = (float)(f0hist[k] * ratio);
            double mel = 1127 * Math.Log(1 + f0[k] / 700.0), lo = 1127 * Math.Log(1 + 50 / 700.0), hi = 1127 * Math.Log(1 + 1100 / 700.0);
            double mm = mel > 0 ? (mel - lo) * 254 / (hi - lo) + 1 : mel; pitch[k] = (long)Math.Round(Math.Clamp(mm, 1, 255));
        }
        if (cnt > 0) OutHz = InHz * ratio;
        // ----- content features -----
        float[] feats;
        using (var r = cv.Run(new[] { NamedOnnxValue.CreateFromTensor("audio", new DenseTensor<float>(win16, new[] { 1, W })) }))
        {
            var t = r.First().AsTensor<float>(); int t50 = t.Dimensions[1]; var src = t.ToArray(); feats = new float[T * 768];
            for (int k = 0; k < T; k++) { int j = Math.Min(k / 2, t50 - 1); Array.Copy(src, j * 768, feats, k * 768, 768); }
        }
        MsCv = MsCv * 0.9 + 0.1 * stw.Elapsed.TotalMilliseconds; stw.Restart();
        // ----- noise attached to time (keeps overlapping windows consistent) -----
        for (int ch = 0; ch < 192; ch++) { Array.Copy(rndHist, ch * T + nb, rndHist, ch * T, T - nb); for (int k = T - nb; k < T; k++) rndHist[ch * T + k] = Gauss(); }
        var rnd = new float[192 * T]; float ex = (float)c.Expressive; for (int i = 0; i < rnd.Length; i++) rnd[i] = rndHist[i] * ex;
        // ----- speaker (optionally blended with a second voice) -----
        var spk = new float[256];
        int s1 = Math.Clamp(c.Sid, 0, spkCount - 1); Array.Copy(spkTable, s1 * 256, spk, 0, 256);
        if (c.Sid2 >= 0 && c.Sid2 < spkCount && c.Blend > 0) for (int i = 0; i < 256; i++) spk[i] = (float)(spk[i] * (1 - c.Blend) + spkTable[c.Sid2 * 256 + i] * c.Blend);
        float[] o;
        using (var r = gen.Run(new[] {
            NamedOnnxValue.CreateFromTensor("phone", new DenseTensor<float>(feats, new[] { 1, T, 768 })),
            NamedOnnxValue.CreateFromTensor("phone_lengths", new DenseTensor<long>(new long[] { T }, new[] { 1 })),
            NamedOnnxValue.CreateFromTensor("pitch", new DenseTensor<long>(pitch, new[] { 1, T })),
            NamedOnnxValue.CreateFromTensor("nsff0", new DenseTensor<float>(f0, new[] { 1, T })),
            NamedOnnxValue.CreateFromTensor("spk", new DenseTensor<float>(spk, new[] { 1, 256 })),
            NamedOnnxValue.CreateFromTensor("rnd", new DenseTensor<float>(rnd, new[] { 1, 192, T })),
            NamedOnnxValue.CreateFromTensor("skip_head", new DenseTensor<long>(new long[] { skip }, new[] { 1 })) }))
            o = r.First().AsTensor<float>().ToArray();
        MsGen = MsGen * 0.9 + 0.1 * stw.Elapsed.TotalMilliseconds;
        // ----- loudness follows your voice (silence stays silent, dynamics preserved) -----
        int frames = Math.Min(o.Length / spf, (W - X) / 160);
        if (c.EnvMix < 1)
        {
            var g = new float[frames + 1];
            for (int k = 0; k < frames; k++)
            {
                double ei = 0, eo = 0; for (int i = 0; i < 160; i++) { float v = win16[X + k * 160 + i]; ei += v * v; } for (int i = 0; i < spf; i++) { float v = o[k * spf + i]; eo += v * v; }
                double ri = Math.Sqrt(ei / 160) + 1e-6, ro = Math.Sqrt(eo / spf) + 1e-6;
                g[k] = (float)Math.Min(4.0, Math.Pow(ri / ro, 1 - c.EnvMix));
            }
            g[frames] = frames > 0 ? g[frames - 1] : 1;
            for (int i = 0; i < frames * spf; i++) { int k = i / spf; float a = (i % spf) / (float)spf; o[i] *= g[k] * (1 - a) + g[k + 1] * a; }
        }
        // ----- SOLA: best-matching offset, then crossfade with the previous block's tail -----
        int C2 = C * spf / 160, S2 = S * spf / 160, B2 = B * spf / 160, off = 0;
        if (haveSola)
        {
            double best = double.NegativeInfinity;
            for (int k = 0; k <= S2; k++)
            {
                double num = 0, den = 1e-8; for (int i = 0; i < C2; i++) { float v = o[k + i]; num += v * sola[i]; den += v * v; }
                double sc = num / Math.Sqrt(den); if (sc > best) { best = sc; off = k; }
            }
        }
        var y = new float[B2];
        Array.Copy(o, off, y, 0, Math.Min(B2, o.Length - off));
        if (haveSola) for (int i = 0; i < C2; i++) y[i] = y[i] * fadeIn[i] + sola[i] * (1 - fadeIn[i]);
        for (int i = 0; i < C2; i++) { int j = off + B2 + i; sola[i] = j < o.Length ? o[j] : 0; }
        haveSola = true;
        return y;
    }

    // ----- RMVPE: log-mel (128 bands, 30..8000 Hz, htk, slaney-normed) -> salience -> local-average cents -----
    static readonly float[,] MelFb = MelBank(); static readonly float[] Hann1024 = Enumerable.Range(0, 1024).Select(i => (float)(0.5 - 0.5 * Math.Cos(2 * Math.PI * i / 1024))).ToArray();
    static float[,] MelBank()
    {
        double Hz2Mel(double f) => 2595 * Math.Log10(1 + f / 700); double Mel2Hz(double m) => 700 * (Math.Pow(10, m / 2595) - 1);
        var pts = new double[130]; double a = Hz2Mel(30), b = Hz2Mel(8000);
        for (int i = 0; i < 130; i++) pts[i] = Mel2Hz(a + (b - a) * i / 129);
        var fb = new float[128, 513];
        for (int m = 0; m < 128; m++)
        {
            double en = 2.0 / (pts[m + 2] - pts[m]);
            for (int k = 0; k < 513; k++)
            {
                double f = k * 8000.0 / 512, lower = (f - pts[m]) / (pts[m + 1] - pts[m]), upper = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
                fb[m, k] = (float)(Math.Max(0, Math.Min(lower, upper)) * en);
            }
        }
        return fb;
    }
    public static float[] LogMel(float[] x, int start, int len, out int frames)
    {
        frames = len / 160 + 1; int padded = 32 * ((frames - 1) / 32 + 1);
        var mel = new float[128 * padded];
        var re = new double[1024]; var im = new double[1024]; var mag = new double[513];
        for (int f = 0; f < frames; f++)
        {
            int c0 = f * 160 - 512;
            for (int i = 0; i < 1024; i++)
            {
                int j = c0 + i; // reflect padding at both ends
                if (j < 0) j = -j; if (j >= len) j = 2 * (len - 1) - j; j = Math.Clamp(j, 0, len - 1);
                re[i] = x[start + j] * Hann1024[i]; im[i] = 0;
            }
            Fft2.Transform(re, im);
            for (int k = 0; k <= 512; k++) mag[k] = Math.Sqrt(re[k] * re[k] + im[k] * im[k]);
            for (int m = 0; m < 128; m++) { double s = 0; for (int k = 0; k <= 512; k++) s += MelFb[m, k] * mag[k]; mel[m * padded + f] = (float)Math.Log(Math.Max(s, 1e-5)); }
        }
        if (padded != frames) // the model needs a multiple of 32 frames; pad with the silence value like the reference code's zero-pad of the log-mel
            for (int m = 0; m < 128; m++) for (int f = frames; f < padded; f++) mel[m * padded + f] = 0;
        return mel;
    }
    static readonly double[] CentsMap = Enumerable.Range(0, 368).Select(i => i < 4 || i >= 364 ? 0.0 : 20 * (i - 4) + 1997.3794084376191).ToArray();
    float[] Rmvpe(float[] x, int start, int len)
    {
        var mel = LogMel(x, start, len, out int frames); int padded = mel.Length / 128;
        float[] h;
        using (var r = f0s.Run(new[] { NamedOnnxValue.CreateFromTensor(f0s.InputMetadata.Keys.First(), new DenseTensor<float>(mel, new[] { 1, 128, padded })) }))
            h = r.First().AsTensor<float>().ToArray();
        var f0 = new float[frames];
        for (int f = 0; f < frames; f++)
        {
            int bestI = 0; float bestV = -1; for (int i = 0; i < 360; i++) { float v = h[f * 360 + i]; if (v > bestV) { bestV = v; bestI = i; } }
            if (bestV <= 0.03f) { f0[f] = 0; continue; }
            double num = 0, den = 0; int cIdx = bestI + 4;
            for (int d = -4; d <= 4; d++) { int pi = cIdx + d - 4; double sal = pi >= 0 && pi < 360 ? h[f * 360 + pi] : 0; num += sal * CentsMap[cIdx + d]; den += sal; }
            double cents = num / den; f0[f] = (float)(10 * Math.Pow(2, cents / 1200));
        }
        return f0;
    }

    public void Dispose() { stop = true; kick.Set(); try { worker?.Join(2000); } catch { } cv?.Dispose(); f0s?.Dispose(); gen?.Dispose(); }
}

// ---------------------------------------------------------------- YIN pitch (CPU) ----------------------------------------------------------------
public sealed class Yin
{
    // 16 kHz in, 10 ms frames centred like the RMVPE frames (frame k at sample k*160)
    const int Win = 640, MinLag = 14, MaxLag = 300;
    readonly double[] d = new double[MaxLag + 1];
    public float[] Track(float[] x, int start, int len)
    {
        int frames = len / 160 + 1; var f0 = new float[frames];
        for (int f = 0; f < frames; f++) f0[f] = Frame(x, start, len, f * 160 - Win / 2);
        // 3-tap median removes single-frame octave slips
        var o = (float[])f0.Clone();
        for (int f = 1; f + 1 < frames; f++) { float a = f0[f - 1], b = f0[f], c = f0[f + 1]; o[f] = Math.Max(Math.Min(a, b), Math.Min(Math.Max(a, b), c)); }
        return o;
    }
    public float One(float[] x, int len) => Frame(x, 0, len, 0);
    float Frame(float[] x, int start, int len, int s0)
    {
        float At(int i) { i = Math.Clamp(i, 0, len - 1); return x[start + i]; }
        int n = Win - MaxLag; double e = 0;
        for (int i = 0; i < Win; i++) { float v = At(s0 + i); e += v * v; }
        if (e / Win < 1e-6) return 0; // below about -60 dBFS
        for (int tau = 1; tau <= MaxLag; tau++) { double s = 0; for (int i = 0; i < n; i++) { float a = At(s0 + i) - At(s0 + i + tau); s += a * a; } d[tau] = s; }
        double run = 0; d[0] = 1;
        for (int tau = 1; tau <= MaxLag; tau++) { run += d[tau]; d[tau] = run > 0 ? d[tau] * tau / run : 1; }
        int best = -1;
        for (int tau = MinLag; tau < MaxLag; tau++) if (d[tau] < 0.15) { while (tau + 1 < MaxLag && d[tau + 1] < d[tau]) tau++; best = tau; break; }
        if (best < 0) { double mn = 1; for (int tau = MinLag; tau < MaxLag; tau++) if (d[tau] < mn) { mn = d[tau]; best = tau; } if (mn > 0.4) return 0; }
        double a0 = d[best - 1], b0 = d[best], c0 = d[best + 1], den = a0 - 2 * b0 + c0;
        double t = best + (Math.Abs(den) > 1e-12 ? 0.5 * (a0 - c0) / den : 0);
        double hz = 16000 / t; return hz < 55 || hz > 1100 ? 0 : (float)hz;
    }
}

// ---------------------------------------------------------------- DSP: PSOLA pitch + formant ----------------------------------------------------------------
public sealed class PsolaVoice
{
    // 48 kHz, absolute sample clock. Analysis grains (2 periods, Hann) are taken pitch-synchronously from the input and
    // re-spaced at the new period; each grain is resampled by the formant factor, which moves the vocal-tract resonances
    // independently of the pitch.
    const int Look = 1200, MaxGh = 1000, Delay = Look + MaxGh + 48, Cap = 1 << 16, Mask = Cap - 1;
    readonly float[] x = new float[Cap], acc = new float[Cap], wsum = new float[Cap];
    long inEnd, ts, outPos, ma; readonly float[] f0Frames = new float[Cap / 480]; long f0Done; // one f0 per 10 ms (480 samples)
    readonly Yin yin = new(); readonly float[] dec = new float[2048];
    double pf = 1, fr = 1; VcConfig cfg = new(); double medLog = Math.Log(120); bool medInit;
    public double LatencyMs => Delay / 48.0;
    public double InHz, OutHz, Shift, CpuMs;
    readonly Stopwatch sw = new();
    public void Set(VcConfig c) { cfg = c; fr = 1 + c.Formant / 100.0; }
    float PeriodAt(long t)
    {
        long fi = t / 480; if (fi < 0 || fi >= f0Done) fi = Math.Max(0, f0Done - 1);
        float hz = f0Frames[fi % f0Frames.Length]; return hz > 0 ? 48000f / hz : 0;
    }
    public void Process(float[] mono, int n)
    {
        sw.Restart();
        for (int i = 0; i < n; i++) x[(inEnd + i) & Mask] = mono[i];
        inEnd += n;
        // pitch: YIN on a 16 kHz copy, one frame per 10 ms, centred, needs ~25 ms of look-ahead
        while ((f0Done + 1) * 480 + 1200 <= inEnd)
        {
            long c0 = f0Done * 480 + 240 - 960; // 640 samples @16 kHz (40 ms) centred on the frame
            for (int i = 0; i < 640; i++) { long j = c0 + i * 3; dec[i] = j < 0 ? 0 : (x[j & Mask] + x[(j + 1) & Mask] + x[(j + 2) & Mask]) / 3f; }
            float hz = yin.One(dec, 640);
            f0Frames[f0Done % f0Frames.Length] = hz; f0Done++;
            if (hz > 0)
            {
                double m = Math.Log(hz); InHz = hz;
                if (!medInit) { medLog = m; medInit = true; } else medLog += Math.Clamp(m - medLog, -0.004, 0.004);
            }
        }
        double shift = cfg.AutoPitch && medInit ? 12 * (Math.Log(cfg.TargetHz) - medLog) / Math.Log(2) + cfg.Pitch : cfg.Pitch;
        shift = Math.Clamp(shift, -24, 24); Shift = shift; pf = Math.Pow(2, shift / 12); OutHz = InHz * pf;
        // synthesis
        long limit = inEnd - Look;
        while (ts < limit)
        {
            float pa = PeriodAt(ts); bool voiced = pa > 0; if (!voiced) pa = 240;
            while (ma + pa < ts) ma += (long)Math.Round(pa);
            if (ma < ts - pa / 2) ma += (long)Math.Round(pa);
            double ps0 = voiced ? pa / pf : pa;
            int half = (int)Math.Max(16, Math.Min(pa, ps0 * fr)); // grain never wider than two output periods: no comb/octave smearing on big upward shifts
            int gh = Math.Min(MaxGh, (int)Math.Ceiling(half / fr));
            for (int j = -gh; j <= gh; j++)
            {
                double srcOff = j * fr; if (srcOff <= -half || srcOff >= half) continue;
                double w = 0.5 + 0.5 * Math.Cos(Math.PI * srcOff / half);
                double sp = ma + srcOff; long i0 = (long)Math.Floor(sp); float a = (float)(sp - i0);
                float v = x[i0 & Mask] * (1 - a) + x[(i0 + 1) & Mask] * a;
                long o = ts + j; acc[o & Mask] += (float)(v * w); wsum[o & Mask] += (float)w;
            }
            double ps = voiced ? pa / pf : pa; ts += Math.Max(16, (long)Math.Round(ps));
        }
        // emit everything no future grain can touch any more
        long ready = ts - MaxGh - 1;
        var outBuf = new float[n];
        // constant delay: output sample i is input sample (inEnd - n + i - Delay)
        long want0 = inEnd - n - Delay;
        for (int i = 0; i < n; i++)
        {
            long t = want0 + i;
            if (t < 0 || t >= ready) { outBuf[i] = 0; continue; }
            float ws = wsum[t & Mask]; outBuf[i] = ws > 0.15f ? acc[t & Mask] / ws : acc[t & Mask] / 0.15f;
            acc[t & Mask] = 0; wsum[t & Mask] = 0;
        }
        Array.Copy(outBuf, mono, n);
        CpuMs = CpuMs * 0.95 + 0.05 * sw.Elapsed.TotalMilliseconds;
    }
}

// ---------------------------------------------------------------- helpers ----------------------------------------------------------------
public sealed class Rational
{
    // Polyphase FIR resampler by L/M (Kaiser-windowed sinc). Stateful across calls.
    readonly int L, M; readonly float[] h; readonly List<float> buf = new(); long baseIdx, outIdx;
    public Rational(int up, int down, double cutoff, int taps)
    {
        L = up; M = down; h = new float[taps]; double beta = 8.0, i0b = I0(beta), mid = (taps - 1) / 2.0;
        for (int k = 0; k < taps; k++)
        {
            double t = k - mid, s = t == 0 ? 2 * cutoff : Math.Sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
            double r = 2.0 * k / (taps - 1) - 1; h[k] = (float)(s * I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / i0b * L);
        }
    }
    static double I0(double x) { double s = 1, t = 1; for (int k = 1; k < 30; k++) { t *= x / (2 * k); s += t * t; } return s; }
    public float[] Process(float[] input, int n)
    {
        for (int i = 0; i < n; i++) buf.Add(input[i]);
        long lastIn = baseIdx + buf.Count - 1; var o = new List<float>(n * L / M + 2);
        while (true)
        {
            long p = outIdx * M; long iHi = p / L; if (iHi > lastIn) break;
            long iLo = (long)Math.Ceiling((p - h.Length + 1) / (double)L);
            double s = 0;
            for (long i = Math.Max(iLo, 0); i <= iHi; i++) { long k = p - i * L; if (i < baseIdx) continue; s += h[k] * buf[(int)(i - baseIdx)]; }
            o.Add((float)s); outIdx++;
        }
        long need = (outIdx * M - h.Length) / L - 1; if (need > baseIdx) { int drop = (int)Math.Min(need - baseIdx, buf.Count); buf.RemoveRange(0, drop); baseIdx += drop; }
        return o.ToArray();
    }
}

public static class Fft2
{
    public static void Transform(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++) { int bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); } }
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++)
                {
                    int a = i + k, b = a + len / 2; double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }
}

public static class Gpu
{
    // Pick the DXGI adapter with the most dedicated VRAM (the discrete card, not the CPU's iGPU).
    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr f);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Desc1 { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description; public uint VendorId, DeviceId, SubSysId, Revision; public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory; public long Luid; public uint Flags; }
    delegate int EnumAdapters1(IntPtr self, uint i, out IntPtr a); delegate int GetDesc1(IntPtr self, out Desc1 d); delegate uint Release(IntPtr self);
    static int cached = -2; static string cachedName = "";
    public static int BestAdapter(out string name)
    {
        if (cached != -2) { name = cachedName; return Math.Max(cached, 0); }
        cached = 0; name = "";
        try
        {
            var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
            if (CreateDXGIFactory1(ref iid, out var f) != 0) return 0;
            var fv = Marshal.ReadIntPtr(f); var enumA = Marshal.GetDelegateForFunctionPointer<EnumAdapters1>(Marshal.ReadIntPtr(fv, 12 * IntPtr.Size));
            ulong best = 0;
            for (uint i = 0; i < 16; i++)
            {
                if (enumA(f, i, out var a) != 0) break;
                var av = Marshal.ReadIntPtr(a); var gd = Marshal.GetDelegateForFunctionPointer<GetDesc1>(Marshal.ReadIntPtr(av, 10 * IntPtr.Size));
                if (gd(a, out var d) == 0 && (d.Flags & 2) == 0 && (ulong)d.DedicatedVideoMemory > best) { best = (ulong)d.DedicatedVideoMemory; cached = (int)i; cachedName = d.Description; }
                Marshal.GetDelegateForFunctionPointer<Release>(Marshal.ReadIntPtr(av, 2 * IntPtr.Size))(a);
            }
            Marshal.GetDelegateForFunctionPointer<Release>(Marshal.ReadIntPtr(fv, 2 * IntPtr.Size))(f);
        }
        catch { cached = 0; }
        name = cachedName; return cached;
    }
}

public static class Wav
{
    public static float[] ReadMono48(string path)
    {
        var b = File.ReadAllBytes(path); int p = 12, ch = 1, rate = 48000, bits = 16, fmt = 1; float[] data = null;
        while (p + 8 <= b.Length)
        {
            string id = System.Text.Encoding.ASCII.GetString(b, p, 4); int sz = BitConverter.ToInt32(b, p + 4); int d = p + 8;
            if (id == "fmt ") { fmt = BitConverter.ToInt16(b, d); ch = BitConverter.ToInt16(b, d + 2); rate = BitConverter.ToInt32(b, d + 4); bits = BitConverter.ToInt16(b, d + 14); }
            else if (id == "data")
            {
                int bps = bits / 8, frames = Math.Min(sz, b.Length - d) / (bps * ch); data = new float[frames];
                for (int i = 0; i < frames; i++)
                {
                    double s = 0; for (int c = 0; c < ch; c++) { int o = d + (i * ch + c) * bps; s += fmt == 3 ? BitConverter.ToSingle(b, o) : bits == 16 ? BitConverter.ToInt16(b, o) / 32768.0 : BitConverter.ToInt32(b, o) / 2147483648.0; }
                    data[i] = (float)(s / ch);
                }
            }
            p = d + sz + (sz & 1);
        }
        if (data == null) throw new Exception("no audio in " + path);
        if (rate == 48000) return data;
        var r = new Rational(48000 / Gcd(48000, rate), rate / Gcd(48000, rate), 0.45 * Math.Min(1.0, 48000.0 / rate) / (48000 / Gcd(48000, rate)), 48 * (48000 / Gcd(48000, rate)) + 1);
        return r.Process(data, data.Length);
    }
    static int Gcd(int a, int b) => b == 0 ? a : Gcd(b, a % b);
    public static void Write(string path, float[] x, int rate)
    {
        using var fs = new FileStream(path, FileMode.Create); using var w = new BinaryWriter(fs);
        w.Write("RIFF"u8.ToArray()); w.Write(36 + x.Length * 2); w.Write("WAVEfmt "u8.ToArray()); w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write("data"u8.ToArray()); w.Write(x.Length * 2); foreach (var v in x) w.Write((short)Math.Clamp(v * 32767f, -32768, 32767));
    }
}

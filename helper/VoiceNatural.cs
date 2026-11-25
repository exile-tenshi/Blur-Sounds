// v2.6.0 "Natural sounds": breaths, sniffles, sighs, coughs and laughs are not pushed raw through the AI voice (RVC turns
// them into garbled half-vowels). Every 10 ms frame of your input is scored (level vs. noise floor, voicing from the
// AI's own pitch tracker, spectral flatness/centroid, voiced/aspirated "ha-ha" rhythm) and the output crossfades between
// the AI voice and a light pitch + formant shifted copy of your real sound (PSOLA, same shift as the AI, formants moved
// toward the target gender). Speech stays 100% AI.
namespace Bsp;

public sealed class NatSounds
{
    const int Cap = 1 << 17, Mask = Cap - 1, FCap = 1 << 12, FMask = FCap - 1, L = 8; // L = frames of look-ahead for decisions
    public static int DryDelay => PsolaVoice.DelaySamples;
    // input-time rings (48 kHz): raw input, shifted dry copy, AI output
    readonly float[] raw = new float[Cap], dry = new float[Cap], ai = new float[Cap];
    long inCount, dryEnd, aiEnd = long.MinValue, emitPos = long.MinValue;
    readonly PsolaVoice ps = new(); readonly VcConfig psCfg = new() { Enabled = true, Engine = "dsp", AutoPitch = false };
    float[] tmp = new float[4096];
    // per-frame analysis (frame f = input samples [f*480, f*480+480))
    readonly float[] fRms = new float[FCap], fFlat = new float[FCap], fCent = new float[FCap], fF0 = new float[FCap], fW = new float[FCap];
    readonly byte[] fCls = new byte[FCap]; // 0 silence, 1 speech, 2 breath/sniff/sigh, 3 cough/burst, 4 laugh
    long featDone, decided; double nf = -70, sl = -30, medSpeech = Math.Log(150); bool medInit; float w;
    bool laughing;
    readonly double[] re = new double[1024], im = new double[1024]; static readonly double[] Hann = Enumerable.Range(0, 1024).Select(i => 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / 1024)).ToArray();
    public bool Enabled = true; public double Blend = 0.75, FormantPct = double.NaN, Shift;
    public string Now = "speech"; public int Laughs, Noises; public bool Laughing => laughing;
    public double ExtraMs { get; private set; }
    public string Debug = Environment.GetEnvironmentVariable("BSP_VC_NATDEBUG"); // "ai" | "dry" | log file path

    public void Configure(VcConfig c) { Enabled = c.Natural; Blend = c.NatBlend; FormantPct = c.NatFormant; }

    // ---- input side (worker thread, same blocks the AI consumes) ----
    public void FeedInput(float[] blk, int n)
    {
        for (int i = 0; i < n; i++) raw[(inCount + i) & Mask] = blk[i];
        // dry path: PSOLA with the AI's current shift and a gender-appropriate formant move
        double fp = !double.IsNaN(FormantPct) ? FormantPct : Math.Clamp(Shift * 1.35, -14, 17);
        psCfg.Pitch = Shift; psCfg.Formant = fp; ps.Set(psCfg);
        if (tmp.Length < n) tmp = new float[n];
        Array.Copy(blk, tmp, n); ps.Process(tmp, n);
        // ps output sample j (absolute j = inCount + i) is input sample j - Delay
        for (int i = 0; i < n; i++) { long t = inCount + i - DryDelay; if (t >= 0) dry[t & Mask] = tmp[i]; }
        inCount += n; dryEnd = inCount - DryDelay;
        // spectral features need 512 samples past the frame centre
        while (featDone * 480 + 240 + 512 <= inCount) { Features(featDone); featDone++; }
    }

    // RMVPE/YIN pitch of the AI window: f0[k] is centred on 16 kHz sample k*160 of a window whose last sample is input sample inCount-1
    public void PushF0(float[] f0, int T, int W16)
    {
        long w0 = inCount - (long)W16 * 3; // input-time of window sample 0
        for (int k = 0; k < T; k++)
        {
            long c = w0 + k * 480L; if (c < 0) continue;
            long f = c / 480; if (f < decided || f >= featDone + 64) continue; fF0[f & FMask] = f0[k];
        }
        // decide every frame that has features + look-ahead
        while (decided + L < featDone) { Decide(decided); decided++; }
    }

    void Features(long f)
    {
        long c = f * 480 + 240; double e = 0;
        for (int i = 0; i < 480; i++) { float v = raw[(f * 480 + i) & Mask]; e += v * v; }
        fRms[f & FMask] = (float)(10 * Math.Log10(e / 480 + 1e-12));
        for (int i = 0; i < 1024; i++) { long j = c - 512 + i; re[i] = j < 0 ? 0 : raw[j & Mask] * Hann[i]; im[i] = 0; }
        Fft2.Transform(re, im);
        double sl2 = 0, sp = 0, cn = 0, cw = 0; int nb = 0;
        for (int k = 2; k < 512; k++)
        {
            double p = re[k] * re[k] + im[k] * im[k] + 1e-14, hz = k * 46.875;
            if (hz >= 300 && hz <= 8000) { sl2 += Math.Log(p); sp += p; nb++; }
            if (hz >= 100) { cn += hz * p; cw += p; }
        }
        fFlat[f & FMask] = (float)(Math.Exp(sl2 / nb) / (sp / nb));
        fCent[f & FMask] = (float)(cn / cw);
        double rr = fRms[f & FMask];
        if (rr < nf) nf += (rr - nf) * 0.3; else nf = Math.Min(nf + 0.01, -20);
        fNf[f & FMask] = (float)nf; fAct[f & FMask] = rr > nf + 9 && rr > -66;
    }

    readonly bool[] fAct = new bool[FCap];
    bool Active(long f) => f >= 0 && f < featDone && fAct[f & FMask];
    bool Voiced(long f) => f >= 0 && f < featDone && fF0[f & FMask] > 0;
    readonly double[] x = new double[NatModel.NIn], p = new double[3]; bool inEvent; int laughHold2, evRun;
    public double EnterThr = 0.8, StayThr = 0.5;

    // 22 context features, identical to nsc/feat.py context()
    void Context(long f, double[] o)
    {
        int k = 0;
        foreach (int back in new[] { 12, 40 })
        {
            long a = Math.Max(0, f - back), b = Math.Min(featDone - 1, f + L); int n = (int)(b - a + 1);
            double vS = 0, aS = 0, relS = 0, rS = 0, rS2 = 0, flS = 0, ceS = 0; int auN = 0, vN = 0, trans = 0; double lS = 0, lS2 = 0, dMax = 0;
            for (long q = a; q <= b; q++)
            {
                int i = (int)(q & FMask); bool v = fF0[i] > 0, ac = fAct[i]; double r = fRms[i];
                if (v) { vS++; double lf = Math.Log(Math.Max(fF0[i], 1)); lS += lf; lS2 += lf * lf; vN++; }
                if (ac) { aS++; relS += r - sl; }
                rS += r; rS2 += r * r;
                if (ac && !v) { auN++; flS += fFlat[i]; ceS += fCent[i]; }
                if (q > a)
                {
                    int j = (int)((q - 1) & FMask); bool pv = fF0[j] > 0;
                    if (v && !pv) trans++;
                    if (v && pv) { double d = Math.Abs(Math.Log(Math.Max(fF0[i], 1)) - Math.Log(Math.Max(fF0[j], 1))); if (d > dMax) dMax = d; }
                }
            }
            double rm = rS / n;
            o[k++] = vS / n; o[k++] = aS / n; o[k++] = relS / Math.Max(1, aS) / 10; o[k++] = Math.Sqrt(Math.Max(0, rS2 / n - rm * rm)) / 10;
            o[k++] = auN > 0 ? flS / auN : 0; o[k++] = auN > 0 ? ceS / auN / 1000 : 0;
            if (vN > 1) { double lm = lS / vN; o[k++] = lm - medSpeech; o[k++] = Math.Sqrt(Math.Max(0, lS2 / vN - lm * lm)); o[k++] = dMax; }
            else { o[k++] = 0; o[k++] = 0; o[k++] = 0; }
            o[k++] = trans / 5.0;
        }
        int c = (int)(f & FMask);
        o[k++] = (fRms[c] - sl) / 10; o[k++] = (fRms[c] - fNf[c]) / 10;
    }
    readonly float[] fNf = new float[FCap];

    void Decide(long f)
    {
        int i = (int)(f & FMask); double r = fRms[i]; bool v = fF0[i] > 0;
        bool act = fAct[i];
        if (v && act && !laughing) { sl += (r - sl) * 0.02; double m = Math.Log(fF0[i]); if (!medInit) { medSpeech = m; medInit = true; } else medSpeech += Math.Clamp(m - medSpeech, -0.01, 0.01); }
        byte cls = 0;
        if (act)
        {
            Context(f, x); NatModel.Predict(x, p);
            // breaths / sniffles / sighs are unvoiced (or very quiet): never pull a loud voiced speech frame onto the dry path
            bool laughy = p[2] > p[1];
            double ev = laughy ? p[2] : ((!v || r < sl - 10) && x[0] < 0.35 ? p[1] : 0); // x[0] = voiced share of the last 120 ms + look-ahead: breaths sit in gaps, not inside words
            inEvent = ev > (inEvent ? StayThr : EnterThr);
            evRun = inEvent ? evRun + 1 : 0;   // debounce: 4 frames (40 ms) before anything changes
            cls = evRun < 4 ? (byte)1 : laughy ? (byte)4 : (byte)2;
        }
        else { inEvent = false; evRun = 0; }
        if (cls == 4) { laughing = true; laughHold2 = 20; } else if (laughHold2 > 0) laughHold2--; else laughing = false;
        if (cls == 4 && fCls[(f - 1) & FMask] != 4) Laughs++;
        if (cls is 2 or 3 && fCls[(f - 1) & FMask] is not (2 or 3)) Noises++;
        fCls[i] = cls;
        // target weight of the natural (dry, shifted) sound
        double b = Math.Clamp(Blend, 0, 1);
        double target = !Enabled ? 0 : cls switch { 2 or 3 => Math.Min(1, b * 1.33), 4 => b * 0.6, _ => 0 };
        if (laughing && cls == 0) target = w;
        // hold through tiny pauses inside a laugh
        if (Debug == "dry") target = 1; else if (Debug == "ai") target = 0;
        w += (float)((target - w) * (target > w ? 0.35 : 0.2));
        fW[i] = w;
        Now = cls switch { 2 => "breath", 3 => "cough", 4 => "laugh", 0 => "silence", _ => "speech" };
        if (Debug != null && Debug.Length > 4) File.AppendAllText(Debug, $"{f},{r:F1},{fNf[i]:F1},{sl:F1},{fF0[i]:F0},{fFlat[i]:F3},{fCent[i]:F0},{cls},{w:F2},{p[1]:F2},{p[2]:F2}\n");
    }

    // ---- output side ----
    public void PushAi(float[] y, int n, long t0)
    {
        if (aiEnd == long.MinValue) { aiEnd = t0; emitPos = t0; }
        for (int i = 0; i < n; i++) ai[(aiEnd + i) & Mask] = y[i];
        aiEnd += n;
    }

    public float[] Emit()
    {
        long end = Math.Min(aiEnd, Math.Min(dryEnd, decided * 480));
        if (end <= emitPos) return Array.Empty<float>();
        var o = new float[end - emitPos];
        for (long t = emitPos; t < end; t++)
        {
            float a = ai[t & Mask];
            if (t < 0) { o[t - emitPos] = a; continue; }
            long f = t / 480; float fr = (t % 480) / 480f;
            float w0 = f > 0 ? fW[(f - 1) & FMask] : 0, w1 = fW[f & FMask]; float ww = w0 + (w1 - w0) * fr; // interpolate between frame values
            o[t - emitPos] = ww <= 0 ? a : a * (1 - ww) + dry[t & Mask] * ww;
        }
        emitPos = end; ExtraMs = (aiEnd - emitPos) / 48.0;
        return o;
    }
}

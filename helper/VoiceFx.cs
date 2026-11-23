// v2.2 voice chain: high-pass -> echo cancellation (SpeexDSP MDF, reference = what your speakers/headset play)
// -> noise suppression (DeepFilterNet3 on CPU, or RNNoise) . Runs in 10 ms (480 sample) frames at 48 kHz.
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Bsp;

public sealed unsafe class DeepFilter : IDisposable
{
    const string Lib = "df";
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr df_create([MarshalAs(UnmanagedType.LPUTF8Str)] string path, float attenLim, IntPtr logLevel);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern UIntPtr df_get_frame_length(IntPtr st);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void df_set_atten_lim(IntPtr st, float lim);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void df_set_post_filter_beta(IntPtr st, float beta);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern float df_process_frame(IntPtr st, float* input, float* output);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void df_free(IntPtr st);
    IntPtr st; public readonly int Frame;
    public DeepFilter(string modelPath, float attenLim)
    {
        st = df_create(modelPath, attenLim, IntPtr.Zero);
        if (st == IntPtr.Zero) throw new Exception("DeepFilterNet failed to start");
        Frame = (int)df_get_frame_length(st);
    }
    float lim = -1, beta = -1;
    public void SetStrength(double amount)
    {
        // 0..1 -> attenuation limit 6..100 dB (100 = remove everything the model calls noise),
        // plus a light post-filter at the top end for the "nuke it" setting.
        float l = (float)(6 + Math.Clamp(amount, 0, 1) * 94); float b = amount > 0.85 ? 0.02f : 0f;
        if (Math.Abs(l - lim) > 0.5f) { df_set_atten_lim(st, l); lim = l; }
        if (b != beta) { df_set_post_filter_beta(st, b); beta = b; }
    }
    public float Process(float[] inp, float[] outp) { fixed (float* i = inp) fixed (float* o = outp) return df_process_frame(st, i, o); }
    public void Dispose() { if (st != IntPtr.Zero) { df_free(st); st = IntPtr.Zero; } }
}

public sealed unsafe class SpeexAec : IDisposable
{
    const string Lib = "speexdsp";
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr speex_echo_state_init(int frame, int filterLen);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void speex_echo_state_destroy(IntPtr st);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern int speex_echo_ctl(IntPtr st, int req, ref int v);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void speex_echo_cancellation(IntPtr st, short* rec, short* play, short* outp);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void speex_echo_state_reset(IntPtr st);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr speex_preprocess_state_init(int frame, int rate);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void speex_preprocess_state_destroy(IntPtr st);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern int speex_preprocess_ctl(IntPtr st, int req, ref int v);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern int speex_preprocess_ctl(IntPtr st, int req, IntPtr v);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern int speex_preprocess_run(IntPtr st, short* x);
    IntPtr ec, pp; public readonly int Frame, TailMs;
    readonly short[] r = new short[480], p = new short[480], o = new short[480];
    public SpeexAec(int frame, int tailMs, int suppressDb, int suppressActiveDb)
    {
        Frame = frame; TailMs = tailMs;
        ec = speex_echo_state_init(frame, 48 * tailMs);
        int sr = 48000; speex_echo_ctl(ec, 24, ref sr);
        pp = speex_preprocess_state_init(frame, 48000);
        int off = 0; speex_preprocess_ctl(pp, 0, ref off); speex_preprocess_ctl(pp, 2, ref off); speex_preprocess_ctl(pp, 4, ref off); speex_preprocess_ctl(pp, 8, ref off);
        speex_preprocess_ctl(pp, 20, ref suppressDb); speex_preprocess_ctl(pp, 22, ref suppressActiveDb);
        speex_preprocess_ctl(pp, 24, ec);
    }
    public void Process(float[] mic, float[] refm)
    {
        for (int i = 0; i < Frame; i++) { r[i] = S(mic[i]); p[i] = S(refm[i]); }
        fixed (short* rp = r) fixed (short* pp2 = p) fixed (short* op = o) { speex_echo_cancellation(ec, rp, pp2, op); speex_preprocess_run(pp, op); }
        for (int i = 0; i < Frame; i++) mic[i] = o[i] / 32768f;
    }
    static short S(float v) { var x = v * 32767f; return (short)(x > 32767 ? 32767 : x < -32768 ? -32768 : x); }
    public void Reset() => speex_echo_state_reset(ec);
    public void Dispose() { if (ec != IntPtr.Zero) { speex_preprocess_state_destroy(pp); speex_echo_state_destroy(ec); ec = pp = IntPtr.Zero; } }
}

static class Fft
{
    // in-place radix-2 complex FFT; inverse when inv = true (unscaled)
    public static void Run(double[] re, double[] im, bool inv)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            int bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit;
            if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); }
        }
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = 2 * Math.PI / len * (inv ? 1 : -1); double wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++)
                {
                    int a = i + k, b = a + len / 2;
                    double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    double ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }
}

// Finds how far the echo lags behind the reference (speaker playback -> VR headset/stream -> room -> mic),
// with GCC-PHAT on 12 kHz copies of both signals over the last ~1.4 s. Runs off the audio thread.
public sealed class DelayEstimator
{
    const int Dec = 4, N = 16384; // 12 kHz, 1.36 s window
    readonly float[] mic = new float[N], refb = new float[N]; int w; long fed; double accM, accR; int decPhase;
    public int MaxLagMs = 500;
    public volatile int DelaySamples = -1; public volatile float Confidence; int candidate = -1, candHits;
    Task job; long lastRun;
    public void Push(float[] m, float[] r, int n, bool refActive)
    {
        for (int i = 0; i < n; i++)
        {
            accM += m[i]; accR += r[i];
            if (++decPhase == Dec) { mic[w] = (float)(accM / Dec); refb[w] = (float)(accR / Dec); w = (w + 1) % N; accM = accR = 0; decPhase = 0; }
        }
        fed += n;
        if (refActive && fed - lastRun > 24000 && fed > N * Dec && (job == null || job.IsCompleted))
        {
            lastRun = fed;
            var a = new float[N]; var b = new float[N]; int ww = w;
            for (int i = 0; i < N; i++) { a[i] = mic[(ww + i) % N]; b[i] = refb[(ww + i) % N]; }
            job = Task.Run(() => Estimate(a, b));
        }
    }
    void Estimate(float[] m, float[] r)
    {
        int n2 = N * 2;
        var mr = new double[n2]; var mi = new double[n2]; var rr = new double[n2]; var ri = new double[n2];
        double em = 0, er = 0;
        for (int i = 0; i < N; i++) { double h = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (N - 1)); mr[i] = m[i] * h; rr[i] = r[i] * h; em += m[i] * m[i]; er += r[i] * r[i]; }
        if (er / N < 1e-7 || em / N < 1e-10) return;
        Fft.Run(mr, mi, false); Fft.Run(rr, ri, false);
        double binHz = 12000.0 / n2;
        for (int k = 0; k < n2; k++)
        {
            double f = (k <= n2 / 2 ? k : n2 - k) * binHz;
            double xr = mr[k] * rr[k] + mi[k] * ri[k], xi = mi[k] * rr[k] - mr[k] * ri[k]; // M * conj(R)
            double mag = Math.Sqrt(xr * xr + xi * xi) + 1e-12;
            double wgt = f < 150 || f > 5000 ? 0 : 1 / mag;
            mr[k] = xr * wgt; mi[k] = xi * wgt;
        }
        Fft.Run(mr, mi, true);
        int maxLag = MaxLagMs * 12; double best = 0, sum = 0; int bi = 0;
        for (int l = 0; l <= maxLag; l++) { double v = Math.Abs(mr[l]); sum += v; if (v > best) { best = v; bi = l; } }
        double mean = sum / (maxLag + 1); float conf = (float)(best / (mean + 1e-12));
        Confidence = conf;
        if (conf < 6) return;
        int d = bi * Dec;
        if (candidate >= 0 && Math.Abs(d - candidate) <= 96) candHits++; else { candidate = d; candHits = 1; }
        if (DelaySamples < 0 ? candHits >= 1 && conf > 9 || candHits >= 2 : candHits >= 2 && Math.Abs(d - DelaySamples) > 96) DelaySamples = d;
    }
}

// Echo canceller: delay-aligned reference -> SpeexDSP MDF (linear) -> Speex residual-echo suppressor
// -> double-talk-aware nonlinear suppression. Strength: 0 = Mild, 1 = Strong, 2 = Max.
public sealed class EchoCanceller : IDisposable
{
    public const int Frame = 480;
    static readonly (int tail, int sup, int supAct, double nlpDb, double dtRatio, double dtDb)[] Modes =
    {
        (150, -25, -10, -10, 4.0, 0),   // Mild   (dtRatio = how far above the predicted echo your voice must be)
        (200, -45, -20, -28, 2.5, -2),  // Strong
        (250, -65, -35, -45, 1.8, -5),  // Max
    };
    public readonly int Strength;
    readonly SpeexAec lin; readonly DelayEstimator est = new();
    readonly float[] hist = new float[48000 * 1]; int hw; // reference history (1 s)
    readonly float[] dref = new float[Frame], raw = new float[Frame];
    int appliedDelay = 0; public int FixedDelayMs = -1;
    double gp = 1.0, nf = 1e-6, g = 1, sMic = 1e-9, sRef = 1e-9; int nearHold;
    public bool RefActive, NearTalk; public double CutDb, DelayMs, Conf;
    public EchoCanceller(int strength)
    {
        Strength = Math.Clamp(strength, 0, 2); var m = Modes[Strength];
        lin = new SpeexAec(Frame, m.tail, m.sup, m.supAct);
    }
    static double E(float[] a) { double s = 0; for (int i = 0; i < a.Length; i++) s += a[i] * a[i]; return s / a.Length + 1e-12; }
    public void Process(float[] mic, float[] refm)
    {
        var m = Modes[Strength];
        for (int i = 0; i < Frame; i++) { hist[hw] = refm[i]; hw = (hw + 1) % hist.Length; }
        double eRefNow = E(refm);
        est.Push(mic, refm, Frame, eRefNow > 1e-7);
        int want = FixedDelayMs >= 0 ? FixedDelayMs * 48 : est.DelaySamples;
        if (want >= 0)
        {
            int target = Math.Max(0, want - 48 * 12); // keep ~12 ms of the echo path inside the adaptive filter
            if (Math.Abs(target - appliedDelay) > 48 * 4) { appliedDelay = target; lin.Reset(); }
        }
        DelayMs = (appliedDelay + 48 * 12) / 48.0; Conf = est.Confidence;
        int start = hw - Frame - appliedDelay; while (start < 0) start += hist.Length;
        for (int i = 0; i < Frame; i++) dref[i] = hist[(start + i) % hist.Length];
        Array.Copy(mic, raw, Frame);
        double eMic = E(mic), eRef = E(dref);
        lin.Process(mic, dref);
        double eOut = E(mic);
        // ---- double talk detection + nonlinear suppression ----
        // gp tracks the echo path gain (mic energy / reference energy) as a lower envelope: echo-only frames pull it
        // down quickly, it creeps up ~1 dB/s otherwise, so it can never lock up. You are "talking over" the echo when
        // the mic is well above both the predicted echo and the room noise.
        nf = Math.Max(1e-9, eMic < nf ? eMic : nf * 1.0015); // slow-rising noise floor (never below -90 dBFS)
        sMic += (eMic - sMic) * 0.25; sRef += (Math.Max(eRef, eRefNow) - sRef) * 0.25; // ~40 ms smoothing absorbs delay/reverb smear
        bool far = sRef > 3e-7;
        if (far) { double r = Math.Max(sMic - nf, 1e-12) / sRef; gp = r < gp ? 0.9 * gp + 0.1 * r : gp * 1.003; gp = Math.Clamp(gp, 1e-7, 10); }
        double predicted = gp * sRef;
        bool near = sMic > 4 * nf && (!far || sMic > m.dtRatio * predicted + 3 * nf);
        if (near) nearHold = 15; else if (nearHold > 0) nearHold--;
        bool nearNow = nearHold > 0;
        double target2 = !far ? 1 : nearNow ? Db.ToLin(m.dtDb) : Db.ToLin(m.nlpDb);
        for (int i = 0; i < Frame; i++)
        {
            g += (target2 - g) * (target2 > g ? 0.05 : 0.004); // open in ~0.5 ms, close over ~5 ms
            mic[i] = (float)(mic[i] * g);
        }
        RefActive = far; NearTalk = nearNow;
        if (far && !nearNow) CutDb = CutDb * 0.95 + 0.05 * Math.Max(0, Db.ToDb(Math.Sqrt(eMic / (E(mic)))));
    }
    public void Reset() { lin.Reset(); Array.Clear(hist); }
    public void Dispose() => lin.Dispose();
}

public sealed class VoiceChain : IDisposable
{
    public const int Frame = 480;
    // settings (written by Engine.Configure)
    public bool HpfOn = true; public double HpfFreq = 90;
    public bool AecOn; public int AecStrength = 1; public int AecFixedDelayMs = -1;
    public bool NsOn = true; public string NsEngine = "deep"; public double NsAmount = 0.9; public bool ClearCast;
    public string ModelPath;
    // live stats
    public string NsActive = "off"; public string NsError; public float Lsnr; public double NsCutDb, AecCutDb, CpuMs, AecDelayMs; public bool RefActive, NearTalk;
    public float Vad => Math.Clamp((Lsnr + 5) / 25f, 0, 1);

    readonly Biquad hp1 = new(), hp2 = new(); double hpSet = -1;
    DeepFilter df; Task dfLoading; string dfPath;
    RnNoise rn; double rnVad = 1;
    EchoCanceller aec;
    public FloatRing Reference; // 48k stereo loopback of what you hear
    public Func<float[], int> RefFeed; // test harness: supplies exactly one frame of stereo reference
    readonly float[] fin = new float[Frame], fwork = new float[Frame], fout = new float[Frame], refm = new float[Frame], refSt = new float[Frame * 2];
    int inCount; readonly Queue<float> outQ = new();
    double ccGain = 1; readonly Stopwatch sw = new();

    void Ensure()
    {
        if (HpfFreq != hpSet) { hp1.Set("lowcut", HpfFreq, 0, 0.54); hp2.Set("lowcut", HpfFreq, 0, 1.31); hpSet = HpfFreq; } // 4th-order Butterworth
        if (NsOn && NsEngine == "deep" && df == null && dfLoading == null && !string.IsNullOrEmpty(ModelPath) && File.Exists(ModelPath))
        {
            dfPath = ModelPath;
            dfLoading = Task.Run(() => { try { df = new DeepFilter(dfPath, 100); NsError = null; } catch (Exception e) { NsError = "DeepFilterNet: " + e.Message; } });
        }
        if (NsOn && NsEngine == "deep" && string.IsNullOrEmpty(NsError) && !string.IsNullOrEmpty(ModelPath) && !File.Exists(ModelPath)) NsError = "DeepFilterNet model missing";
        bool needRn = NsOn && (NsEngine == "rnnoise" || df == null);
        if (needRn && rn == null) { rn = new RnNoise(); if (!rn.Ok) NsError = RnNoise.LoadError ?? "rnnoise.dll failed"; }
        if (AecOn && (aec == null || aec.Strength != AecStrength)) { aec?.Dispose(); try { aec = new EchoCanceller(AecStrength); } catch (Exception e) { aec = null; AecOn = false; NsError = "AEC: " + e.Message; } }
        if (aec != null) aec.FixedDelayMs = AecFixedDelayMs;
    }

    // Process n mono samples in place. Adds one 10 ms frame of buffering (+ DeepFilterNet's own ~20 ms look-ahead).
    public void Process(float[] mono, int n)
    {
        Ensure();
        for (int i = 0; i < n; i++)
        {
            fin[inCount++] = mono[i];
            if (inCount == Frame) { RunFrame(); inCount = 0; }
        }
        for (int i = 0; i < n; i++) mono[i] = outQ.Count > 0 ? outQ.Dequeue() : 0f;
        while (outQ.Count > Frame * 8) outQ.Dequeue(); // never let latency creep
    }

    static double Rms(float[] a) { double s = 0; for (int i = 0; i < a.Length; i++) s += a[i] * a[i]; return Math.Sqrt(s / a.Length) + 1e-9; }

    void RunFrame()
    {
        sw.Restart();
        Array.Copy(fin, fwork, Frame);
        if (HpfOn) for (int i = 0; i < Frame; i++) fwork[i] = hp2.Process(hp1.Process(fwork[i], 0), 0);
        // ----- echo cancellation -----
        RefActive = false; NearTalk = false;
        if (AecOn && aec != null && (Reference != null || RefFeed != null))
        {
            int got;
            if (RefFeed != null) { got = RefFeed(refSt); }
            else got = Reference.Read(refSt, Frame * 2, Frame * 2 * 4); // <= 40 ms backlog; the delay estimator measures whatever offset remains
            for (int i = 0; i < Frame; i++) refm[i] = (refSt[i * 2] + refSt[i * 2 + 1]) * 0.5f;
            aec.Process(fwork, refm);
            RefActive = aec.RefActive; NearTalk = aec.NearTalk; AecCutDb = aec.CutDb; AecDelayMs = aec.DelayMs;
        }
        // ----- noise suppression -----
        double nsIn = Rms(fwork);
        if (NsOn && NsEngine == "deep" && df != null)
        {
            df.SetStrength(NsAmount);
            Lsnr = df.Process(fwork, fout);
            NsActive = "DeepFilterNet3";
            if (ClearCast)
            {
                double target = Lsnr > 10 ? 1 : Lsnr > 2 ? 0.5 : 0.04;
                for (int i = 0; i < Frame; i++) { ccGain += (target - ccGain) * (target > ccGain ? 0.02 : 0.002); fout[i] = (float)(fout[i] * ccGain); }
            }
        }
        else if (NsOn && rn != null && rn.Ok)
        {
            Array.Copy(fwork, fout, Frame);
            rn.Process(fout, Frame, NsAmount, ClearCast, ref rnVad);
            Lsnr = rn.LastVad * 30 - 5; NsActive = "RNNoise";
        }
        else { Array.Copy(fwork, fout, Frame); NsActive = "off"; Lsnr = 30; }
        NsCutDb = NsCutDb * 0.95 + 0.05 * Math.Max(0, Db.ToDb(nsIn / Rms(fout)));
        for (int i = 0; i < Frame; i++) outQ.Enqueue(fout[i]);
        CpuMs = CpuMs * 0.95 + 0.05 * sw.Elapsed.TotalMilliseconds;
    }

    public void Dispose() { try { dfLoading?.Wait(3000); } catch { } df?.Dispose(); df = null; rn?.Dispose(); rn = null; aec?.Dispose(); aec = null; }
}

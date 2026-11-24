// DSP building blocks for the Blur Sounds Pro engine. All processing is 48 kHz float.
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Bsp;

public static class Db
{
    public static float ToLin(double db) => (float)Math.Pow(10, db / 20.0);
    public static double ToDb(double lin) => 20 * Math.Log10(Math.Max(lin, 1e-9));
}

// RBJ biquad (Direct Form I), per channel state.
public sealed class Biquad
{
    double b0, b1, b2, a1, a2;
    readonly double[] x1 = new double[2], x2 = new double[2], y1 = new double[2], y2 = new double[2];
    public void Set(string type, double f, double gainDb, double q, double fs = 48000)
    {
        f = Math.Clamp(f, 10, fs * 0.45); q = Math.Max(0.1, q);
        double A = Math.Pow(10, gainDb / 40), w = 2 * Math.PI * f / fs, cs = Math.Cos(w), sn = Math.Sin(w), al = sn / (2 * q);
        double B0, B1, B2, A0, A1, A2;
        switch (type)
        {
            case "lowshelf":
            {
                double s = 2 * Math.Sqrt(A) * al;
                B0 = A * ((A + 1) - (A - 1) * cs + s); B1 = 2 * A * ((A - 1) - (A + 1) * cs); B2 = A * ((A + 1) - (A - 1) * cs - s);
                A0 = (A + 1) + (A - 1) * cs + s; A1 = -2 * ((A - 1) + (A + 1) * cs); A2 = (A + 1) + (A - 1) * cs - s; break;
            }
            case "highshelf":
            {
                double s = 2 * Math.Sqrt(A) * al;
                B0 = A * ((A + 1) + (A - 1) * cs + s); B1 = -2 * A * ((A - 1) + (A + 1) * cs); B2 = A * ((A + 1) + (A - 1) * cs - s);
                A0 = (A + 1) - (A - 1) * cs + s; A1 = 2 * ((A - 1) - (A + 1) * cs); A2 = (A + 1) - (A - 1) * cs - s; break;
            }
            case "lowcut": // high-pass
                B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = (1 + cs) / 2; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; break;
            case "highcut": // low-pass
                B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = (1 - cs) / 2; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; break;
            default: // peaking
                B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A; break;
        }
        b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
    }
    public float Process(float x, int ch)
    {
        double y = b0 * x + b1 * x1[ch] + b2 * x2[ch] - a1 * y1[ch] - a2 * y2[ch];
        x2[ch] = x1[ch]; x1[ch] = x; y2[ch] = y1[ch]; y1[ch] = y;
        return (float)y;
    }
}

public sealed class Equalizer
{
    Biquad[] bands = Array.Empty<Biquad>();
    public bool Enabled;
    float pre = 1f;
    string sig = "";
    public void Configure(JsonNode eq)
    {
        if (eq == null) { Enabled = false; return; }
        var s = eq.ToJsonString(); if (s == sig) return; sig = s;
        Enabled = (bool?)eq["enabled"] ?? false;
        pre = Db.ToLin((double?)eq["preampDb"] ?? 0);
        var list = new List<Biquad>();
        if (eq["bands"] is JsonArray arr)
            foreach (var b in arr)
            {
                if (b == null || ((bool?)b["on"] ?? true) == false) continue;
                var bq = new Biquad();
                bq.Set((string)b["type"] ?? "peak", (double?)b["f"] ?? 1000, (double?)b["g"] ?? 0, (double?)b["q"] ?? 0.9);
                list.Add(bq);
            }
        bands = list.ToArray();
    }
    // interleaved buffer, `channels` = 1 or 2
    public void Process(float[] buf, int frames, int channels)
    {
        if (!Enabled) return;
        var bs = bands;
        for (int i = 0; i < frames; i++)
            for (int c = 0; c < channels; c++)
            {
                float v = buf[i * channels + c] * pre;
                for (int k = 0; k < bs.Length; k++) v = bs[k].Process(v, c);
                buf[i * channels + c] = v;
            }
    }
}

public sealed class NoiseGate
{
    public bool Enabled; public double ThresholdDb = -45, AttackMs = 2, HoldMs = 150, ReleaseMs = 120, RangeDb = -60;
    double env, gain = 1, holdLeft;
    public bool Open => gain > 0.5;
    public void Process(float[] mono, int n, int fs = 48000)
    {
        if (!Enabled) { gain = 1; return; }
        double thr = Db.ToLin(ThresholdDb), floor = Db.ToLin(RangeDb);
        double aEnv = Math.Exp(-1.0 / (0.005 * fs));
        double aAtk = Math.Exp(-1.0 / (Math.Max(0.1, AttackMs) / 1000 * fs)), aRel = Math.Exp(-1.0 / (Math.Max(1, ReleaseMs) / 1000 * fs));
        int hold = (int)(HoldMs / 1000 * fs);
        for (int i = 0; i < n; i++)
        {
            double x = Math.Abs(mono[i]);
            env = x > env ? x : aEnv * env + (1 - aEnv) * x;
            double target;
            if (env >= thr) { target = 1; holdLeft = hold; }
            else if (holdLeft > 0) { target = 1; holdLeft--; }
            else target = floor;
            gain = target > gain ? aAtk * gain + (1 - aAtk) * target : aRel * gain + (1 - aRel) * target;
            mono[i] = (float)(mono[i] * gain);
        }
    }
}

public sealed class Compressor
{
    public bool Enabled; public double ThresholdDb = -18, Ratio = 3, AttackMs = 5, ReleaseMs = 120, MakeupDb = 4, KneeDb = 6;
    double envDb = -120;
    public double GainReductionDb { get; private set; }
    public void Process(float[] mono, int n, int fs = 48000)
    {
        if (!Enabled) { GainReductionDb = 0; return; }
        double aA = Math.Exp(-1.0 / (Math.Max(0.1, AttackMs) / 1000 * fs)), aR = Math.Exp(-1.0 / (Math.Max(1, ReleaseMs) / 1000 * fs));
        double mk = Db.ToLin(MakeupDb), maxGr = 0;
        for (int i = 0; i < n; i++)
        {
            double xDb = Db.ToDb(Math.Abs(mono[i]));
            envDb = xDb > envDb ? aA * envDb + (1 - aA) * xDb : aR * envDb + (1 - aR) * xDb;
            double over = envDb - ThresholdDb, gr;
            if (over <= -KneeDb / 2) gr = 0;
            else if (over >= KneeDb / 2) gr = over - over / Ratio;
            else { double k = over + KneeDb / 2; gr = (1 - 1 / Ratio) * k * k / (2 * KneeDb); }
            if (gr > maxGr) maxGr = gr;
            mono[i] = (float)(mono[i] * Db.ToLin(-gr) * mk);
        }
        GainReductionDb = maxGr;
    }
}

public sealed class Limiter
{
    double g = 1;
    public void Process(float[] buf, int count)
    {
        const double ceil = 0.98; double rel = 0.0005;
        for (int i = 0; i < count; i++)
        {
            double a = Math.Abs(buf[i]) * g;
            if (a > ceil) g = ceil / Math.Abs(buf[i]);
            else g = Math.Min(1, g + rel);
            buf[i] = (float)(buf[i] * g);
        }
    }
}

// RNNoise (xiph, v0.2) bundled as rnnoise.dll. 480-sample frames at 48 kHz, int16-scaled floats.
public sealed class RnNoise : IDisposable
{
    const string Lib = "rnnoise";
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr rnnoise_create(IntPtr model);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void rnnoise_destroy(IntPtr st);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern unsafe float rnnoise_process_frame(IntPtr st, float* outp, float* inp);
    public const int Frame = 480;
    IntPtr st;
    readonly float[] inQ = new float[Frame * 4]; int inCount;
    readonly Queue<float> outQ = new();
    readonly float[] fin = new float[Frame], fout = new float[Frame];
    public float LastVad { get; private set; }
    public static string LoadError;
    public RnNoise() { try { st = rnnoise_create(IntPtr.Zero); } catch (Exception e) { LoadError = e.Message; st = IntPtr.Zero; } }
    public bool Ok => st != IntPtr.Zero;
    // amount 0..1 = wet mix; clearcast = VAD-gated extra attenuation of non-speech frames.
    public unsafe void Process(float[] mono, int n, double amount, bool clearcast, ref double vadGain)
    {
        if (!Ok) return;
        // Simple FIFO: push n samples, pull n samples (adds one frame of latency = 10 ms).
        for (int i = 0; i < n; i++)
        {
            fin[inCount++] = mono[i];
            if (inCount == Frame)
            {
                for (int k = 0; k < Frame; k++) fout[k] = fin[k] * 32768f;
                float vad;
                fixed (float* o = fout) fixed (float* ip = fout) vad = rnnoise_process_frame(st, o, ip);
                LastVad = vad;
                double target = clearcast ? (vad > 0.6 ? 1.0 : vad > 0.3 ? 0.5 : 0.03) : 1.0;
                for (int k = 0; k < Frame; k++)
                {
                    vadGain += (target - vadGain) * (target > vadGain ? 0.02 : 0.002);
                    float wet = fout[k] / 32768f;
                    outQ.Enqueue((float)((wet * amount + fin[k] * (1 - amount)) * vadGain));
                }
                inCount = 0;
            }
        }
        for (int i = 0; i < n; i++) mono[i] = outQ.Count > 0 ? outQ.Dequeue() : 0f;
    }
    public void Dispose() { if (st != IntPtr.Zero) { rnnoise_destroy(st); st = IntPtr.Zero; } }
}

// Streaming linear resampler + channel mapper -> 48 kHz stereo float.
public sealed class Resampler
{
    readonly int inRate; double pos; float lastL, lastR; bool primed;
    public Resampler(int inRate) { this.inRate = inRate; }
    // input interleaved with `ch` channels, writes stereo frames into ring
    public void Push(float[] input, int frames, int ch, FloatRing ring)
    {
        if (frames <= 0) return;
        float L(int i) => input[i * ch];
        float R(int i) => ch > 1 ? input[i * ch + 1] : input[i * ch];
        if (inRate == 48000)
        {
            var tmp = new float[frames * 2];
            for (int i = 0; i < frames; i++) { tmp[i * 2] = L(i); tmp[i * 2 + 1] = R(i); }
            ring.Write(tmp, frames * 2); return;
        }
        double step = inRate / 48000.0;
        var outBuf = new List<float>((int)(frames / step) * 2 + 8);
        if (!primed) { lastL = L(0); lastR = R(0); primed = true; }
        // pos is relative to previous sample (lastL) at -1
        while (true)
        {
            double p = pos; int i0 = (int)Math.Floor(p); double fr = p - i0;
            if (i0 + 1 > frames - 1) break;
            float aL = i0 < 0 ? lastL : L(i0), aR = i0 < 0 ? lastR : R(i0);
            float bL = L(i0 + 1), bR = R(i0 + 1);
            outBuf.Add((float)(aL + (bL - aL) * fr)); outBuf.Add((float)(aR + (bR - aR) * fr));
            pos += step;
        }
        pos -= frames; lastL = L(frames - 1); lastR = R(frames - 1);
        var arr = outBuf.ToArray(); ring.Write(arr, arr.Length);
    }
}

// 48 kHz stereo -> any device rate / channel count (linear interpolation, phase kept across blocks).
public sealed class RateOut
{
    readonly int rate, chans; float[] buf = new float[0]; double pos; float lastL, lastR;
    public RateOut(int rate, int chans) { this.rate = rate; this.chans = chans; }
    public int Convert(float[] stereo, int count, out float[] dst)
    {
        int inFrames = count / 2; double step = 48000.0 / rate;
        int outFrames = (int)Math.Ceiling((inFrames - pos) / step) + 1; int need = outFrames * chans;
        if (buf.Length < need) buf = new float[need];
        int o = 0;
        for (; pos < inFrames; pos += step)
        {
            int i0 = (int)pos; double f = pos - i0;
            float l0 = i0 == 0 ? lastL : stereo[(i0 - 1) * 2], r0 = i0 == 0 ? lastR : stereo[(i0 - 1) * 2 + 1];
            float l1 = stereo[i0 * 2], r1 = stereo[i0 * 2 + 1];
            float l = (float)(l0 + (l1 - l0) * f), r = (float)(r0 + (r1 - r0) * f);
            if (chans == 1) buf[o++] = (l + r) * 0.5f;
            else { buf[o++] = l; buf[o++] = r; for (int k = 2; k < chans; k++) buf[o++] = 0; }
        }
        pos -= inFrames; if (inFrames > 0) { lastL = stereo[(inFrames - 1) * 2]; lastR = stereo[(inFrames - 1) * 2 + 1]; }
        dst = buf; return o;
    }
}

// v2.4.1 pitch check: a 440 Hz tone at any device rate in -> 48 kHz engine -> any device rate out must stay 440 Hz.
public static class PitchCheck
{
    // Frequency from rising zero crossings with sub-sample interpolation; skips the first 0.1 s.
    public static double Freq(float[] x, int n, int stride, int fs)
    {
        int skip = fs / 10 * stride; double first = -1, last = -1; int crossings = 0;
        for (int i = skip + stride; i < n; i += stride)
        {
            float a = x[i - stride], b = x[i];
            if (a < 0 && b >= 0) { double t = (i / stride - 1) + a / (a - b); if (first < 0) first = t; else { last = t; crossings++; } }
        }
        return crossings > 0 ? crossings * fs / (last - first) : 0;
    }
    public static string Run()
    {
        var sb = new System.Text.StringBuilder(); bool ok = true;
        foreach (int inRate in new[] { 44100, 48000, 96000, 16000 })
            foreach (int inCh in new[] { 1, 2 })
                foreach (int outRate in new[] { 44100, 48000, 96000 })
                {
                    int secs = 2; int frames = inRate * secs; var src = new float[frames * inCh];
                    for (int i = 0; i < frames; i++) for (int c = 0; c < inCh; c++) src[i * inCh + c] = (float)(0.5 * Math.Sin(2 * Math.PI * 440 * i / inRate));
                    // capture side: arbitrary-sized blocks like WASAPI delivers
                    var ring = new FloatRing(48000 * 2 * 4); var rs = new Resampler(inRate); int blk = inRate / 100 + 7;
                    var mid = new List<float>();
                    var tmp = new float[48000 * 2 * 4];
                    for (int p = 0; p < frames; p += blk)
                    {
                        int nf = Math.Min(blk, frames - p); var part = new float[nf * inCh]; Array.Copy(src, p * inCh, part, 0, nf * inCh);
                        rs.Push(part, nf, inCh, ring); int got = ring.Count; ring.Read(tmp, got, 48000 * 8); for (int k = 0; k < got; k++) mid.Add(tmp[k]);
                    }
                    var m = mid.ToArray(); double fMid = Freq(m, m.Length, 2, 48000);
                    // render side: engine blocks of 480 frames -> device rate
                    var ro = new RateOut(outRate, 2); var outL = new List<float>();
                    for (int p = 0; p + 960 <= m.Length; p += 960) { var blkS = new float[960]; Array.Copy(m, p, blkS, 0, 960); int n = ro.Convert(blkS, 960, out var d); for (int k = 0; k < n; k++) outL.Add(d[k]); }
                    var oa = outL.ToArray(); double fOut = Freq(oa, oa.Length, 2, outRate);
                    double cents = 1200 * Math.Log2(fOut / 440.0); bool pass = Math.Abs(cents) < 5 && Math.Abs(1200 * Math.Log2(fMid / 440.0)) < 5;
                    ok &= pass; sb.AppendLine($"{(pass ? "PASS" : "FAIL")} in {inRate} Hz/{inCh}ch -> engine 48 kHz {fMid:F2} Hz -> out {outRate} Hz {fOut:F2} Hz ({cents:+0.00;-0.00;0.00} cents)");
                }
        // what an unmatched Hi-Fi Cable does (no converter inside): samples written at one rate are read at another
        foreach (var (w, r) in new[] { (48000, 44100), (44100, 48000), (96000, 48000) })
            sb.AppendLine($"INFO Hi-Fi Cable written at {w} Hz but read at {r} Hz: 440 Hz arrives as {440.0 * r / w:F1} Hz ({1200 * Math.Log2((double)r / w):+0;-0} cents{(r < w ? ", deeper voice" : ", higher voice")})");
        sb.AppendLine(ok ? "ALL PITCH CHECKS PASSED" : "PITCH CHECK FAILED");
        return sb.ToString();
    }
}

// Thread-safe float ring with drift control.
public sealed class FloatRing
{
    readonly float[] buf; int r, w, count; readonly object l = new();
    public FloatRing(int capacity) { buf = new float[capacity]; }
    public int Count { get { lock (l) return count; } }
    public void Write(float[] src, int n)
    {
        lock (l)
        {
            for (int i = 0; i < n; i++)
            {
                buf[w] = src[i]; w = (w + 1) % buf.Length;
                if (count == buf.Length) r = (r + 1) % buf.Length; else count++;
            }
        }
    }
    // Reads exactly n values, zero-padding on underrun. Drops backlog above maxBacklog.
    public int Read(float[] dst, int n, int maxBacklog)
    {
        lock (l)
        {
            if (count > maxBacklog + n) { int drop = count - (maxBacklog / 2 + n); drop -= drop % 2; r = (r + drop) % buf.Length; count -= drop; }
            int got = Math.Min(n, count);
            for (int i = 0; i < got; i++) { dst[i] = buf[r]; r = (r + 1) % buf.Length; }
            count -= got;
            for (int i = got; i < n; i++) dst[i] = 0;
            return got;
        }
    }
    public void Clear() { lock (l) { r = w = count = 0; } }
}

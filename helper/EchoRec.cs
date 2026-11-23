// Diagnostic: play a test file into one output while recording that output's loopback plus one or more mics.
// BspAudioHelper.exe --echorec <outDir> <renderId> <play.wav> <micId> [<micId2> ...]
using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Bsp;

static class EchoRec
{
    public static int Run(string[] a)
    {
        string dir = a[1], renderId = a[2], play = a[3];
        Directory.CreateDirectory(dir);
        var en = new MMDeviceEnumerator();
        var sw = Stopwatch.StartNew();
        var caps = new List<(IWaveIn cap, WaveFileWriter w, string name)>();
        var starts = new Dictionary<string, double>();
        void Add(IWaveIn cap, string name)
        {
            var w = new WaveFileWriter(Path.Combine(dir, name + ".wav"), cap.WaveFormat);
            cap.DataAvailable += (s, e) => { lock (w) { if (!starts.ContainsKey(name)) starts[name] = sw.Elapsed.TotalMilliseconds - 1000.0 * e.BytesRecorded / cap.WaveFormat.AverageBytesPerSecond; w.Write(e.Buffer, 0, e.BytesRecorded); } };
            caps.Add((cap, w, name));
        }
        var render = en.GetDevice(renderId);
        Add(new WasapiLoopbackCapture(render), "ref");
        for (int i = 4; i < a.Length; i++) Add(new WasapiCapture(en.GetDevice(a[i]), true, 20), "mic" + (i - 3));
        foreach (var c in caps) c.cap.StartRecording();
        Thread.Sleep(800);
        using (var rd = new WaveFileReader(play))
        using (var wo = new WasapiOut(render, AudioClientShareMode.Shared, true, 30))
        {
            wo.Init(rd); double t0 = sw.Elapsed.TotalMilliseconds; wo.Play();
            while (wo.PlaybackState == PlaybackState.Playing) Thread.Sleep(20);
            starts["play"] = t0;
        }
        Thread.Sleep(1200);
        foreach (var c in caps) { c.cap.StopRecording(); }
        Thread.Sleep(300);
        foreach (var c in caps) { lock (c.w) c.w.Dispose(); c.cap.Dispose(); }
        foreach (var kv in starts) Console.WriteLine($"{kv.Key} {kv.Value:F1}");
        foreach (var c in caps) Console.WriteLine($"fmt {c.name} {c.cap.WaveFormat}");
        return 0;
    }
}

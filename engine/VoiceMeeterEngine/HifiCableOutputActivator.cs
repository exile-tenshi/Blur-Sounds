using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// VB-Audio Hi-Fi Cable only loops Input → Output while a client has the recording
/// endpoint open. Keep a shared-mode capture session alive on Hi-Fi Cable Output so
/// other apps listening on that endpoint receive the mix.
/// </summary>
internal sealed class HifiCableOutputActivator : IDisposable
{
    private readonly object gate = new();
    private MicWasapiCapture? capture;
    private string? lastError;

    public bool IsActive
    {
        get
        {
            lock (gate)
            {
                return capture is not null &&
                       capture.CaptureState is CaptureState.Capturing or CaptureState.Starting;
            }
        }
    }

    public string? LastError
    {
        get
        {
            lock (gate)
            {
                return lastError;
            }
        }
    }

    public void Start()
    {
        Stop();

        using var enumerator = new MMDeviceEnumerator();
        var recording = FindRecordingEndpoint(enumerator);
        if (recording is null)
        {
            lock (gate)
            {
                lastError =
                    "Hi-Fi Cable Output was not found or is disabled. Enable it under Windows Sound → Recording.";
            }

            return;
        }

        // Prefer the device MixFormat rate so the keep-alive client matches the cable.
        // MicWasapiCapture still falls back to auto-convert / native float if needed.
        var targetSampleRate = ResolvePreferredSampleRate(recording);

        try
        {
            // Keep-alive capture can use a slightly larger period than live mics;
            // stability matters more than latency for the VB-Audio loop gate.
            var candidate = MicWasapiCapture.Create(
                recording,
                Math.Max(40, LatencyTuning.HiFiMicCaptureBufferMilliseconds),
                targetSampleRate);
            candidate.DataAvailable += OnDataAvailable;
            candidate.RecordingStopped += OnRecordingStopped;
            candidate.StartRecording();

            var deadline = DateTime.UtcNow.AddMilliseconds(250);
            while (DateTime.UtcNow < deadline &&
                   candidate.CaptureState is CaptureState.Starting)
            {
                Thread.Sleep(10);
            }

            if (candidate.CaptureState is not (CaptureState.Capturing or CaptureState.Starting))
            {
                var state = candidate.CaptureState;
                TearDownCandidate(candidate);
                lock (gate)
                {
                    lastError =
                        $"Hi-Fi Cable Output keep-alive capture failed to start (state {state}). " +
                        "Check Windows Sound → Recording → Hi-Fi Cable Output is Enabled and not Exclusive-only.";
                }

                return;
            }

            lock (gate)
            {
                capture = candidate;
                lastError = null;
            }
        }
        catch (Exception ex)
        {
            lock (gate)
            {
                capture = null;
                lastError =
                    $"Unable to open Hi-Fi Cable Output: {ex.Message}. " +
                    "Enable the recording endpoint and set it to the same format as Hi-Fi Cable Input (48 kHz · 24-bit).";
            }
        }
    }

    public void Stop()
    {
        MicWasapiCapture? previous;
        lock (gate)
        {
            previous = capture;
            capture = null;
        }

        if (previous is null)
        {
            return;
        }

        TearDownCandidate(previous);
    }

    public void Dispose()
    {
        Stop();
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs args)
    {
        lock (gate)
        {
            if (!ReferenceEquals(capture, sender))
            {
                return;
            }

            capture = null;
            lastError = args.Exception is null
                ? "Hi-Fi Cable Output keep-alive capture stopped unexpectedly."
                : $"Hi-Fi Cable Output keep-alive capture stopped: {args.Exception.Message}";
        }
    }

    private static void OnDataAvailable(object? sender, WaveInEventArgs args)
    {
        // Discard samples; this client only keeps the virtual cable output path open.
    }

    private void TearDownCandidate(MicWasapiCapture candidate)
    {
        candidate.DataAvailable -= OnDataAvailable;
        candidate.RecordingStopped -= OnRecordingStopped;
        try
        {
            candidate.StopRecording();
        }
        catch
        {
            // Ignore cleanup failures.
        }

        candidate.Dispose();
    }

    private static int ResolvePreferredSampleRate(MMDevice recording)
    {
        try
        {
            var nativeRate = recording.AudioClient.MixFormat.SampleRate;
            if (nativeRate is HifiStreamingPolicy.EngineMixSampleRate
                or HifiStreamingPolicy.DeviceSampleRate
                or > 0)
            {
                return nativeRate;
            }
        }
        catch
        {
            // MixFormat can be unavailable while another client holds exclusive mode.
        }

        return HifiStreamingPolicy.EngineMixSampleRate;
    }

    private static MMDevice? FindRecordingEndpoint(MMDeviceEnumerator enumerator)
    {
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            if (!HifiCableFormat.IsHifiCableDevice(endpoint.FriendlyName))
            {
                continue;
            }

            if (!endpoint.FriendlyName.Contains("Output", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return endpoint;
        }

        return null;
    }
}

using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// VB-Audio Hi-Fi Cable only loops Input to Output while the recording endpoint is open.
/// Keep a lightweight shared 384 kHz capture session alive so other apps can hear Hi-Fi Cable Output.
/// </summary>
internal sealed class HifiCableOutputActivator : IDisposable
{
    private MicWasapiCapture? capture;

    public bool IsActive => capture is not null;

    public void Start()
    {
        Stop();

        using var enumerator = new MMDeviceEnumerator();
        var recording = FindRecordingEndpoint(enumerator);
        if (recording is null)
        {
            return;
        }

        capture = MicWasapiCapture.Create(
            recording,
            LatencyTuning.HiFiMicCaptureBufferMilliseconds,
            HifiStreamingPolicy.EngineMixSampleRate);
        capture.DataAvailable += OnDataAvailable;
        capture.StartRecording();
    }

    public void Stop()
    {
        if (capture is null)
        {
            return;
        }

        capture.DataAvailable -= OnDataAvailable;
        capture.StopRecording();
        capture.Dispose();
        capture = null;
    }

    public void Dispose()
    {
        Stop();
    }

    private static void OnDataAvailable(object? sender, WaveInEventArgs args)
    {
        // Discard samples; this client only keeps the virtual cable output path open.
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

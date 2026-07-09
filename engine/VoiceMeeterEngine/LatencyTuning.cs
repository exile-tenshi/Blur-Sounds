using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class LatencyTuning
{
    /// <summary>Minimum milliseconds per audio event.</summary>
    public const int MinEventMilliseconds = HifiCableFormat.MinEventMilliseconds;

    /// <summary>Shared-mode WASAPI capture period (Hi-Fi).</summary>
    public const int CaptureBufferMilliseconds = 48;

    /// <summary>Maximum audio kept in the live-edge queue before discarding stale samples.</summary>
    public const int LiveEdgeMaxMilliseconds = 160;

    /// <summary>Hard cap on the in-memory live-edge ring.</summary>
    public const int LiveEdgeRingMilliseconds = 240;

    /// <summary>Hard cap on the in-memory capture ring.</summary>
    public const int CaptureRingMilliseconds = 120;

    /// <summary>Shared-mode WASAPI microphone capture period (Hi-Fi).</summary>
    public const int MicCaptureBufferMilliseconds = 64;

    /// <summary>FIFO cap for microphone capture before discarding oldest samples.</summary>
    public const int MicCaptureMaxMilliseconds = 500;

    /// <summary>In-memory ring size for microphone capture.</summary>
    public const int MicCaptureRingMilliseconds = 600;

    /// <summary>Audio to buffer before a capture source joins the live mix.</summary>
    public const int CaptureWarmupMilliseconds = 120;

    /// <summary>Fade duration when a capture source enters the mix.</summary>
    public const int CaptureFadeInMilliseconds = 20;

    /// <summary>Fade duration when a capture source leaves the mix.</summary>
    public const int CaptureFadeOutMilliseconds = 25;

    /// <summary>Larger playback buffer at 48 kHz to avoid WASAPI underruns.</summary>
    public const int OutputLatencyMilliseconds = 256;

    /// <summary>Larger playback buffer for Hi-Fi Cable studio rate output.</summary>
    public const int HiFiOutputLatencyMilliseconds = 512;

    /// <summary>Shared-mode WASAPI capture period at Hi-Fi Cable studio rate.</summary>
    public const int HiFiCaptureBufferMilliseconds = CaptureBufferMilliseconds;

    /// <summary>Shared-mode WASAPI microphone capture at Hi-Fi Cable studio rate.</summary>
    public const int HiFiMicCaptureBufferMilliseconds = MicCaptureBufferMilliseconds;

    /// <summary>Live-edge queue depth at Hi-Fi Cable studio rate.</summary>
    public const int HiFiLiveEdgeMaxMilliseconds = LiveEdgeMaxMilliseconds;

    /// <summary>Microphone FIFO cap at Hi-Fi Cable studio rate.</summary>
    public const int HiFiMicCaptureMaxMilliseconds = MicCaptureMaxMilliseconds;

    /// <summary>FIFO target for application loopback (steady music playback).</summary>
    public const int LoopbackCaptureMaxMilliseconds = 500;

    /// <summary>In-memory ring size for application loopback capture.</summary>
    public const int LoopbackCaptureRingMilliseconds = 600;

    /// <summary>Shared-mode WASAPI buffer for process loopback capture.</summary>
    public const int AppLoopbackCaptureBufferMilliseconds = 80;

    /// <summary>Audio to buffer before an app loopback source joins the mix.</summary>
    public const int AppLoopbackWarmupMilliseconds = 200;

    /// <summary>Mic standby buffer before joining the live mix.</summary>
    public const int MicCaptureJitterBufferMilliseconds = 0;

    /// <summary>App loopback standby buffer before joining the live mix.</summary>
    public const int LoopbackCaptureJitterBufferMilliseconds = 128;

    /// <summary>Process loopback is often quieter than mic; keep unity to avoid clipping.</summary>
    public const float LoopbackMakeupGain = 1.0f;

    /// <summary>Maximum audio discarded per trim pass to avoid audible skips.</summary>
    public const int MaxTrimPassMilliseconds = 8;

    public static int GetOutputLatencyMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiOutputLatencyMilliseconds
            : HiFiOutputLatencyMilliseconds;

    public static int GetCaptureBufferMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiCaptureBufferMilliseconds
            : HiFiCaptureBufferMilliseconds;

    public static int GetMicCaptureBufferMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiMicCaptureBufferMilliseconds
            : HiFiMicCaptureBufferMilliseconds;

    public static int GetLiveEdgeMaxMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiLiveEdgeMaxMilliseconds
            : HiFiLiveEdgeMaxMilliseconds;

    public static int GetMicCaptureMaxMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiMicCaptureMaxMilliseconds
            : HiFiMicCaptureMaxMilliseconds;

    public static int GetLoopbackPacketFrames(int sampleRate) =>
        sampleRate * MinEventMilliseconds / 1000;

    /// <summary>Process loopback packet size at engine mix rate (3 ms).</summary>
    public const int LoopbackPacketFrames = HifiCableFormat.MinEventFrames;
}

using NAudio.Wave;

namespace VoiceMeeterEngine;

internal static class LatencyTuning
{
    /// <summary>Minimum milliseconds per audio event.</summary>
    public const int MinEventMilliseconds = HifiCableFormat.MinEventMilliseconds;

    /// <summary>Shared-mode WASAPI capture period.</summary>
    public const int CaptureBufferMilliseconds = 40;

    /// <summary>Maximum audio kept in the live-edge queue before discarding stale samples.</summary>
    public const int LiveEdgeMaxMilliseconds = 120;

    /// <summary>Hard cap on the in-memory live-edge ring.</summary>
    public const int LiveEdgeRingMilliseconds = 240;

    /// <summary>Hard cap on the in-memory capture ring.</summary>
    public const int CaptureRingMilliseconds = 200;

    /// <summary>Shared-mode WASAPI microphone capture period.</summary>
    public const int MicCaptureBufferMilliseconds = 40;

    /// <summary>FIFO cap for microphone capture before discarding oldest samples.</summary>
    public const int MicCaptureMaxMilliseconds = 160;

    /// <summary>In-memory ring size for microphone capture.</summary>
    public const int MicCaptureRingMilliseconds = 240;

    /// <summary>Audio to buffer before a capture source joins the live mix.</summary>
    public const int CaptureWarmupMilliseconds = 40;

    /// <summary>Fade duration when a capture source enters the mix.</summary>
    public const int CaptureFadeInMilliseconds = 16;

    /// <summary>Fade duration when a capture source leaves the mix.</summary>
    public const int CaptureFadeOutMilliseconds = 20;

    /// <summary>WASAPI playback buffer — stable enough to avoid silent underruns.</summary>
    public const int OutputLatencyMilliseconds = 128;

    /// <summary>Hi-Fi Cable WASAPI playback buffer (stable vs crackle).</summary>
    public const int HiFiOutputLatencyMilliseconds = 200;

    /// <summary>Shared-mode WASAPI capture period at Hi-Fi Cable studio rate.</summary>
    public const int HiFiCaptureBufferMilliseconds = CaptureBufferMilliseconds;

    /// <summary>Shared-mode WASAPI microphone capture at Hi-Fi Cable studio rate.</summary>
    public const int HiFiMicCaptureBufferMilliseconds = MicCaptureBufferMilliseconds;

    /// <summary>Live-edge queue depth at Hi-Fi Cable studio rate.</summary>
    public const int HiFiLiveEdgeMaxMilliseconds = LiveEdgeMaxMilliseconds;

    /// <summary>Microphone FIFO cap at Hi-Fi Cable studio rate.</summary>
    public const int HiFiMicCaptureMaxMilliseconds = MicCaptureMaxMilliseconds;

    /// <summary>FIFO / live-edge target for application loopback.</summary>
    public const int LoopbackCaptureMaxMilliseconds = 120;

    /// <summary>In-memory ring size for application loopback capture.</summary>
    public const int LoopbackCaptureRingMilliseconds = 240;

    /// <summary>Shared-mode WASAPI buffer for process loopback capture.</summary>
    public const int AppLoopbackCaptureBufferMilliseconds = 40;

    /// <summary>Audio to buffer before an app loopback source joins the mix.</summary>
    public const int AppLoopbackWarmupMilliseconds = 40;

    /// <summary>Mic standby buffer before joining the live mix.</summary>
    public const int MicCaptureJitterBufferMilliseconds = 40;

    /// <summary>App loopback standby buffer before joining the live mix.</summary>
    public const int LoopbackCaptureJitterBufferMilliseconds = 40;

    /// <summary>Process loopback is often quieter than mic; keep unity to avoid clipping.</summary>
    public const float LoopbackMakeupGain = 1.0f;

    /// <summary>Maximum audio discarded per trim pass to avoid audible skips.</summary>
    public const int MaxTrimPassMilliseconds = 24;

    /// <summary>Extra mix→WASAPI staging ring when sample rates already match.</summary>
    public const int OutputStageBufferMilliseconds = 80;

    public static int GetOutputLatencyMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiOutputLatencyMilliseconds
            : OutputLatencyMilliseconds;

    public static int GetCaptureBufferMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiCaptureBufferMilliseconds
            : CaptureBufferMilliseconds;

    public static int GetMicCaptureBufferMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiMicCaptureBufferMilliseconds
            : MicCaptureBufferMilliseconds;

    public static int GetLiveEdgeMaxMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiLiveEdgeMaxMilliseconds
            : LiveEdgeMaxMilliseconds;

    public static int GetMicCaptureMaxMilliseconds(bool isHiFiCable) =>
        AudioTuningPolicy.UseHiFiBuffers(isHiFiCable)
            ? HiFiMicCaptureMaxMilliseconds
            : MicCaptureMaxMilliseconds;

    public static int GetLoopbackPacketFrames(int sampleRate) =>
        sampleRate * MinEventMilliseconds / 1000;

    /// <summary>Process loopback packet size at engine mix rate (3 ms).</summary>
    public const int LoopbackPacketFrames = HifiCableFormat.MinEventFrames;
}

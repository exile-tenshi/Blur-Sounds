using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Live audio path diagnostics surfaced in engine telemetry.
/// </summary>
internal static class AudioDiagnostics
{
    private static int mixSampleRate;
    private static int streamSampleRate;
    private static int deviceSampleRate;
    private static int deviceBitsPerSample;
    private static string outputBinding = string.Empty;
    private static string? renderError;

    public static void SetMixFormat(WaveFormat format)
    {
        mixSampleRate = format.SampleRate;
    }

    public static void SetOutputBinding(string bindingDescription, WaveFormat? streamFormat = null)
    {
        outputBinding = bindingDescription;
        if (streamFormat is not null)
        {
            streamSampleRate = streamFormat.SampleRate;
        }
    }

    public static void SetDeviceStudioFormat(int sampleRate, int bitsPerSample)
    {
        deviceSampleRate = sampleRate;
        deviceBitsPerSample = bitsPerSample;
    }

    public static void SetRenderError(string? error)
    {
        renderError = error;
    }

    public static AudioDiagnosticsSnapshot GetSnapshot() => new()
    {
        MixSampleRate = mixSampleRate,
        StreamSampleRate = streamSampleRate,
        DeviceSampleRate = deviceSampleRate,
        DeviceBitsPerSample = deviceBitsPerSample,
        OutputBinding = outputBinding,
        RenderError = renderError,
        UnderrunCount = CaptureDiagnostics.TotalUnderruns,
        Policy = HifiStreamingPolicy.Describe(),
    };
}

internal sealed class AudioDiagnosticsSnapshot
{
    public int MixSampleRate { get; init; }
    public int StreamSampleRate { get; init; }
    public int DeviceSampleRate { get; init; }
    public int DeviceBitsPerSample { get; init; }
    public string OutputBinding { get; init; } = string.Empty;
    public string? RenderError { get; init; }
    public int UnderrunCount { get; init; }
    public string Policy { get; init; } = string.Empty;
}

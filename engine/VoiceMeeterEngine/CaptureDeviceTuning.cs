namespace VoiceMeeterEngine;

/// <summary>
/// Buffer and format tuning for microphones that deliver bursty or native-rate audio.
/// Sized to stay ahead of the Hi-Fi Cable output buffer so capture FIFOs do not underrun.
/// </summary>
internal static class CaptureDeviceTuning
{
    /// <summary>
    /// Devices that matched the original mic filter and capture cleanly at 48 kHz float.
    /// </summary>
    public static bool IsLegacyMicrophoneDevice(string? deviceName)
    {
        if (string.IsNullOrWhiteSpace(deviceName))
        {
            return false;
        }

        var normalized = deviceName.Trim();
        return ContainsAny(
            normalized,
            "microphone",
            "mic",
            "hyperx",
            "fox",
            "steelseries sonar",
            "virtual desktop audio",
            "headset",
            "webcam");
    }

    /// <summary>
    /// VR / bursty headset microphones.
    /// </summary>
    public static bool IsComfortCaptureDevice(string? deviceName)
    {
        if (string.IsNullOrWhiteSpace(deviceName))
        {
            return false;
        }

        var normalized = deviceName.Trim();
        return ContainsAny(
            normalized,
            "vive",
            "htc",
            "valve index",
            "index microphone",
            "oculus",
            "meta quest",
            "quest",
            "windows virtual",
            "steam streaming",
            "virtual desktop",
            "pimax",
            "varjo",
            "reverb g2",
            "vive cosmos",
            "vive pro",
            "microphone (nvidia",
            "nvidia broadcast");
    }

    /// <summary>
    /// Newly selectable capture devices (line-in, stereo mix, USB interfaces) that need native-rate capture.
    /// </summary>
    public static bool IsExtendedCaptureDevice(string? deviceName)
    {
        if (string.IsNullOrWhiteSpace(deviceName))
        {
            return false;
        }

        if (IsComfortCaptureDevice(deviceName) || IsLegacyMicrophoneDevice(deviceName))
        {
            return false;
        }

        return true;
    }

    public static bool UseComfortUnderrun(string? deviceName) => false;

    public static int GetMicCaptureBufferMilliseconds(string? deviceName, bool isHiFiOutput)
    {
        isHiFiOutput = AudioTuningPolicy.UseHiFiBuffers(isHiFiOutput);
        if (IsComfortCaptureDevice(deviceName))
        {
            return isHiFiOutput ? 48 : 40;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return isHiFiOutput ? 40 : 36;
        }

        return LatencyTuning.GetMicCaptureBufferMilliseconds(isHiFiOutput);
    }

    public static int GetMicCaptureMaxMilliseconds(string? deviceName, bool isHiFiOutput)
    {
        isHiFiOutput = AudioTuningPolicy.UseHiFiBuffers(isHiFiOutput);
        if (IsComfortCaptureDevice(deviceName))
        {
            return isHiFiOutput ? 280 : 220;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return isHiFiOutput ? 240 : 200;
        }

        return LatencyTuning.GetMicCaptureMaxMilliseconds(isHiFiOutput);
    }

    public static int GetMicCaptureRingMilliseconds(string? deviceName)
    {
        if (IsComfortCaptureDevice(deviceName))
        {
            return 420;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return 360;
        }

        return LatencyTuning.MicCaptureRingMilliseconds;
    }

    public static int GetCaptureWarmupMilliseconds(string? deviceName)
    {
        if (IsComfortCaptureDevice(deviceName) || IsExtendedCaptureDevice(deviceName))
        {
            return 30;
        }

        return LatencyTuning.CaptureWarmupMilliseconds;
    }

    public static int GetCaptureWarmupDeadlineMilliseconds(string? deviceName)
    {
        if (IsComfortCaptureDevice(deviceName))
        {
            return 120;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return 90;
        }

        return 60;
    }

    public static int GetJitterBufferMilliseconds(string? deviceName)
    {
        if (IsComfortCaptureDevice(deviceName))
        {
            return 16;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return 8;
        }

        return LatencyTuning.MicCaptureJitterBufferMilliseconds;
    }

    public static bool UseEventSyncCapture(string? deviceName) =>
        IsComfortCaptureDevice(deviceName);

    private static bool ContainsAny(string value, params string[] needles)
    {
        foreach (var needle in needles)
        {
            if (value.Contains(needle, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}

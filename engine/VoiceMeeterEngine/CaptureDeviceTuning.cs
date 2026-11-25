namespace VoiceMeeterEngine;

/// <summary>
/// Buffer and format tuning for microphones that deliver bursty or native-rate audio.
/// Kept intentionally tight so mic/music stay near-instant through Hi-Fi Cable.
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
            return isHiFiOutput ? 140 : 120;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return isHiFiOutput ? 120 : 100;
        }

        return LatencyTuning.GetMicCaptureMaxMilliseconds(isHiFiOutput);
    }

    public static int GetMicCaptureRingMilliseconds(string? deviceName)
    {
        if (IsComfortCaptureDevice(deviceName))
        {
            return 200;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return 160;
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
            return 12;
        }

        if (IsExtendedCaptureDevice(deviceName))
        {
            return 8;
        }

        return 0;
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

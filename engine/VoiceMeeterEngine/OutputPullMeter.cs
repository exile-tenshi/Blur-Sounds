using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Tracks peaks from the live WASAPI render pull so telemetry reflects bytes sent to the device.
/// </summary>
internal static class OutputPullMeter
{
    private static float peak;

    public static float Peak
    {
        get
        {
            var current = peak;
            peak *= 0.92f;
            return current;
        }
    }

    public static void Reset()
    {
        peak = 0f;
    }

    public static void ReportPeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        if (bytesRecorded <= 0)
        {
            return;
        }

        var next = AudioLevelUtility.ComputePeak(buffer, bytesRecorded, format);
        peak = AudioLevelUtility.ApplyDecay(peak, next);
    }
}

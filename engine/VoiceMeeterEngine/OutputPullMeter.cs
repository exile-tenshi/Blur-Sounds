using System.Threading;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Tracks peaks and bytes from the live WASAPI render pull so telemetry reflects
/// bytes sent to the device (including digital silence).
/// </summary>
internal static class OutputPullMeter
{
    private static float peak;
    private static long bytesPulled;

    public static float Peak
    {
        get
        {
            var current = peak;
            peak *= 0.92f;
            return current;
        }
    }

    public static long BytesPulled => Interlocked.Read(ref bytesPulled);

    public static void Reset()
    {
        peak = 0f;
        Interlocked.Exchange(ref bytesPulled, 0);
    }

    public static void ReportPeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        if (bytesRecorded <= 0)
        {
            return;
        }

        Interlocked.Add(ref bytesPulled, bytesRecorded);
        var next = AudioLevelUtility.ComputePeak(buffer, bytesRecorded, format);
        peak = AudioLevelUtility.ApplyDecay(peak, next);
    }
}

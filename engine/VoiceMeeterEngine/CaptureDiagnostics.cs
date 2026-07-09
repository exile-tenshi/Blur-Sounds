namespace VoiceMeeterEngine;

/// <summary>
/// Aggregates capture and render underrun counters for telemetry.
/// </summary>
internal static class CaptureDiagnostics
{
    private static long captureUnderruns;
    private static long renderUnderruns;

    public static void NoteCaptureUnderrun() => Interlocked.Increment(ref captureUnderruns);

    public static void NoteRenderUnderrun() => Interlocked.Increment(ref renderUnderruns);

    public static int TotalUnderruns =>
        (int)Math.Min(int.MaxValue, Interlocked.Read(ref captureUnderruns) + Interlocked.Read(ref renderUnderruns));
}

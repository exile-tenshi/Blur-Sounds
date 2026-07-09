namespace VoiceMeeterEngine;

/// <summary>
/// Windows only allows one successful ActivateAudioInterfaceAsync per process loopback
/// client. Reuse captures while healthy and created with the same process-tree mode.
/// </summary>
internal static class ProcessLoopbackPool
{
    private static readonly object Gate = new();
    private static readonly Dictionary<int, ProcessWasapiCapture> Captures = [];

    public static async Task<ProcessWasapiCapture> AcquireAsync(
        int processId,
        bool includeProcessTree = true,
        int sampleRate = EngineAudioFormat.SampleRate,
        int channels = EngineAudioFormat.Channels)
    {
        lock (Gate)
        {
            if (Captures.TryGetValue(processId, out var existing) &&
                existing.IsHealthy &&
                existing.IncludeProcessTree == includeProcessTree &&
                existing.WaveFormat.SampleRate == sampleRate)
            {
                return existing;
            }

            if (Captures.Remove(processId, out var stale))
            {
                stale.Dispose();
            }
        }

        var capture = await ProcessWasapiCapture.CreateForProcessCaptureAsync(
            processId,
            includeProcessTree,
            sampleRate,
            channels);

        lock (Gate)
        {
            if (Captures.TryGetValue(processId, out var existing) &&
                existing.IsHealthy &&
                existing.IncludeProcessTree == includeProcessTree)
            {
                capture.Dispose();
                return existing;
            }

            Captures[processId] = capture;
            return capture;
        }
    }

    public static void MarkUnhealthy(int processId)
    {
        lock (Gate)
        {
            if (Captures.TryGetValue(processId, out var capture))
            {
                capture.MarkUnhealthy();
            }
        }
    }

    public static void Release(int processId)
    {
        // Captures stay alive in the pool until evicted or the engine shuts down.
    }

    public static void Evict(int processId)
    {
        lock (Gate)
        {
            if (Captures.Remove(processId, out var capture))
            {
                capture.Dispose();
            }
        }
    }

    public static void DisposeAll()
    {
        lock (Gate)
        {
            foreach (var capture in Captures.Values)
            {
                capture.Dispose();
            }

            Captures.Clear();
        }
    }
}

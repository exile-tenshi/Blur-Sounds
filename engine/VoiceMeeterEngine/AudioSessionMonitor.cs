using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

internal static class AudioSessionMonitor
{
    private static readonly object CacheGate = new();
    private static List<SessionPeakInfo> cachedPeaks = [];
    private static long cachedPeaksAtMs;
    /// <summary>
    /// COM session enumeration is expensive — never scan every meter tick.
    /// Live mic/route levels come from capture peaks; this cache is for App Library only.
    /// </summary>
    private const int CacheTtlMilliseconds = 2000;

    public static List<SessionPeakInfo> GetActiveSessionPeaks(MMDeviceEnumerator enumerator)
    {
        return GetActiveSessionPeaksAllDevices(enumerator);
    }

    public static List<SessionPeakInfo> GetActiveSessionPeaksAllDevices(MMDeviceEnumerator enumerator)
    {
        var now = Environment.TickCount64;
        lock (CacheGate)
        {
            if (cachedPeaks.Count > 0 && now - cachedPeaksAtMs < CacheTtlMilliseconds)
            {
                return cachedPeaks;
            }
        }

        var peaks = ScanActiveSessionPeaks(enumerator);
        lock (CacheGate)
        {
            cachedPeaks = peaks;
            cachedPeaksAtMs = now;
        }

        return peaks;
    }

    /// <summary>
    /// Returns the last scanned peaks without touching COM when still fresh.
    /// Used by telemetry so idle/stream ticks don't re-enumerate every render endpoint.
    /// </summary>
    public static List<SessionPeakInfo> GetCachedOrScan(MMDeviceEnumerator enumerator, bool forceScan = false)
    {
        if (!forceScan)
        {
            var now = Environment.TickCount64;
            lock (CacheGate)
            {
                if (now - cachedPeaksAtMs < CacheTtlMilliseconds)
                {
                    return cachedPeaks;
                }
            }
        }

        return GetActiveSessionPeaksAllDevices(enumerator);
    }

    /// <summary>Never touches COM — safe on the fast meter telemetry path.</summary>
    public static List<SessionPeakInfo> PeekCached()
    {
        lock (CacheGate)
        {
            return cachedPeaks;
        }
    }

    /// <summary>Refresh session peaks off the hot meter path (about every 2s).</summary>
    public static void RefreshInBackground(MMDeviceEnumerator _)
    {
        _ = Task.Run(() =>
        {
            try
            {
                // Own enumerator — MMDeviceEnumerator is not safe to share across threads.
                using var enumerator = new MMDeviceEnumerator();
                GetActiveSessionPeaksAllDevices(enumerator);
            }
            catch
            {
                // Background session peak refresh is best-effort.
            }
        });
    }

    private static List<SessionPeakInfo> ScanActiveSessionPeaks(MMDeviceEnumerator enumerator)
    {
        var peaksByProcess = new Dictionary<uint, float>();

        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            using (device)
            {
                MergeSessionPeaks(device, peaksByProcess);
            }
        }

        if (peaksByProcess.Count == 0)
        {
            try
            {
                using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                MergeSessionPeaks(device, peaksByProcess);
            }
            catch
            {
                // Default render endpoint may be unavailable.
            }
        }

        return peaksByProcess
            .Where(entry => entry.Value > 0.001f)
            .Select(entry => new SessionPeakInfo
            {
                ProcessId = (int)entry.Key,
                Peak = entry.Value,
            })
            .OrderByDescending(entry => entry.Peak)
            .ToList();
    }

    private static void MergeSessionPeaks(MMDevice device, Dictionary<uint, float> peaksByProcess)
    {
        try
        {
            var sessions = device.AudioSessionManager.Sessions;

            for (var index = 0; index < sessions.Count; index++)
            {
                var session = sessions[index];

                try
                {
                    var processId = session.GetProcessID;
                    if (processId <= 0)
                    {
                        continue;
                    }

                    var peak = session.AudioMeterInformation.MasterPeakValue;
                    if (peaksByProcess.TryGetValue(processId, out var existingPeak))
                    {
                        peaksByProcess[processId] = Math.Max(existingPeak, peak);
                    }
                    else
                    {
                        peaksByProcess[processId] = peak;
                    }
                }
                catch
                {
                    // Some sessions cannot report peak or process id.
                }
            }
        }
        catch
        {
            // Endpoint session manager may be unavailable.
        }
    }
}

internal sealed class SessionPeakInfo
{
    public int ProcessId { get; set; }

    public float Peak { get; set; }
}

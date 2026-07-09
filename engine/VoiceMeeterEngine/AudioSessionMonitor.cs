using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

internal static class AudioSessionMonitor
{
    public static List<SessionPeakInfo> GetActiveSessionPeaks(MMDeviceEnumerator enumerator)
    {
        return GetActiveSessionPeaksAllDevices(enumerator);
    }

    public static List<SessionPeakInfo> GetActiveSessionPeaksAllDevices(MMDeviceEnumerator enumerator)
    {
        var peaksByProcess = new Dictionary<uint, float>();

        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            MergeSessionPeaks(device, peaksByProcess);
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

using System.Diagnostics;
using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

internal static class AudioProcessResolver
{
    public static int ResolvePlaybackProcessId(
        MMDeviceEnumerator enumerator,
        int candidateProcessId,
        string? processNameHint = null)
    {
        var hasCandidate = TryGetProcessName(candidateProcessId, out var candidateName);
        if (!hasCandidate && !string.IsNullOrWhiteSpace(processNameHint))
        {
            candidateName = processNameHint;
            hasCandidate = true;
        }

        if (!hasCandidate)
        {
            return candidateProcessId;
        }

        var sessions = AudioSessionMonitor.GetActiveSessionPeaksAllDevices(enumerator);
        var relatedSessions = sessions
            .Where(session => HasProcessName(session.ProcessId, candidateName))
            .ToList();

        if (relatedSessions.Count == 0)
        {
            if (!IsProcessRunning(candidateProcessId))
            {
                var liveProcessId = FindRunningProcessId(candidateName, candidateProcessId);
                if (liveProcessId.HasValue)
                {
                    return liveProcessId.Value;
                }
            }

            return candidateProcessId;
        }

        var bestSession = relatedSessions.OrderByDescending(session => session.Peak).First();
        if (!IsProcessRunning(candidateProcessId))
        {
            return bestSession.ProcessId;
        }

        var candidatePeak = relatedSessions
            .FirstOrDefault(session => session.ProcessId == candidateProcessId)
            ?.Peak ?? 0f;

        if (candidatePeak < 0.001f && bestSession.Peak > 0.001f)
        {
            return bestSession.ProcessId;
        }

        if (bestSession.ProcessId != candidateProcessId &&
            bestSession.Peak > 0.01f &&
            bestSession.Peak > candidatePeak * 1.5f)
        {
            return bestSession.ProcessId;
        }

        return candidateProcessId;
    }

    public static bool ShouldRecreateLoopbackCapture(
        MMDeviceEnumerator enumerator,
        int routeProcessId,
        int captureProcessId,
        float captureLevel,
        string? processNameHint = null)
    {
        if (!IsProcessRunning(captureProcessId))
        {
            return true;
        }

        var resolvedProcessId = ResolvePlaybackProcessId(enumerator, routeProcessId, processNameHint);
        if (resolvedProcessId == captureProcessId)
        {
            return false;
        }

        if (captureLevel > 0.005f)
        {
            return false;
        }

        var sessions = AudioSessionMonitor.GetActiveSessionPeaksAllDevices(enumerator);
        var resolvedPeak = sessions.FirstOrDefault(session => session.ProcessId == resolvedProcessId)?.Peak ?? 0f;
        return resolvedPeak > 0.05f;
    }

    public static string? TryGetDirectHifiPlaybackWarning(
        MMDeviceEnumerator enumerator,
        int processId,
        string? inputDeviceSelectionId)
    {
        if (string.IsNullOrWhiteSpace(inputDeviceSelectionId))
        {
            return null;
        }

        var targetDevice = FindRenderDevice(enumerator, inputDeviceSelectionId);
        if (targetDevice is null)
        {
            return null;
        }

        if (!HasActiveSession(targetDevice, processId))
        {
            return null;
        }

        var appLabel = TryGetProcessName(processId, out var processName)
            ? processName
            : "This app";

        return
            $"{appLabel} is playing directly to {targetDevice.FriendlyName}. Set it to your normal speakers or headphones instead — Blur Sounds will capture it and send it to Hi-Fi Cable Input with volume and EQ.";
    }

    private static int? FindRunningProcessId(string processName, int preferredProcessId)
    {
        try
        {
            foreach (var process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    if (!process.HasExited && process.Id == preferredProcessId)
                    {
                        return preferredProcessId;
                    }
                }
            }

            foreach (var process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    if (!process.HasExited)
                    {
                        return process.Id;
                    }
                }
            }
        }
        catch
        {
            return null;
        }

        return null;
    }

    public static bool IsProcessRunning(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }

    private static MMDevice? FindRenderDevice(MMDeviceEnumerator enumerator, string selectionId)
    {
        var targetName = ExtractDeviceName(selectionId);
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            if (device.ID == selectionId ||
                device.FriendlyName.Equals(targetName, StringComparison.OrdinalIgnoreCase) ||
                device.FriendlyName.Contains(targetName, StringComparison.OrdinalIgnoreCase))
            {
                return device;
            }
        }

        return null;
    }

    private static bool HasActiveSession(MMDevice device, int processId)
    {
        try
        {
            var manager = device.AudioSessionManager;
            var sessionEnumerator = manager.Sessions;
            for (var index = 0; index < sessionEnumerator.Count; index++)
            {
                var session = sessionEnumerator[index];
                if (session.GetProcessID == processId)
                {
                    return true;
                }
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static bool TryGetProcessName(int processId, out string processName)
    {
        processName = string.Empty;
        try
        {
            using var process = Process.GetProcessById(processId);
            processName = process.ProcessName;
            return !string.IsNullOrWhiteSpace(processName);
        }
        catch
        {
            return false;
        }
    }

    private static bool HasProcessName(int processId, string candidateName)
    {
        return TryGetProcessName(processId, out var processName) &&
               processName.Equals(candidateName, StringComparison.OrdinalIgnoreCase);
    }

    private static string ExtractDeviceName(string selectionId)
    {
        var parts = selectionId.Split("::", 2, StringSplitOptions.None);
        return parts.Length == 2 ? parts[1] : selectionId;
    }
}

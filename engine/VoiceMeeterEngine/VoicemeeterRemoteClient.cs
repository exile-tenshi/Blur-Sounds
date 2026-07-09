using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace VoiceMeeterEngine;

internal static class VoicemeeterRemoteClient
{
    private static readonly string[] RemoteDllCandidates =
    [
        @"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterRemote64.dll",
        @"C:\Program Files\VB\Voicemeeter\VoicemeeterRemote64.dll",
        @"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterRemote.dll",
        @"C:\Program Files\VB\Voicemeeter\VoicemeeterRemote.dll",
    ];

    private static IntPtr libraryHandle;
    private static LoginDelegate? login;
    private static LogoutDelegate? logout;
    private static SetParameterFloatDelegate? setParameterFloat;
    private static GetParameterFloatDelegate? getParameterFloat;
    private static GetVoicemeeterTypeDelegate? getVoicemeeterType;

    public static bool TryEnableRoute(string inputDeviceName, out string message)
    {
        message = string.Empty;

        if (!EnsureApiLoaded(out message))
        {
            return false;
        }

        if (!EnsureLoggedIn(out message))
        {
            return false;
        }

        var vmType = GetVoicemeeterTypeValue();
        var route = VoicemeeterRoutingMap.ParseInputDeviceName(inputDeviceName, vmType);
        if (route is null)
        {
            message = "Input is not a Voicemeeter device.";
            return false;
        }

        try
        {
            var muteResult = setParameterFloat!($"Strip[{route.StripIndex}].Mute", 0f);
            var gainResult = setParameterFloat!($"Strip[{route.StripIndex}].Gain", 0f);
            var routeResult = setParameterFloat!(route.ParameterName, 1f);
            var busIndex = VoicemeeterRoutingMap.ResolveBusIndex(route.BusKey);
            var busMuteResult = setParameterFloat!($"Bus[{busIndex}].Mute", 0f);

            if (routeResult < 0)
            {
                message =
                    $"Voicemeeter rejected route {route.ParameterName}. Open Voicemeeter and enable {route.BusKey} on strip {route.StripIndex + 1}.";
                return false;
            }

            var verified = TryReadRouteState(route, out var routeValue);
            message = verified && routeValue >= 0.5f
                ? $"enabled {route.ParameterName} → {route.RecordingLabel} (strip {route.StripIndex + 1}, bus mute {busMuteResult}, VM type {vmType})"
                : $"set {route.ParameterName} → {route.RecordingLabel} (mute {muteResult}, gain {gainResult}, route {routeResult})";

            return true;
        }
        catch (Exception ex)
        {
            message = $"Voicemeeter route failed: {ex.Message}";
            return false;
        }
    }

    private static bool TryReadRouteState(VoicemeeterRouteTarget route, out float routeValue)
    {
        routeValue = 0f;

        if (getParameterFloat is null)
        {
            return false;
        }

        return getParameterFloat(route.ParameterName, ref routeValue) >= 0;
    }

    private static int GetVoicemeeterTypeValue()
    {
        if (getVoicemeeterType is null)
        {
            return 3;
        }

        var vmType = 0;
        return getVoicemeeterType(ref vmType) >= 0 && vmType is >= 1 and <= 3 ? vmType : 3;
    }

    private static bool EnsureApiLoaded(out string message)
    {
        message = string.Empty;

        if (libraryHandle != IntPtr.Zero && login is not null && setParameterFloat is not null)
        {
            return true;
        }

        foreach (var candidate in EnumerateRemoteDllCandidates())
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            if (!NativeLibrary.TryLoad(candidate, out libraryHandle))
            {
                continue;
            }

            if (!TryGetExport<LoginDelegate>("VBVMR_Login", out login) ||
                !TryGetExport<LogoutDelegate>("VBVMR_Logout", out logout) ||
                !TryGetExport<SetParameterFloatDelegate>("VBVMR_SetParameterFloat", out setParameterFloat))
            {
                NativeLibrary.Free(libraryHandle);
                libraryHandle = IntPtr.Zero;
                continue;
            }

            TryGetExport<GetParameterFloatDelegate>("VBVMR_GetParameterFloat", out getParameterFloat);
            TryGetExport<GetVoicemeeterTypeDelegate>("VBVMR_GetVoicemeeterType", out getVoicemeeterType);
            return true;
        }

        message = "Voicemeeter Remote API was not found. Install Voicemeeter from VB-Audio.";
        return false;
    }

    private static IEnumerable<string> EnumerateRemoteDllCandidates()
    {
        foreach (var candidate in RemoteDllCandidates)
        {
            yield return candidate;
        }

        foreach (var installRoot in EnumerateInstallRoots())
        {
            yield return Path.Combine(installRoot, "VoicemeeterRemote64.dll");
            yield return Path.Combine(installRoot, "VoicemeeterRemote.dll");
        }
    }

    private static IEnumerable<string> EnumerateInstallRoots()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var root in new[]
                 {
                     @"C:\Program Files (x86)\VB\Voicemeeter",
                     @"C:\Program Files\VB\Voicemeeter",
                     @"C:\Program Files (x86)\VB\Voicemeeter8",
                     @"C:\Program Files\VB\Voicemeeter8",
                 })
        {
            if (seen.Add(root))
            {
                yield return root;
            }
        }

        foreach (var registryRoot in ReadRegistryInstallRoots())
        {
            if (seen.Add(registryRoot))
            {
                yield return registryRoot;
            }
        }
    }

    private static IEnumerable<string> ReadRegistryInstallRoots()
    {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            foreach (var subKeyName in new[] { @"SOFTWARE\VB-Audio\Voicemeeter", @"SOFTWARE\VB-Audio\Voicemeeter8" })
            {
                using var subKey = baseKey.OpenSubKey(subKeyName);
                var installPath = subKey?.GetValue("InstallPath") as string;
                if (!string.IsNullOrWhiteSpace(installPath))
                {
                    yield return installPath;
                }
            }
        }
    }

    private static bool EnsureLoggedIn(out string message)
    {
        message = string.Empty;

        var loginResult = login!();
        if (loginResult is >= 0)
        {
            return true;
        }

        message = loginResult switch
        {
            -1 => "Voicemeeter is not running. Start Voicemeeter, then restart the stream.",
            -2 => "Voicemeeter Remote API login failed.",
            _ => $"Voicemeeter login error ({loginResult}).",
        };
        return false;
    }

    private static bool TryGetExport<T>(string exportName, out T? exportedDelegate) where T : Delegate
    {
        exportedDelegate = null;

        if (!NativeLibrary.TryGetExport(libraryHandle, exportName, out var exportAddress))
        {
            return false;
        }

        exportedDelegate = Marshal.GetDelegateForFunctionPointer<T>(exportAddress);
        return exportedDelegate is not null;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int LoginDelegate();

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int LogoutDelegate();

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetParameterFloatDelegate(
        [MarshalAs(UnmanagedType.LPStr)] string parameterName,
        float value);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetParameterFloatDelegate(
        [MarshalAs(UnmanagedType.LPStr)] string parameterName,
        ref float value);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetVoicemeeterTypeDelegate(ref int voicemeeterType);
}

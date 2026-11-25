using System.Text.RegularExpressions;
using Microsoft.Win32;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

internal sealed class HifiCableFormatResult
{
    public bool PlaybackConfigured { get; init; }
    public bool RecordingConfigured { get; init; }
    public string? PlaybackDeviceName { get; init; }
    public string? RecordingDeviceName { get; init; }
    public HifiCableEndpointStatus? PlaybackStatus { get; init; }
    public HifiCableEndpointStatus? RecordingStatus { get; init; }
    public string Message { get; init; } = string.Empty;
}

internal sealed class HifiCableEndpointStatus
{
    public string DeviceName { get; init; } = string.Empty;

    public int SampleRate { get; init; }

    public int BitsPerSample { get; init; }

    public bool ExclusiveModeEnabled { get; init; }

    public bool AtStudioQuality { get; init; }

    public string FormatLabel { get; init; } = string.Empty;
}

internal static partial class HifiCableFormatConfigurator
{
    public static HifiCableFormatResult ApplyStudioQuality()
    {
        using var enumerator = new MMDeviceEnumerator();
        var playback = FindEndpoint(enumerator, DataFlow.Render);
        var recording = FindEndpoint(enumerator, DataFlow.Capture);

        if (playback is null && recording is null)
        {
            return new HifiCableFormatResult
            {
                Message = "Hi-Fi Cable Input and Output were not found. Install Hi-Fi Cable, then click Refresh.",
            };
        }

        var policyConfig = PolicyConfigInterop.CreatePolicyConfig();
        var errors = new List<string>();
        var playbackConfigured = false;
        var recordingConfigured = false;

        if (playback is not null)
        {
            try
            {
                ConfigureEndpoint(policyConfig, playback, "Render");
                playbackConfigured = true;
            }
            catch (Exception ex)
            {
                errors.Add($"Playback ({playback.FriendlyName}): {ex.Message}");
            }
        }

        if (recording is not null)
        {
            try
            {
                ConfigureEndpoint(policyConfig, recording, "Capture");
                recordingConfigured = true;
            }
            catch (Exception ex)
            {
                errors.Add($"Recording ({recording.FriendlyName}): {ex.Message}");
            }
        }

        var playbackStatus = playback is not null ? ReadEndpointStatus(playback, "Render") : null;
        var recordingStatus = recording is not null ? ReadEndpointStatus(recording, "Capture") : null;
        var qualityLabel = HifiCableFormat.EngineCleanDescription;

        if (errors.Count == 0)
        {
            AudioDiagnostics.SetDeviceStudioFormat(
                HifiCableFormat.EngineCleanSampleRate,
                HifiCableFormat.HiFiEngineBitsPerSample);

            return new HifiCableFormatResult
            {
                PlaybackConfigured = playbackConfigured,
                RecordingConfigured = recordingConfigured,
                PlaybackDeviceName = playback?.FriendlyName,
                RecordingDeviceName = recording?.FriendlyName,
                PlaybackStatus = playbackStatus,
                RecordingStatus = recordingStatus,
                Message = BuildSuccessMessage(playbackStatus, recordingStatus, qualityLabel),
            };
        }

        var partialMessage = playbackConfigured || recordingConfigured
            ? "Hi-Fi Cable clean audio settings were applied partially. "
            : "Unable to apply Hi-Fi Cable clean audio settings. ";

        return new HifiCableFormatResult
        {
            PlaybackConfigured = playbackConfigured,
            RecordingConfigured = recordingConfigured,
            PlaybackDeviceName = playback?.FriendlyName,
            RecordingDeviceName = recording?.FriendlyName,
            PlaybackStatus = playbackStatus,
            RecordingStatus = recordingStatus,
            Message = partialMessage + string.Join(" ", errors),
        };
    }

    public static HifiCableFormatResult QueryStudioQuality()
    {
        using var enumerator = new MMDeviceEnumerator();
        var playback = FindEndpoint(enumerator, DataFlow.Render);
        var recording = FindEndpoint(enumerator, DataFlow.Capture);

        if (playback is null && recording is null)
        {
            return new HifiCableFormatResult
            {
                Message = "Hi-Fi Cable Input and Output were not found.",
            };
        }

        var playbackStatus = playback is not null ? ReadEndpointStatus(playback, "Render") : null;
        var recordingStatus = recording is not null ? ReadEndpointStatus(recording, "Capture") : null;
        var qualityLabel = HifiCableFormat.EngineCleanDescription;

        return new HifiCableFormatResult
        {
            PlaybackConfigured = playbackStatus?.AtStudioQuality ?? false,
            RecordingConfigured = recordingStatus?.AtStudioQuality ?? false,
            PlaybackDeviceName = playback?.FriendlyName,
            RecordingDeviceName = recording?.FriendlyName,
            PlaybackStatus = playbackStatus,
            RecordingStatus = recordingStatus,
            Message = BuildSuccessMessage(playbackStatus, recordingStatus, qualityLabel),
        };
    }

    private static string BuildSuccessMessage(
        HifiCableEndpointStatus? playbackStatus,
        HifiCableEndpointStatus? recordingStatus,
        string qualityLabel)
    {
        if (playbackStatus?.AtStudioQuality == true && recordingStatus?.AtStudioQuality == true)
        {
            return
                $"Hi-Fi Cable Input and Output are set to {qualityLabel}. Blur Sounds streams at {HifiStreamingPolicy.EngineMixSampleRate} Hz with no sample-rate conversion.";
        }

        var issues = new List<string>();
        if (playbackStatus is not null && !playbackStatus.AtStudioQuality)
        {
            issues.Add($"Input is {playbackStatus.FormatLabel}");
        }

        if (recordingStatus is not null && !recordingStatus.AtStudioQuality)
        {
            issues.Add($"Output is {recordingStatus.FormatLabel}");
        }

        if (issues.Count == 0)
        {
            return $"Hi-Fi Cable reset to clean audio ({qualityLabel}) on playback and recording.";
        }

        return
            $"Hi-Fi Cable is not at clean audio format. {string.Join(" · ", issues)}. Click Apply clean audio settings or set both sides to 48000 Hz · 24-bit in Windows Sound.";
    }

    private static HifiCableEndpointStatus ReadEndpointStatus(MMDevice endpoint, string registryKind)
    {
        var format = TryReadEndpointFormat(endpoint);
        var exclusiveMode = IsExclusiveModeEnabled(endpoint.ID, registryKind);
        // Bit-perfect Hi-Fi Cable: only the live MixFormat matters. Registry blobs can
        // claim 48 kHz while MixFormat is still 384 kHz — that combination is silent.
        var atStudioQuality = format is not null && HifiCableFormat.IsEngineCleanFormat(format);

        return new HifiCableEndpointStatus
        {
            DeviceName = endpoint.FriendlyName,
            SampleRate = format?.SampleRate ?? 0,
            BitsPerSample = format is null
                ? 0
                : HifiCableFormat.IsEngineCleanFormat(format)
                    ? HifiCableFormat.HiFiEngineBitsPerSample
                    : WaveFormatUtility.GetEffectiveBitsPerSample(format),
            ExclusiveModeEnabled = exclusiveMode,
            AtStudioQuality = atStudioQuality,
            FormatLabel = format is null
                ? "unknown format"
                : HifiCableFormat.DescribeDeviceFormat(format),
        };
    }

    private static WaveFormat? TryReadEndpointFormat(MMDevice endpoint)
    {
        try
        {
            return endpoint.AudioClient.MixFormat;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsExclusiveModeEnabled(string endpointId, string registryKind)
    {
        var guid = ExtractEndpointGuid(endpointId);
        if (guid is null)
        {
            return false;
        }

        var propertiesPath =
            $@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{registryKind}\{{{guid}}}\Properties";

        var exclusive = Registry.GetValue(propertiesPath, HifiCableStudioFormatBlob.ExclusiveModePropertyName, 0);
        var priority = Registry.GetValue(propertiesPath, HifiCableStudioFormatBlob.ExclusivePriorityPropertyName, 0);
        return Convert.ToInt32(exclusive) != 0 && Convert.ToInt32(priority) != 0;
    }

    private static MMDevice? FindEndpoint(MMDeviceEnumerator enumerator, DataFlow flow)
    {
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            if (!HifiCableFormat.IsHifiCableDevice(endpoint.FriendlyName))
            {
                continue;
            }

            if (flow == DataFlow.Render && !IsPlaybackEndpoint(endpoint.FriendlyName))
            {
                continue;
            }

            if (flow == DataFlow.Capture && !IsRecordingEndpoint(endpoint.FriendlyName))
            {
                continue;
            }

            return endpoint;
        }

        return null;
    }

    private static bool IsPlaybackEndpoint(string deviceName)
    {
        return deviceName.Contains("Input", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRecordingEndpoint(string deviceName)
    {
        return deviceName.Contains("Output", StringComparison.OrdinalIgnoreCase);
    }

    private static void ConfigureEndpoint(IPolicyConfig policyConfig, MMDevice endpoint, string registryKind)
    {
        if (string.Equals(registryKind, "Capture", StringComparison.OrdinalIgnoreCase))
        {
            HifiCableListenThrough.Disable(endpoint);
            HifiCableEndpointVolume.EnsureCaptureUnmuted(endpoint);
        }
        else
        {
            HifiCableEndpointVolume.EnsurePlaybackAudible(endpoint);
        }

        if (IsEngineMatchedQuality(endpoint))
        {
            _ = TryApplyRegistryStudioFormat(endpoint.ID, registryKind);
            TryDisableExclusiveMode(policyConfig, endpoint.ID, registryKind);
            return;
        }

        Exception? lastError = null;

        // Registry write first (persists Default Format), then PolicyConfig with real WAVEFORMATEX.
        _ = TryApplyRegistryStudioFormat(endpoint.ID, registryKind);

        var pointers = PolicyConfigInterop
            .CreateRawStudioFormatPointers(
                HifiCableFormat.EngineCleanSampleRate,
                HifiCableFormat.HiFiEngineBitsPerSample,
                HifiCableFormat.MaxChannels)
            .ToList();

        try
        {
            foreach (var formatPointer in pointers)
            {
                var result = policyConfig.SetDeviceFormat(endpoint.ID, formatPointer, formatPointer);
                if (result >= 0 && IsEngineMatchedQuality(endpoint))
                {
                    TryDisableExclusiveMode(policyConfig, endpoint.ID, registryKind);
                    return;
                }

                if (result < 0)
                {
                    lastError = new InvalidOperationException(
                        $"Set clean format on {endpoint.FriendlyName} failed (HRESULT 0x{result:X8}).");
                }
            }
        }
        finally
        {
            foreach (var pointer in pointers)
            {
                PolicyConfigInterop.FreeFormatPointer(pointer);
            }
        }

        // Re-read after registry + PolicyConfig — MixFormat is the only truth.
        if (IsEngineMatchedQuality(endpoint))
        {
            TryDisableExclusiveMode(policyConfig, endpoint.ID, registryKind);
            return;
        }

        var live = TryReadEndpointFormat(endpoint);
        var liveLabel = live is null ? "unknown" : HifiCableFormat.DescribeDeviceFormat(live);
        throw lastError ??
              new InvalidOperationException(
                  $"Set clean audio format on {endpoint.FriendlyName} failed (still {liveLabel}). " +
                  $"Open Windows Sound → Advanced and set both Hi-Fi Cable Input and Output to " +
                  $"{HifiCableFormat.HiFiEngineBitsPerSample} bit, {HifiCableFormat.EngineCleanSampleRate} Hz, then Refresh.");
    }

    /// <summary>Live MixFormat must be 48 kHz clean — registry alone is not enough.</summary>
    private static bool IsEngineMatchedQuality(MMDevice endpoint)
    {
        try
        {
            var format = endpoint.AudioClient.MixFormat;
            return HifiCableFormat.IsEngineCleanFormat(format) ||
                   (format.SampleRate == HifiCableFormat.EngineCleanSampleRate &&
                    format.Channels == HifiCableFormat.MaxChannels &&
                    WaveFormatUtility.GetEffectiveBitsPerSample(format) >= HifiCableFormat.HiFiEngineBitsPerSample);
        }
        catch
        {
            return false;
        }
    }

    private static bool HasRegistryStudioFormat(string endpointId, string registryKind)
    {
        var blob = ReadRegistryFormatBlob(endpointId, registryKind);
        var matches = blob is not null && MatchesStudioFormatBlob(blob);
        return matches;
    }

    private static byte[]? ReadRegistryFormatBlob(string endpointId, string registryKind)
    {
        var guid = ExtractEndpointGuid(endpointId);
        if (guid is null)
        {
            return null;
        }

        var propertiesPath =
            $@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{registryKind}\{{{guid}}}\Properties";

        return Registry.GetValue(propertiesPath, HifiCableStudioFormatBlob.DeviceFormatPropertyName, null) as byte[];
    }

    private static bool MatchesStudioFormatBlob(byte[] blob)
    {
        if (blob.Length < 24)
        {
            return false;
        }

        var formatOffset = blob.Length >= 48 ? 8 : 0;
        if (blob.Length < formatOffset + 18)
        {
            return false;
        }

        var sampleRate = BitConverter.ToUInt32(blob, formatOffset + 4);
        var bitsPerSample = BitConverter.ToUInt16(blob, formatOffset + 14);
        var channels = BitConverter.ToUInt16(blob, formatOffset + 2);

        return sampleRate == HifiCableFormat.EngineCleanSampleRate &&
               bitsPerSample >= HifiCableFormat.HiFiEngineBitsPerSample &&
               channels == HifiCableFormat.MaxChannels;
    }

    private static bool TryApplyRegistryStudioFormat(string endpointId, string registryKind)
    {
        var guid = ExtractEndpointGuid(endpointId);
        if (guid is null)
        {
            return false;
        }

        var propertiesPath =
            $@"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{registryKind}\{{{guid}}}\Properties";

        try
        {
            using var propertiesKey = Registry.LocalMachine.OpenSubKey(propertiesPath, writable: true);
            if (propertiesKey is null)
            {
                return false;
            }

            propertiesKey.SetValue(
                HifiCableStudioFormatBlob.DeviceFormatPropertyName,
                HifiCableStudioFormatBlob.RegistryPropertyBlob,
                RegistryValueKind.Binary);
            // Shared mode — Discord/OBS capture Hi-Fi Cable Output without exclusive steal.
            propertiesKey.SetValue(HifiCableStudioFormatBlob.ExclusiveModePropertyName, 0, RegistryValueKind.DWord);
            propertiesKey.SetValue(HifiCableStudioFormatBlob.ExclusivePriorityPropertyName, 0, RegistryValueKind.DWord);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Force shared mode for Hi-Fi Cable. Discord/OBS and our Output keep-alive need shared
    /// capture; exclusive-allowed flags in Windows Sound often leave the cable silent.
    /// </summary>
    private static void TryDisableExclusiveMode(IPolicyConfig policyConfig, string endpointId, string registryKind)
    {
        // PolicyConfig share mode: 0 = shared.
        try
        {
            var shared = 0;
            _ = policyConfig.SetShareMode(endpointId, ref shared);
        }
        catch
        {
            // Older PolicyConfig hosts may reject SetShareMode.
        }

        TrySetExclusiveProperty(policyConfig, endpointId, propertyId: 5, value: 0);
        TrySetExclusiveProperty(policyConfig, endpointId, propertyId: 6, value: 0);

        var guid = ExtractEndpointGuid(endpointId);
        if (guid is null)
        {
            return;
        }

        var propertiesPath =
            $@"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{registryKind}\{{{guid}}}\Properties";

        try
        {
            using var propertiesKey = Registry.LocalMachine.OpenSubKey(propertiesPath, writable: true);
            if (propertiesKey is null)
            {
                return;
            }

            propertiesKey.SetValue(HifiCableStudioFormatBlob.ExclusiveModePropertyName, 0, RegistryValueKind.DWord);
            propertiesKey.SetValue(HifiCableStudioFormatBlob.ExclusivePriorityPropertyName, 0, RegistryValueKind.DWord);
        }
        catch
        {
            // Registry writes can require elevation — PolicyConfig path above still helps.
        }
    }

    private static void TrySetExclusiveProperty(IPolicyConfig policyConfig, string endpointId, int propertyId, uint value)
    {
        try
        {
            var key = new PolicyPropertyKey
            {
                FormatId = new Guid("1da5d803-d492-4edd-8c48-e04b1dcbe66a"),
                PropertyId = propertyId,
            };
            var prop = new PolicyPropVariant
            {
                VariantType = 19, // VT_UI4
                UIntValue = value,
            };
            _ = policyConfig.SetPropertyValue(endpointId, false, ref key, ref prop);
        }
        catch
        {
            // Property writes are best-effort.
        }
    }

    private static string? ExtractEndpointGuid(string endpointId)
    {
        var match = EndpointGuidPattern().Match(endpointId);
        return match.Success ? match.Groups[1].Value : null;
    }

    [GeneratedRegex(@"\{[0-9.]+}\.\{([0-9a-fA-F\-]+)\}")]
    private static partial Regex EndpointGuidPattern();
}

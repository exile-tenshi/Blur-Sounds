using System.Runtime.InteropServices;
using Microsoft.Win32;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace VoiceMeeterEngine;

/// <summary>
/// Windows "Listen to this device" on Hi-Fi Cable Output routes the full cable mix
/// to Speakers/Headphones. Blur Sounds keeps that off — the mix is for Discord/OBS,
/// not local monitoring.
/// </summary>
internal static class HifiCableListenThrough
{
    private static readonly Guid ListenSettingsGuid = new("24DBB0FC-9311-4B3D-9CF0-18FF155639D4");
    private const int ListenTargetPropertyId = 0;
    private const int ListenEnabledPropertyId = 1;
    private const VarEnum VariantBool = VarEnum.VT_BOOL;
    private const VarEnum VariantEmpty = VarEnum.VT_EMPTY;

    public static bool IsListenEnabled(MMDevice device)
    {
        try
        {
            var key = new PropertyKey(ListenSettingsGuid, ListenEnabledPropertyId);
            if (device.Properties.TryGetValue(key, out object? value) && value is bool enabled)
            {
                return enabled;
            }
        }
        catch
        {
            // Property may be absent when Listen was never touched.
        }

        return false;
    }

    /// <summary>
    /// Turns off Listen-to-this-device on a recording endpoint (Hi-Fi Cable Output).
    /// </summary>
    public static void Disable(MMDevice device)
    {
        _ = TryDisableViaPropertyStore(device);
        _ = TryDisableViaPolicyConfig(device.ID);
        _ = TryDisableViaRegistry(device.ID);
    }

    private static bool TryDisableViaPropertyStore(MMDevice device)
    {
        try
        {
            var store = device.Properties;
            var enabledKey = new PropertyKey(ListenSettingsGuid, ListenEnabledPropertyId);
            var targetKey = new PropertyKey(ListenSettingsGuid, ListenTargetPropertyId);

            var falseVariant = new PropVariant
            {
                vt = (short)VariantBool,
                boolVal = 0,
            };
            store.SetValue(enabledKey, falseVariant);

            var emptyVariant = new PropVariant
            {
                vt = (short)VariantEmpty,
            };
            store.SetValue(targetKey, emptyVariant);
            store.Commit();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryDisableViaPolicyConfig(string endpointId)
    {
        try
        {
            var policy = PolicyConfigInterop.CreatePolicyConfig();
            var enabledKey = new PolicyPropertyKey
            {
                FormatId = ListenSettingsGuid,
                PropertyId = ListenEnabledPropertyId,
            };
            var enabledValue = new PolicyPropVariant
            {
                VariantType = (ushort)VariantBool,
                UIntValue = 0,
            };
            var enabledHr = policy.SetPropertyValue(endpointId, false, ref enabledKey, ref enabledValue);
            var enabledFxHr = policy.SetPropertyValue(endpointId, true, ref enabledKey, ref enabledValue);

            var targetKey = new PolicyPropertyKey
            {
                FormatId = ListenSettingsGuid,
                PropertyId = ListenTargetPropertyId,
            };
            var emptyValue = new PolicyPropVariant
            {
                VariantType = (ushort)VariantEmpty,
                UIntValue = 0,
            };
            var targetHr = policy.SetPropertyValue(endpointId, false, ref targetKey, ref emptyValue);
            var targetFxHr = policy.SetPropertyValue(endpointId, true, ref targetKey, ref emptyValue);

            return enabledHr == 0 || enabledFxHr == 0 || targetHr == 0 || targetFxHr == 0;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryDisableViaRegistry(string endpointId)
    {
        var guid = ExtractEndpointGuid(endpointId);
        if (guid is null)
        {
            return false;
        }

        var written = false;
        // Listen lives under Capture\{guid}\FxProperties for recording endpoints.
        var path =
            $@"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\{{{guid}}}\FxProperties";
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(path, writable: true);
            if (key is null)
            {
                return false;
            }

            // PROPVARIANT VT_BOOL=false serialized for MMDevices (vt + padding + bool16).
            key.SetValue(
                "{24dbb0fc-9311-4b3d-9cf0-18ff155639d4},1",
                new byte[]
                {
                    0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                },
                RegistryValueKind.Binary);
            try
            {
                key.DeleteValue("{24dbb0fc-9311-4b3d-9cf0-18ff155639d4},0", throwOnMissingValue: false);
            }
            catch
            {
                // Target playback device value may be absent.
            }

            written = true;
        }
        catch
        {
            // Elevation may be required for HKLM writes.
        }

        return written;
    }

    private static string? ExtractEndpointGuid(string endpointId)
    {
        var start = endpointId.LastIndexOf('{');
        var end = endpointId.LastIndexOf('}');
        if (start < 0 || end <= start)
        {
            return null;
        }

        return endpointId.Substring(start + 1, end - start - 1);
    }
}

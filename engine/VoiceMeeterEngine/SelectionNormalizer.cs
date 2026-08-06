namespace VoiceMeeterEngine;

internal sealed class MicrophoneSlotConfig
{
    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string SlotId { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("deviceId")]
    public string? MicrophoneId { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("muted")]
    public bool Muted { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("volume")]
    public float Volume { get; set; } = 1f;

    [System.Text.Json.Serialization.JsonPropertyName("noiseSuppression")]
    public bool NoiseSuppression { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("noiseSuppressionSettings")]
    public NoiseSuppressionSettingsConfig? NoiseSuppressionSettings { get; set; }
}

internal sealed class NoiseSuppressionSettingsConfig
{
    [System.Text.Json.Serialization.JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("strength")]
    public float Strength { get; set; } = 70f;

    [System.Text.Json.Serialization.JsonPropertyName("threshold")]
    public float Threshold { get; set; } = 55f;

    [System.Text.Json.Serialization.JsonPropertyName("highPassHz")]
    public float HighPassHz { get; set; } = 85f;

    [System.Text.Json.Serialization.JsonPropertyName("attack")]
    public float Attack { get; set; } = 55f;

    [System.Text.Json.Serialization.JsonPropertyName("release")]
    public float Release { get; set; } = 40f;

    [System.Text.Json.Serialization.JsonPropertyName("noiseGateEnabled")]
    public bool NoiseGateEnabled { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("noiseGateThreshold")]
    public float NoiseGateThreshold { get; set; } = 35f;

    [System.Text.Json.Serialization.JsonPropertyName("compressorEnabled")]
    public bool CompressorEnabled { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("compressorLevel")]
    public float CompressorLevel { get; set; } = 30f;
}

internal static class SelectionNormalizer
{
    public static List<MicrophoneSlotConfig> GetMicrophoneSlotSettings(DeviceSelection selection)
    {
        if (selection.Microphones.Count > 0)
        {
            return selection.Microphones;
        }

        if (string.IsNullOrWhiteSpace(selection.MicrophoneId))
        {
            return [];
        }

        return
        [
            new MicrophoneSlotConfig
            {
                SlotId = "legacy",
                MicrophoneId = selection.MicrophoneId,
                Muted = selection.MicrophoneMuted,
                Volume = selection.MicrophoneVolume,
            },
        ];
    }

    public static List<MicrophoneSlotConfig> GetMicrophoneSlots(DeviceSelection selection)
    {
        if (selection.Microphones.Count > 0)
        {
            return selection.Microphones
                .Where(slot => !string.IsNullOrWhiteSpace(slot.MicrophoneId))
                .ToList();
        }

        if (string.IsNullOrWhiteSpace(selection.MicrophoneId))
        {
            return [];
        }

        return
        [
            new MicrophoneSlotConfig
            {
                SlotId = "legacy",
                MicrophoneId = selection.MicrophoneId,
                Muted = selection.MicrophoneMuted,
                Volume = selection.MicrophoneVolume,
            },
        ];
    }

    public static bool MicrophonesChanged(DeviceSelection previous, DeviceSelection next)
    {
        var left = GetMicrophoneBindings(previous);
        var right = GetMicrophoneBindings(next);
        if (left.Count != right.Count)
        {
            return true;
        }

        foreach (var (slotId, deviceId) in left)
        {
            if (!right.TryGetValue(slotId, out var nextDeviceId) ||
                !string.Equals(deviceId, nextDeviceId, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static Dictionary<string, string?> GetMicrophoneBindings(DeviceSelection selection)
    {
        var bindings = new Dictionary<string, string?>(StringComparer.Ordinal);

        if (selection.Microphones.Count > 0)
        {
            foreach (var slot in selection.Microphones)
            {
                bindings[slot.SlotId] = slot.MicrophoneId;
            }

            return bindings;
        }

        bindings["legacy"] = selection.MicrophoneId;
        return bindings;
    }
}

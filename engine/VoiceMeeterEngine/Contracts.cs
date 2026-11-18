using System.Text.Json.Serialization;

namespace VoiceMeeterEngine;

internal sealed class EngineCommand
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public EnginePayload Payload { get; set; } = new();
}

internal sealed class EnginePayload
{
    [JsonPropertyName("selection")]
    public DeviceSelection Selection { get; set; } = new();

    [JsonPropertyName("routes")]
    public List<RouteConfig> Routes { get; set; } = [];

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }
}

internal sealed class DeviceSelection
{
    [JsonPropertyName("microphones")]
    public List<MicrophoneSlotConfig> Microphones { get; set; } = [];

    [JsonPropertyName("microphoneId")]
    public string? MicrophoneId { get; set; }

    [JsonPropertyName("inputDeviceId")]
    public string? InputDeviceId { get; set; }

    [JsonPropertyName("microphoneMuted")]
    public bool MicrophoneMuted { get; set; }

    [JsonPropertyName("microphoneVolume")]
    public float MicrophoneVolume { get; set; } = 1f;
}

internal sealed class RouteConfig
{
    [JsonPropertyName("routeId")]
    public string RouteId { get; set; } = string.Empty;

    [JsonPropertyName("appId")]
    public string AppId { get; set; } = string.Empty;

    [JsonPropertyName("processName")]
    public string? ProcessName { get; set; }

    [JsonPropertyName("target")]
    public string Target { get; set; } = string.Empty;

    [JsonPropertyName("volume")]
    public float Volume { get; set; }

    [JsonPropertyName("muted")]
    public bool Muted { get; set; }

    [JsonPropertyName("eqEnabled")]
    public bool EqEnabled { get; set; } = true;

    [JsonPropertyName("band60Db")]
    public float Band60Db { get; set; }

    [JsonPropertyName("band150Db")]
    public float Band150Db { get; set; }

    [JsonPropertyName("band400Db")]
    public float Band400Db { get; set; }

    [JsonPropertyName("band1000Db")]
    public float Band1000Db { get; set; }

    [JsonPropertyName("band2400Db")]
    public float Band2400Db { get; set; }

    [JsonPropertyName("band15000Db")]
    public float Band15000Db { get; set; }
}

internal sealed class EngineEvent
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "telemetry";

    [JsonPropertyName("payload")]
    public EngineTelemetry Payload { get; set; } = new();
}

internal sealed class EngineTelemetry
{
    [JsonPropertyName("state")]
    public string State { get; set; } = "stopped";

    [JsonPropertyName("helperConnected")]
    public bool HelperConnected { get; set; } = true;

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("latencyMs")]
    public int LatencyMs { get; set; } = 20;

    [JsonPropertyName("underrunCount")]
    public int UnderrunCount { get; set; }

    [JsonPropertyName("selectedMicrophoneReady")]
    public bool SelectedMicrophoneReady { get; set; }

    [JsonPropertyName("selectedInputReady")]
    public bool SelectedInputReady { get; set; }

    [JsonPropertyName("hifiOutputActive")]
    public bool HifiOutputActive { get; set; } = true;

    [JsonPropertyName("hifiOutputError")]
    public string? HifiOutputError { get; set; }

    [JsonPropertyName("hifiListenActive")]
    public bool HifiListenActive { get; set; }

    [JsonPropertyName("hifiListenDeviceName")]
    public string? HifiListenDeviceName { get; set; }

    [JsonPropertyName("hifiListenError")]
    public string? HifiListenError { get; set; }

    [JsonPropertyName("hifiListenLevel")]
    public float HifiListenLevel { get; set; }

    [JsonPropertyName("outputLevel")]
    public float OutputLevel { get; set; }

    [JsonPropertyName("outputPullLevel")]
    public float OutputPullLevel { get; set; }

    [JsonPropertyName("mixPullLevel")]
    public float MixPullLevel { get; set; }

    [JsonPropertyName("microphoneLevel")]
    public float MicrophoneLevel { get; set; }

    [JsonPropertyName("sessionLevels")]
    public List<SessionLevelTelemetry> SessionLevels { get; set; } = [];

    [JsonPropertyName("routes")]
    public List<RouteTelemetry> Routes { get; set; } = [];

    [JsonPropertyName("audioFormat")]
    public AudioFormatTelemetry? AudioFormat { get; set; }
}

internal sealed class AudioFormatTelemetry
{
    [JsonPropertyName("mixSampleRate")]
    public int MixSampleRate { get; set; }

    [JsonPropertyName("streamSampleRate")]
    public int StreamSampleRate { get; set; }

    [JsonPropertyName("deviceSampleRate")]
    public int DeviceSampleRate { get; set; }

    [JsonPropertyName("deviceBitsPerSample")]
    public int DeviceBitsPerSample { get; set; }

    [JsonPropertyName("outputBinding")]
    public string OutputBinding { get; set; } = string.Empty;

    [JsonPropertyName("renderError")]
    public string? RenderError { get; set; }

    [JsonPropertyName("underrunCount")]
    public int UnderrunCount { get; set; }

    [JsonPropertyName("policy")]
    public string Policy { get; set; } = string.Empty;
}

internal sealed class SessionLevelTelemetry
{
    [JsonPropertyName("processId")]
    public int ProcessId { get; set; }

    [JsonPropertyName("peak")]
    public float Peak { get; set; }
}

internal sealed class RouteTelemetry
{
    [JsonPropertyName("appId")]
    public string AppId { get; set; } = string.Empty;

    [JsonPropertyName("level")]
    public float Level { get; set; }

    [JsonPropertyName("state")]
    public string State { get; set; } = "detached";

    [JsonPropertyName("lastError")]
    public string? LastError { get; set; }
}

internal sealed class AudioEndpointInfo
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    [JsonPropertyName("endpointId")]
    public string EndpointId { get; set; } = string.Empty;

    [JsonPropertyName("isAvailable")]
    public bool IsAvailable { get; set; } = true;

    [JsonPropertyName("isDefault")]
    public bool IsDefault { get; set; }
}

internal sealed class DevicesEventPayload
{
    [JsonPropertyName("devices")]
    public List<AudioEndpointInfo> Devices { get; set; } = [];
}


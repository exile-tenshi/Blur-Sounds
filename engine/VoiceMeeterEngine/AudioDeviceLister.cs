using NAudio.CoreAudioApi;

namespace VoiceMeeterEngine;

internal static class AudioDeviceLister
{
    public static List<AudioEndpointInfo> ListActiveEndpoints()
    {
        using var enumerator = new MMDeviceEnumerator();
        var devices = new List<AudioEndpointInfo>();

        AddEndpoints(enumerator, devices, DataFlow.Capture, "input");
        AddEndpoints(enumerator, devices, DataFlow.Render, "output");

        return devices;
    }

    private static void AddEndpoints(
        MMDeviceEnumerator enumerator,
        List<AudioEndpointInfo> devices,
        DataFlow flow,
        string kind)
    {
        MMDevice? defaultEndpoint = null;

        try
        {
            defaultEndpoint = enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia);
        }
        catch
        {
            // No default endpoint for this flow.
        }

        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(
                     flow,
                     DeviceState.Active | DeviceState.Unplugged | DeviceState.Disabled))
        {
            devices.Add(new AudioEndpointInfo
            {
                Name = endpoint.FriendlyName,
                Kind = kind,
                EndpointId = endpoint.ID,
                IsAvailable = endpoint.State == DeviceState.Active,
                IsDefault = defaultEndpoint is not null &&
                            string.Equals(defaultEndpoint.ID, endpoint.ID, StringComparison.Ordinal),
            });
        }
    }
}

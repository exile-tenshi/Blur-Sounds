using NAudio.Wave;

namespace VoiceMeeterEngine;

internal sealed record AsioBinding(
    string DriverName,
    int OutputChannelOffset,
    int OutputChannelCount)
{
    public string DescribeChannels()
    {
        if (OutputChannelCount <= 1)
        {
            return $"ch {OutputChannelOffset}";
        }

        return $"ch {OutputChannelOffset}-{OutputChannelOffset + OutputChannelCount - 1}";
    }
}

internal static class AsioDriverSelector
{
    public static bool IsAvailable()
    {
        return AsioOut.isSupported();
    }

    public static string[] GetInstalledDriverNames()
    {
        return AsioOut.GetDriverNames();
    }

    public static string ResolveDriverName()
    {
        var names = GetInstalledDriverNames();
        if (names.Length == 0)
        {
            throw new InvalidOperationException(
                "No ASIO driver is installed. Install ASIO4ALL (https://asio4all.org) and enable Hi-Fi Cable Input in the ASIO4ALL control panel.");
        }

        return names.FirstOrDefault(IsPreferredDriver)
            ?? names[0];
    }

    public static AsioBinding ResolveBinding(string targetDeviceName)
    {
        var driverName = ResolveDriverName();
        using var probe = new AsioOut(driverName);
        var channelOffset = ResolveOutputChannelOffset();
        var channelCount = EngineAudioFormat.Channels;

        if (channelOffset + channelCount > probe.DriverOutputChannelCount)
        {
            throw new InvalidOperationException(
                $"ASIO driver \"{driverName}\" does not expose enough output channels for {targetDeviceName}. " +
                $"Need channels {channelOffset}-{channelOffset + channelCount - 1}, but only {probe.DriverOutputChannelCount} are available. " +
                "Open ASIO4ALL and enable Hi-Fi Cable Input.");
        }

        if (!probe.IsSampleRateSupported(EngineAudioFormat.SampleRate))
        {
            throw new InvalidOperationException(
                $"ASIO driver \"{driverName}\" does not support {EngineAudioFormat.SampleRate} Hz. " +
                "Set Hi-Fi Cable and ASIO4ALL to the same sample rate.");
        }

        return new AsioBinding(driverName, channelOffset, channelCount);
    }

    public static int ResolveOutputChannelOffset() => 0;

    private static bool IsPreferredDriver(string driverName)
    {
        return driverName.Contains("ASIO4ALL", StringComparison.OrdinalIgnoreCase)
            || driverName.Contains("ASIO2KS", StringComparison.OrdinalIgnoreCase);
    }
}

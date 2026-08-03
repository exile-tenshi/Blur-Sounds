using System.Text.Json;

namespace VoiceMeeterEngine;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static async Task Main(string[] args)
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        if (args.Any(arg => string.Equals(arg, "--configure-hifi", StringComparison.OrdinalIgnoreCase)))
        {
            Console.WriteLine(HifiCableFormatConfigurator.ApplyStudioQuality().Message);
            return;
        }

        if (args.Any(arg => string.Equals(arg, "--probe-hifi", StringComparison.OrdinalIgnoreCase)))
        {
            Console.WriteLine(HifiCableOutputProbe.Run());
            return;
        }

        using var engine = new AudioEngine();
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));

        var telemetryTask = Task.Run(async () =>
        {
            var recoveryCounter = 0;
            while (await timer.WaitForNextTickAsync())
            {
                recoveryCounter += 1;
                // Recover stuck loopbacks about every 5 seconds.
                if (recoveryCounter % 10 == 0)
                {
                    await engine.RecoverLoopbackSourcesAsync();
                }

                await PublishAsync(engine.GetTelemetry());
            }
        });

        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var command = JsonSerializer.Deserialize<EngineCommand>(line, JsonOptions);
                if (command is null)
                {
                    continue;
                }

                var commandType = command.Type;

                switch (commandType)
                {
                    case "sync":
                        await engine.ApplyAsync(command.Payload.Selection, command.Payload.Routes);
                        break;
                    case "syncRoutes":
                        await engine.ApplyRoutesAsync(command.Payload.Selection, command.Payload.Routes);
                        break;
                    case "start":
                        await engine.ApplyAsync(command.Payload.Selection, command.Payload.Routes);
                        await engine.StartAsync();
                        break;
                    case "updateVolumes":
                        await engine.UpdateRouteMixAsync(command.Payload.Selection, command.Payload.Routes);
                        break;
                    case "stop":
                        await engine.StopAsync();
                        break;
                    case "listDevices":
                        await PublishDevicesAsync();
                        break;
                    case "configureHifiCable":
                        await PublishHifiCableFormatAsync();
                        await engine.RebindOutputIfRunningAsync();
                        break;
                    case "probeHifiOutput":
                        await PublishProbeAsync(HifiCableOutputProbe.Run());
                        break;
                }

                await PublishAsync(engine.GetTelemetry());
            }
            catch (Exception ex)
            {
                var telemetry = engine.GetTelemetry();
                telemetry.Message = ex.Message;
                await PublishAsync(telemetry);
            }
        }

        timer.Dispose();
        await telemetryTask;
    }

    private static async Task PublishProbeAsync(string report)
    {
        var payload = new
        {
            type = "probe",
            payload = new
            {
                report,
            },
        };

        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(payload, JsonOptions));
        await Console.Out.FlushAsync();
    }

    private static async Task PublishHifiCableFormatAsync()
    {
        var result = HifiCableFormatConfigurator.ApplyStudioQuality();
        var payload = new
        {
            type = "hifiCableFormat",
            payload = new
            {
                playbackConfigured = result.PlaybackConfigured,
                recordingConfigured = result.RecordingConfigured,
                playbackDeviceName = result.PlaybackDeviceName,
                recordingDeviceName = result.RecordingDeviceName,
                playbackStatus = MapEndpointStatus(result.PlaybackStatus),
                recordingStatus = MapEndpointStatus(result.RecordingStatus),
                message = result.Message,
            },
        };

        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(payload, JsonOptions));
        await Console.Out.FlushAsync();
    }

    private static object? MapEndpointStatus(HifiCableEndpointStatus? status)
    {
        if (status is null)
        {
            return null;
        }

        return new
        {
            deviceName = status.DeviceName,
            sampleRate = status.SampleRate,
            bitsPerSample = status.BitsPerSample,
            exclusiveModeEnabled = status.ExclusiveModeEnabled,
            atStudioQuality = status.AtStudioQuality,
            formatLabel = status.FormatLabel,
        };
    }

    private static async Task PublishDevicesAsync()
    {
        var payload = new
        {
            type = "devices",
            payload = new DevicesEventPayload
            {
                Devices = AudioDeviceLister.ListActiveEndpoints(),
            },
        };

        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(payload, JsonOptions));
        await Console.Out.FlushAsync();
    }

    private static async Task PublishAsync(EngineTelemetry telemetry)
    {
        var payload = new EngineEvent
        {
            Type = "telemetry",
            Payload = telemetry,
        };

        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(payload, JsonOptions));
        await Console.Out.FlushAsync();
    }
}

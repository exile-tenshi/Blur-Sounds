using System.Text;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal static class HifiCableOutputProbe
{
    public static string Run(int durationMilliseconds = 2500)
    {
        using var enumerator = new MMDeviceEnumerator();
        var playback = FindPlayback(enumerator);
        var recording = FindRecording(enumerator);

        if (playback is null)
        {
            return "Hi-Fi Cable Input was not found.";
        }

        var report = new StringBuilder();
        report.AppendLine($"Playback: {playback.FriendlyName}");
        report.AppendLine($"Recording: {recording?.FriendlyName ?? "not found"}");

        WaveFormat? mixFormat = null;
        try
        {
            mixFormat = playback.AudioClient.MixFormat;
            report.AppendLine(
                $"MixFormat: {mixFormat.SampleRate} Hz, {mixFormat.BitsPerSample}-bit, {mixFormat.Channels} ch, {mixFormat.Encoding}");
        }
        catch (Exception ex)
        {
            report.AppendLine($"MixFormat unavailable: {ex.Message}");
        }

        var attempts = HifiCableOutputBindPlanner.GetAttempts(playback, playback.FriendlyName);
        report.AppendLine($"Bind attempts: {attempts.Count}");

        var tone = new SignalGenerator(
            HifiStreamingPolicy.EngineMixSampleRate,
            EngineAudioFormat.Channels)
        {
            Type = SignalGeneratorType.Sin,
            Frequency = 440,
            Gain = 0.35,
        };

        Exception? lastError = null;
        using var enumerator = new MMDeviceEnumerator();
        foreach (var attempt in attempts)
        {
            WasapiOutBroadcast? render = null;
            WasapiCapture? capture = null;
            MMDevice? attemptPlayback = null;
            var capturedPeak = 0f;
            try
            {
                attemptPlayback = enumerator.GetDevice(playback.ID);
                HifiCableEndpointVolume.EnsureAudible(attemptPlayback);

                ISampleProvider outputSource = attempt.Format.SampleRate == HifiStreamingPolicy.EngineMixSampleRate
                    ? tone
                    : new StudioRateOutputSampleProvider(tone, attempt.Format.SampleRate);
                var waveProvider = new PeakReportingWaveProvider(
                    OutputWaveProviderFactory.Create(outputSource, attempt.Format));
                render = new WasapiOutBroadcast();
                render.Configure(
                    attemptPlayback,
                    waveProvider,
                    LatencyTuning.HiFiOutputLatencyMilliseconds,
                    useEventSync: false);
                attemptPlayback = null;

                if (recording is not null)
                {
                    capture = new WasapiCapture(recording)
                    {
                        ShareMode = AudioClientShareMode.Shared,
                    };
                    capture.DataAvailable += (_, args) =>
                    {
                        if (args.BytesRecorded <= 0)
                        {
                            return;
                        }

                        var peak = AudioLevelUtility.ComputePeak(args.Buffer, args.BytesRecorded, capture.WaveFormat);
                        capturedPeak = Math.Max(capturedPeak, peak);
                    };
                    capture.StartRecording();
                }

                OutputPullMeter.Reset();
                render.Play();
                var recordMeterPeak = 0f;
                var deadline = DateTime.UtcNow.AddMilliseconds(durationMilliseconds);
                while (DateTime.UtcNow < deadline)
                {
                    if (recording is not null)
                    {
                        try
                        {
                            recordMeterPeak = Math.Max(recordMeterPeak, recording.AudioMeterInformation.MasterPeakValue);
                        }
                        catch
                        {
                            // Recording meter may be unavailable while playback holds the device.
                        }
                    }

                    Thread.Sleep(50);
                }

                var peak = OutputPullMeter.Peak;
                render.Stop();
                capture?.StopRecording();

                report.AppendLine(
                    $"OK WasapiOut {DescribeFormat(attempt.Format)} pullPeak={peak:0.000} meterPeak={recordMeterPeak:0.000} capturePeak={capturedPeak:0.000}");

                if (peak > 0.001f && (capturedPeak > 0.001f || recordMeterPeak > 0.001f))
                {
                    return report.ToString().Trim();
                }
            }
            catch (Exception ex)
            {
                lastError = ex;
                report.AppendLine($"FAIL WasapiOut {DescribeFormat(attempt.Format)}: {ex.Message}");
            }
            finally
            {
                capture?.Dispose();
                render?.Dispose();
                attemptPlayback?.Dispose();
            }
        }

        report.AppendLine(lastError is null
            ? "Playback pull worked but Hi-Fi Cable Output stayed silent on meter and capture."
            : $"Last error: {lastError.Message}");
        return report.ToString().Trim();
    }

    private static string DescribeFormat(WaveFormat format)
    {
        var encoding = WaveFormatUtility.IsFloatFormat(format) ? "float" : "pcm";
        return $"{format.SampleRate}Hz/{WaveFormatUtility.GetEffectiveBitsPerSample(format)}bit-{encoding}";
    }

    private static MMDevice? FindPlayback(MMDeviceEnumerator enumerator)
    {
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            if (HifiCableFormat.IsHifiCableDevice(endpoint.FriendlyName) &&
                endpoint.FriendlyName.Contains("Input", StringComparison.OrdinalIgnoreCase))
            {
                return endpoint;
            }
        }

        return null;
    }

    private static MMDevice? FindRecording(MMDeviceEnumerator enumerator)
    {
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            if (HifiCableFormat.IsHifiCableDevice(endpoint.FriendlyName) &&
                endpoint.FriendlyName.Contains("Output", StringComparison.OrdinalIgnoreCase))
            {
                return endpoint;
            }
        }

        return null;
    }
}

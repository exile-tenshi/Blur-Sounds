using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Plays a short tone into Hi-Fi Cable Input so Listen can confirm the Input→Output loop
/// when the stream is idle. Capture/monitor of Cable Output is owned by HifiCableListenMonitor.
/// </summary>
internal static class HifiCableListenTone
{
    public static void Play(int durationMilliseconds, CancellationToken cancellationToken)
    {
        using var enumerator = new MMDeviceEnumerator();
        var playback = FindCableInput(enumerator);
        if (playback is null)
        {
            return;
        }

        try
        {
            var attempts = HifiCableOutputBindPlanner.GetAttempts(playback, playback.FriendlyName);
            var tone = new SignalGenerator(
                HifiStreamingPolicy.EngineMixSampleRate,
                EngineAudioFormat.Channels)
            {
                Type = SignalGeneratorType.Sin,
                Frequency = 440,
                Gain = 0.28,
            };

            foreach (var attempt in attempts)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return;
                }

                WasapiOutBroadcast? output = null;
                MMDevice? attemptPlayback = null;
                try
                {
                    attemptPlayback = enumerator.GetDevice(playback.ID);
                    HifiCableEndpointVolume.EnsurePlaybackAudible(attemptPlayback);

                    var bindFormat = WaveFormatUtility.IsFloatFormat(attempt.Format)
                        ? attempt.Format
                        : WaveFormat.CreateIeeeFloatWaveFormat(
                            attempt.Format.SampleRate,
                            Math.Max(1, attempt.Format.Channels));

                    ISampleProvider outputSource = bindFormat.SampleRate == HifiStreamingPolicy.EngineMixSampleRate
                        ? tone
                        : new StudioRateOutputSampleProvider(tone, bindFormat.SampleRate);

                    var waveProvider = OutputWaveProviderFactory.Create(outputSource, bindFormat);
                    output = new WasapiOutBroadcast();
                    output.Configure(
                        attemptPlayback,
                        waveProvider,
                        LatencyTuning.HiFiOutputLatencyMilliseconds,
                        useEventSync: false);
                    attemptPlayback = null;

                    output.Play();
                    var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(400, durationMilliseconds));
                    while (DateTime.UtcNow < deadline)
                    {
                        if (cancellationToken.IsCancellationRequested)
                        {
                            break;
                        }

                        Thread.Sleep(40);
                    }

                    output.Stop();
                    return;
                }
                catch
                {
                    // Try the next Cable Input bind format.
                }
                finally
                {
                    output?.Dispose();
                    attemptPlayback?.Dispose();
                }
            }
        }
        finally
        {
            playback.Dispose();
        }
    }

    private static MMDevice? FindCableInput(MMDeviceEnumerator enumerator)
    {
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            if (HifiCableFormat.IsHifiCableDevice(endpoint.FriendlyName) &&
                endpoint.FriendlyName.Contains("Input", StringComparison.OrdinalIgnoreCase))
            {
                return endpoint;
            }

            endpoint.Dispose();
        }

        return null;
    }
}

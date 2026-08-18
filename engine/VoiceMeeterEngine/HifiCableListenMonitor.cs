using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Listen to Hi-Fi Cable Output on your speakers so you can hear what Discord hears.
/// Captures the cable recording endpoint (same path as keep-alive) and plays it on a
/// real render device — never Hi-Fi Cable Input, to avoid a loop.
/// </summary>
internal sealed class HifiCableListenMonitor : IDisposable
{
    private readonly object gate = new();
    private HifiCableOutputActivator? activator;
    private FifoCaptureBuffer? fifo;
    private WasapiOut? output;
    private MMDevice? playbackDevice;
    private WaveFormat? captureFormat;
    private string? playbackDeviceName;
    private string? lastError;
    private float peak;
    private bool active;

    public bool IsActive
    {
        get
        {
            lock (gate)
            {
                return active && output is not null;
            }
        }
    }

    public string? LastError
    {
        get
        {
            lock (gate)
            {
                return lastError;
            }
        }
    }

    public string? PlaybackDeviceName
    {
        get
        {
            lock (gate)
            {
                return playbackDeviceName;
            }
        }
    }

    public float Peak
    {
        get
        {
            lock (gate)
            {
                return peak;
            }
        }
    }

    public void Start(HifiCableOutputActivator source)
    {
        Stop();

        lock (gate)
        {
            activator = source;
            source.SamplesAvailable += OnSamples;
        }

        TryStartPlayback(source.CaptureWaveFormat);
    }

    public void Stop()
    {
        HifiCableOutputActivator? previous;
        lock (gate)
        {
            previous = activator;
            activator = null;
        }

        if (previous is not null)
        {
            previous.SamplesAvailable -= OnSamples;
        }

        TearDownPlayback();
    }

    public void Dispose()
    {
        Stop();
    }

    private void OnSamples(object? sender, WaveInEventArgs args)
    {
        if (args.BytesRecorded <= 0)
        {
            return;
        }

        var format = (sender as IWaveIn)?.WaveFormat;
        if (format is null)
        {
            return;
        }

        FifoCaptureBuffer? buffer;
        lock (gate)
        {
            if (output is null || fifo is null || captureFormat is null)
            {
                return;
            }

            if (!FormatsMatch(captureFormat, format))
            {
                return;
            }

            buffer = fifo;
            peak = Math.Max(peak * 0.72f, AudioLevelUtility.ComputePeak(args.Buffer, args.BytesRecorded, format));
        }

        buffer.Write(args.Buffer, 0, args.BytesRecorded);
    }

    private void TryStartPlayback(WaveFormat? format)
    {
        if (format is null)
        {
            lock (gate)
            {
                lastError =
                    "Hi-Fi Cable Output capture is not open. Enable Recording → Hi-Fi Cable Output, then try Listen again.";
                active = false;
            }

            return;
        }

        MMDevice? playback = null;
        WasapiOut? wasapiOut = null;
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            playback = FindMonitorPlayback(enumerator);
            if (playback is null)
            {
                lock (gate)
                {
                    lastError =
                        "No speakers or headphones found. Set Windows default playback to your headset — not Hi-Fi Cable Input.";
                    active = false;
                }

                return;
            }

            var fifoBuffer = new FifoCaptureBuffer(format, maxMilliseconds: 400, jitterBufferMilliseconds: 40);
            ISampleProvider source = new VolumeSampleProvider(fifoBuffer.CreateReader())
            {
                Volume = 0.85f,
            };

            WaveFormat mixFormat;
            try
            {
                mixFormat = playback.AudioClient.MixFormat;
            }
            catch
            {
                mixFormat = source.WaveFormat;
            }

            var bindFormat = WaveFormat.CreateIeeeFloatWaveFormat(
                mixFormat.SampleRate,
                Math.Max(1, mixFormat.Channels));
            var waveProvider = OutputWaveProviderFactory.Create(source, bindFormat);

            wasapiOut = new WasapiOut(
                playback,
                AudioClientShareMode.Shared,
                false,
                120);
            wasapiOut.Init(waveProvider);
            wasapiOut.Play();

            lock (gate)
            {
                fifo = fifoBuffer;
                captureFormat = format;
                output = wasapiOut;
                playbackDevice = playback;
                playbackDeviceName = playback.FriendlyName;
                lastError = null;
                peak = 0f;
                active = true;
            }

            playback = null;
            wasapiOut = null;
        }
        catch (Exception ex)
        {
            wasapiOut?.Dispose();
            playback?.Dispose();
            lock (gate)
            {
                fifo = null;
                captureFormat = null;
                output = null;
                playbackDevice = null;
                playbackDeviceName = null;
                active = false;
                lastError = $"Unable to play Hi-Fi Cable Output on speakers: {ex.Message}";
            }
        }
    }

    private void TearDownPlayback()
    {
        WasapiOut? previousOut;
        MMDevice? previousDevice;
        lock (gate)
        {
            previousOut = output;
            previousDevice = playbackDevice;
            output = null;
            playbackDevice = null;
            fifo = null;
            captureFormat = null;
            playbackDeviceName = null;
            lastError = null;
            peak = 0f;
            active = false;
        }

        try
        {
            previousOut?.Stop();
        }
        catch
        {
            // Ignore stop races.
        }

        previousOut?.Dispose();
        previousDevice?.Dispose();
    }

    private static bool FormatsMatch(WaveFormat left, WaveFormat right)
    {
        return left.SampleRate == right.SampleRate &&
               left.Channels == right.Channels &&
               left.Encoding == right.Encoding &&
               left.BitsPerSample == right.BitsPerSample;
    }

    private static MMDevice? FindMonitorPlayback(MMDeviceEnumerator enumerator)
    {
        foreach (var role in new[] { Role.Multimedia, Role.Console, Role.Communications })
        {
            try
            {
                var candidate = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, role);
                if (IsUsableMonitor(candidate))
                {
                    return candidate;
                }

                candidate.Dispose();
            }
            catch
            {
                // Default endpoint for this role may be missing.
            }
        }

        MMDevice? preferred = null;
        MMDevice? fallback = null;
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            if (!IsUsableMonitor(endpoint))
            {
                endpoint.Dispose();
                continue;
            }

            if (LooksLikeSpeakersOrHeadphones(endpoint.FriendlyName) && preferred is null)
            {
                preferred = endpoint;
                continue;
            }

            if (fallback is null)
            {
                fallback = endpoint;
                continue;
            }

            endpoint.Dispose();
        }

        if (preferred is not null)
        {
            fallback?.Dispose();
            return preferred;
        }

        return fallback;
    }

    private static bool IsUsableMonitor(MMDevice device) =>
        !HifiCableFormat.IsHifiCableDevice(device.FriendlyName);

    private static bool LooksLikeSpeakersOrHeadphones(string name)
    {
        return name.Contains("headphone", StringComparison.OrdinalIgnoreCase) ||
               name.Contains("headset", StringComparison.OrdinalIgnoreCase) ||
               name.Contains("speaker", StringComparison.OrdinalIgnoreCase) ||
               name.Contains("earphone", StringComparison.OrdinalIgnoreCase);
    }
}

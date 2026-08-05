using System.Runtime.InteropServices;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal sealed class AppLoopbackSource : IDisposable
{
    private readonly ProcessWasapiCapture capture;
    private readonly FifoCaptureBuffer captureBuffer;
    private readonly WaveFormat captureFormat;
    private readonly int captureSampleRate;
    private readonly FullBlockVolumeSampleProvider volumeProvider;
    private float baseVolume = 1f;
    private bool muted;

    private readonly int processId;
    private readonly int captureProcessId;
    private bool handlersAttached;
    private readonly EventHandler<StoppedEventArgs> recordingStoppedHandler;

    private AppLoopbackSource(
        ProcessWasapiCapture capture,
        FifoCaptureBuffer captureBuffer,
        WaveFormat captureFormat,
        FullBlockVolumeSampleProvider volumeProvider,
        float initialVolume,
        int processId,
        int captureProcessId)
    {
        this.capture = capture;
        this.processId = processId;
        this.captureProcessId = captureProcessId;
        this.captureBuffer = captureBuffer;
        this.captureFormat = captureFormat;
        this.captureSampleRate = captureFormat.SampleRate;
        this.volumeProvider = volumeProvider;
        baseVolume = initialVolume;
        SampleProvider = volumeProvider;
        State = "attaching";

        recordingStoppedHandler = (_, args) =>
        {
            if (args.Exception is null)
            {
                return;
            }

            if (IsRecoverableCaptureError(args.Exception))
            {
                captureBuffer.RelievePressure();
                State = "live";
                LastError = null;
                return;
            }

            State = "error";
            LastError = DescribeLoopbackError(args.Exception);
            capture.MarkUnhealthy();
            ProcessLoopbackPool.Evict(captureProcessId);
        };
        capture.RecordingStopped += recordingStoppedHandler;

        AttachHandlers();
    }

    private void AttachHandlers()
    {
        if (handlersAttached)
        {
            return;
        }

        capture.DataAvailable += OnCaptureDataAvailable;
        handlersAttached = true;
    }

    private void DetachHandlers()
    {
        if (!handlersAttached)
        {
            return;
        }

        capture.DataAvailable -= OnCaptureDataAvailable;
        handlersAttached = false;
    }

    public void ResetForReuse()
    {
        LastError = null;
        State = "attaching";
        Level = 0;
        captureBuffer.Clear();
    }

    public int StaleCaptureChecks { get; private set; }

    public void NoteStaleCaptureCandidate() => StaleCaptureChecks++;

    public void ResetStaleCaptureChecks() => StaleCaptureChecks = 0;

    public string AppId { get; private init; } = string.Empty;

    public float Level { get; private set; }

    public string State { get; private set; } = "detached";

    public string? LastError { get; private set; }

    public bool IsMuted => muted;

    public ISampleProvider SampleProvider { get; }

    public EqualizerSampleProvider? MixEqualizer { get; set; }

    public int CaptureProcessId => captureProcessId;

    public int CaptureSampleRate => captureSampleRate;

    public bool IsCapturing => capture.IsCapturing;

    public int BufferedSamples => captureBuffer.BufferedSamples;

    public static async Task<AppLoopbackSource> CreateAsync(
        string appId,
        int processId,
        int captureProcessId,
        WaveFormat mixFormat,
        float volume,
        bool includeProcessTree = true,
        bool isHiFiOutput = false)
    {
        _ = isHiFiOutput;
        var captureSampleRate = mixFormat.SampleRate;

        var capture = await ProcessLoopbackPool.AcquireAsync(
            captureProcessId,
            includeProcessTree,
            captureSampleRate,
            mixFormat.Channels);
        var captureFormat = capture.WaveFormat;
        // Simple FIFO (main's working music path) — avoid SmoothCapture live trim on loopback.
        var captureBuffer = new FifoCaptureBuffer(
            captureFormat,
            maxMilliseconds: LatencyTuning.LoopbackCaptureMaxMilliseconds,
            jitterBufferMilliseconds: LatencyTuning.LoopbackCaptureJitterBufferMilliseconds);
        var provider = CapturePipeline.Build(captureBuffer, captureFormat, mixFormat);
        var volumeProvider = new FullBlockVolumeSampleProvider(provider) { Volume = volume };

        return new AppLoopbackSource(
                capture,
                captureBuffer,
                captureFormat,
                volumeProvider,
                volume,
                processId,
                captureProcessId)
        {
            AppId = appId,
        };
    }

    public void SetVolume(float volume)
    {
        baseVolume = Math.Clamp(volume, 0f, 4f);
        ApplyVolume();
    }

    public void SetMuted(bool isMuted)
    {
        muted = isMuted;
        ApplyVolume();
    }

    private void OnCaptureDataAvailable(object? sender, WaveInEventArgs args)
    {
        try
        {
            captureBuffer.Write(args.Buffer, 0, args.BytesRecorded);
            var peak = AudioLevelUtility.ComputePeak(args.Buffer, args.BytesRecorded, captureFormat);
            var postGain = muted ? 0f : peak * baseVolume;
            Level = AudioLevelUtility.ApplyDecay(Level, postGain);
            if (!string.Equals(State, "error", StringComparison.OrdinalIgnoreCase))
            {
                State = "live";
                LastError = null;
            }
        }
        catch (Exception ex)
        {
            if (IsRecoverableCaptureError(ex))
            {
                captureBuffer.RelievePressure();
                return;
            }

            State = "error";
            LastError = DescribeLoopbackError(ex);
        }
    }

    private void ApplyVolume()
    {
        volumeProvider.Volume = muted ? 0f : baseVolume * LatencyTuning.LoopbackMakeupGain;
    }

    public void Start()
    {
        try
        {
            if (!capture.IsCapturing)
            {
                capture.StartRecording();
            }

            if (!string.Equals(State, "error", StringComparison.OrdinalIgnoreCase))
            {
                State = "live";
            }
        }
        catch (Exception ex)
        {
            State = "error";
            LastError = DescribeLoopbackError(ex);
            capture.MarkUnhealthy();
            ProcessLoopbackPool.Evict(captureProcessId);
        }
    }

    public void Stop()
    {
        // Keep pooled loopback captures running between stream stop/start.
    }

    public void Dispose()
    {
        DetachHandlers();
        capture.RecordingStopped -= recordingStoppedHandler;
        ProcessLoopbackPool.Release(captureProcessId);
    }

    private static string DescribeLoopbackError(Exception ex)
    {
        if (ex is COMException comException && (comException.HResult & 0xFFFFFFFF) == 0x80004001)
        {
            return "Process loopback is unavailable for this app. Stop the stream, wait a moment, then start again.";
        }

        if (ex is NotImplementedException
            || string.Equals(ex.Message, "The method or operation is not implemented.", StringComparison.Ordinal))
        {
            return "Process loopback needs a fresh capture. Uncheck the app, wait a second, then add it again.";
        }

        return ex.Message;
    }

    private static bool IsRecoverableCaptureError(Exception ex)
    {
        return ex.Message.Contains("Buffer full", StringComparison.OrdinalIgnoreCase);
    }
}

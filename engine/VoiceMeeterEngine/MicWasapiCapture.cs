using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// WASAPI microphone capture that requests 48 kHz IEEE float with quality
/// resampling/conversion handled by the audio stack (works across device formats).
/// </summary>
internal sealed class MicWasapiCapture : IWaveIn, IDisposable
{
    private const long ReftimesPerSec = 10_000_000;
    private const long ReftimesPerMillisec = 10_000;
    private const int FallbackBufferFrames = 512;

    private readonly AudioClient audioClient;
    private readonly bool useEventSync;
    private readonly int audioBufferMillisecondsLength;
    private readonly SynchronizationContext? syncContext;

    private WaveFormat waveFormat = EngineAudioFormat.MixFormat;
    private byte[] recordBuffer = [];
    private Thread? captureThread;
    private EventWaitHandle? frameEventWaitHandle;
    private int bytesPerFrame;
    private volatile CaptureState captureState = CaptureState.Stopped;
    private bool isPrepared;

    private MicWasapiCapture(
        AudioClient audioClient,
        bool useEventSync,
        int audioBufferMillisecondsLength)
    {
        this.audioClient = audioClient;
        this.useEventSync = useEventSync;
        this.audioBufferMillisecondsLength = audioBufferMillisecondsLength;
        syncContext = SynchronizationContext.Current;
    }

    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public CaptureState CaptureState => captureState;

    public WaveFormat WaveFormat
    {
        get => waveFormat;
        set => waveFormat = value;
    }

    public static MicWasapiCapture Create(
        MMDevice device,
        int bufferMilliseconds = LatencyTuning.HiFiMicCaptureBufferMilliseconds,
        int targetSampleRate = EngineAudioFormat.SampleRate)
    {
        var audioClient = device.AudioClient;
        var useEventSync = CaptureDeviceTuning.UseEventSyncCapture(device.FriendlyName);
        var capture = new MicWasapiCapture(audioClient, useEventSync, bufferMilliseconds);
        capture.PrepareCapture(device, targetSampleRate, device.FriendlyName);
        return capture;
    }

    private void PrepareCapture(
        MMDevice device,
        int targetSampleRate,
        string? deviceName)
    {
        if (isPrepared)
        {
            return;
        }

        var deviceFormat = device.AudioClient.MixFormat;
        var candidates = BuildFormatCandidates(deviceFormat, targetSampleRate);

        Exception? lastError = null;
        foreach (var candidate in candidates)
        {
            try
            {
                InitializeCapture(candidate.Format, candidate.UseAutoConvert);
                isPrepared = true;
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
            }
        }

        throw new InvalidOperationException(
            $"Unable to open microphone \"{device.FriendlyName}\".",
            lastError);
    }

    private static IEnumerable<(WaveFormat Format, bool UseAutoConvert)> BuildFormatCandidates(
        WaveFormat deviceFormat,
        int targetSampleRate)
    {
        var nativeChannels = Math.Clamp(deviceFormat.Channels, 1, 2);

        yield return (
            WaveFormat.CreateIeeeFloatWaveFormat(targetSampleRate, nativeChannels),
            true);

        if (nativeChannels == 1)
        {
            yield return (
                WaveFormat.CreateIeeeFloatWaveFormat(targetSampleRate, 2),
                true);
        }

        if (deviceFormat.SampleRate != targetSampleRate || !IsFloatFormat(deviceFormat))
        {
            yield return (CaptureFormatConverter.CreateFloatStorageFormat(deviceFormat), true);
        }
    }

    private static bool IsFloatFormat(WaveFormat format)
    {
        try
        {
            return CaptureFormatConverter.GetSampleEncoding(format) == WaveFormatEncoding.IeeeFloat;
        }
        catch
        {
            return false;
        }
    }

    private void InitializeCapture(WaveFormat requestedFormat, bool useAutoConvert)
    {
        waveFormat = requestedFormat;
        bytesPerFrame = Math.Max(1, waveFormat.BlockAlign);
        recordBuffer = new byte[Math.Max(bytesPerFrame * FallbackBufferFrames, bytesPerFrame)];

        var streamFlags = WasapiStreamFlags.ForSharedCapture(useAutoConvert, useEventSync);

        var requestedDuration = ReftimesPerMillisec * audioBufferMillisecondsLength;
        audioClient.Initialize(
            AudioClientShareMode.Shared,
            streamFlags,
            requestedDuration,
            0,
            waveFormat,
            Guid.Empty);

        if (useEventSync)
        {
            frameEventWaitHandle = new EventWaitHandle(false, EventResetMode.AutoReset);
            audioClient.SetEventHandle(frameEventWaitHandle.SafeWaitHandle.DangerousGetHandle());
        }
    }

    public void StartRecording()
    {
        if (captureState != CaptureState.Stopped)
        {
            throw new InvalidOperationException("Previous recording still in progress");
        }

        captureState = CaptureState.Starting;
        captureThread = new Thread(CaptureThread)
        {
            IsBackground = true,
            Name = "MicWasapiCapture",
            Priority = ThreadPriority.AboveNormal,
        };
        captureThread.Start();
    }

    public void StopRecording()
    {
        if (captureState != CaptureState.Stopped)
        {
            captureState = CaptureState.Stopping;
        }
    }

    public void Dispose()
    {
        StopRecording();
        captureThread?.Join();
        captureThread = null;
        frameEventWaitHandle?.Dispose();
        audioClient.Dispose();
    }

    private void CaptureThread()
    {
        Exception? exception = null;
        try
        {
            DoRecording();
        }
        catch (Exception ex)
        {
            exception = ex;
        }
        finally
        {
            audioClient.Stop();
        }

        captureThread = null;
        captureState = CaptureState.Stopped;
        RaiseRecordingStopped(exception);
    }

    private void DoRecording()
    {
        var bufferFrameCountForWait = audioClient.BufferSize;
        if (bufferFrameCountForWait < 1)
        {
            bufferFrameCountForWait = FallbackBufferFrames;
        }

        var actualDuration = (long)(ReftimesPerSec * bufferFrameCountForWait / (double)waveFormat.SampleRate);
        var waitMilliseconds = Math.Max(1, (int)(actualDuration / ReftimesPerMillisec));
        var capture = audioClient.AudioCaptureClient;
        audioClient.Start();

        if (captureState == CaptureState.Starting)
        {
            captureState = CaptureState.Capturing;
        }

        while (captureState == CaptureState.Capturing)
        {
            if (useEventSync)
            {
                frameEventWaitHandle?.WaitOne(waitMilliseconds, false);
            }
            else
            {
                Thread.Sleep(Math.Max(1, waitMilliseconds / 3));
            }

            if (captureState != CaptureState.Capturing)
            {
                break;
            }

            ReadNextPacket(capture);
        }
    }

    private void ReadNextPacket(AudioCaptureClient capture)
    {
        while (capture.GetNextPacketSize() > 0)
        {
            var buffer = capture.GetBuffer(out var framesAvailable, out var flags);
            var bytesAvailable = framesAvailable * bytesPerFrame;

            if (bytesAvailable <= 0)
            {
                capture.ReleaseBuffer(framesAvailable);
                continue;
            }

            if (recordBuffer.Length < bytesAvailable)
            {
                recordBuffer = new byte[bytesAvailable];
            }

            if ((flags & AudioClientBufferFlags.Silent) != AudioClientBufferFlags.Silent)
            {
                Marshal.Copy(buffer, recordBuffer, 0, bytesAvailable);
            }
            else
            {
                Array.Clear(recordBuffer, 0, bytesAvailable);
            }

            var packet = recordBuffer;
            DataAvailable?.Invoke(this, new WaveInEventArgs(packet, bytesAvailable));
            capture.ReleaseBuffer(framesAvailable);
        }
    }

    private void RaiseRecordingStopped(Exception? exception)
    {
        var handler = RecordingStopped;
        if (handler is null)
        {
            return;
        }

        if (syncContext is null)
        {
            handler(this, new StoppedEventArgs(exception));
            return;
        }

        syncContext.Post(_ => handler(this, new StoppedEventArgs(exception)), null);
    }
}

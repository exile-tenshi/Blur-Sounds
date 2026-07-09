using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace VoiceMeeterEngine;

internal sealed class ProcessWasapiCapture : IWaveIn, IDisposable
{
    private const long ReftimesPerSec = 10_000_000;
    private const long ReftimesPerMillisec = 10_000;
    private const int FallbackBufferFrames = 512;

    private readonly AudioClient audioClient;
    private readonly bool useEventSync;
    private readonly int audioBufferMillisecondsLength;
    private readonly SynchronizationContext? syncContext;
    private readonly int bufferFrameCount;
    private readonly int preferredSampleRate;
    private readonly int preferredChannels;

    private WaveFormat waveFormat = EngineAudioFormat.MixFormat;
    private byte[] recordBuffer = [];
    private byte[] eventBuffer = [];
    private Thread? captureThread;
    private EventWaitHandle? frameEventWaitHandle;
    private int bytesPerFrame;
    private volatile CaptureState captureState = CaptureState.Stopped;
    private volatile bool isHealthy = true;
    private bool isPrepared;

    public bool IsHealthy => isHealthy;

    public bool IncludeProcessTree { get; }

    public void MarkUnhealthy() => isHealthy = false;

    private ProcessWasapiCapture(
        AudioClient audioClient,
        bool useEventSync,
        int audioBufferMillisecondsLength,
        int bufferFrameCount,
        int preferredSampleRate,
        int preferredChannels,
        bool includeProcessTree)
    {
        this.audioClient = audioClient;
        this.useEventSync = useEventSync;
        this.audioBufferMillisecondsLength = audioBufferMillisecondsLength;
        this.bufferFrameCount = bufferFrameCount;
        this.preferredSampleRate = preferredSampleRate;
        this.preferredChannels = preferredChannels;
        IncludeProcessTree = includeProcessTree;
        syncContext = SynchronizationContext.Current;
    }

    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public CaptureState CaptureState => captureState;

    public bool IsCapturing => captureState == CaptureState.Capturing;

    public WaveFormat WaveFormat
    {
        get => waveFormat;
        set => waveFormat = value;
    }

    public static async Task<ProcessWasapiCapture> CreateForProcessCaptureAsync(
        int processId,
        bool includeProcessTree = true,
        int sampleRate = EngineAudioFormat.SampleRate,
        int channels = EngineAudioFormat.Channels,
        int bufferFrameCount = 0)
    {
        if (bufferFrameCount <= 0)
        {
            bufferFrameCount = LatencyTuning.GetLoopbackPacketFrames(sampleRate);
        }

        var useHiFiBuffers = AudioTuningPolicy.UseHiFiBuffers(
            sampleRate == HifiCableFormat.HiFiEngineSampleRate);
        ProcessWasapiCapture? capture = null;
        var completionHandler = new ActivateAudioInterfaceCompletionHandler(audioClientInterface =>
        {
            var audioClient = new AudioClient(audioClientInterface);
            capture = new ProcessWasapiCapture(
                audioClient,
                useEventSync: false,
                audioBufferMillisecondsLength: LatencyTuning.AppLoopbackCaptureBufferMilliseconds,
                bufferFrameCount,
                sampleRate,
                channels,
                includeProcessTree);
            capture.PrepareCapture();
        });

        var activationParams = new AudioClientActivationParams
        {
            ActivationType = AudioClientActivationType.ProcessLoopback,
            ProcessLoopbackParams = new AudioClientProcessLoopbackParams
            {
                TargetProcessId = (uint)processId,
                ProcessLoopbackMode = includeProcessTree
                    ? ProcessLoopbackMode.IncludeTargetProcessTree
                    : ProcessLoopbackMode.ExcludeTargetProcessTree,
            },
        };

        var activationHandle = GCHandle.Alloc(activationParams, GCHandleType.Pinned);
        try
        {
            var activateParams = new PropVariant
            {
                vt = (short)VarEnum.VT_BLOB,
                blobVal = new Blob
                {
                    Length = Marshal.SizeOf<AudioClientActivationParams>(),
                    Data = activationHandle.AddrOfPinnedObject(),
                },
            };

            var propVariantHandle = GCHandle.Alloc(activateParams, GCHandleType.Pinned);
            try
            {
                ProcessLoopbackNative.ActivateAudioInterfaceAsync(
                    ProcessLoopbackNative.VirtualAudioDeviceProcessLoopback,
                    ProcessLoopbackNative.AudioClientInterfaceId,
                    propVariantHandle.AddrOfPinnedObject(),
                    completionHandler,
                    out _);
                await completionHandler;
            }
            finally
            {
                propVariantHandle.Free();
            }
        }
        finally
        {
            activationHandle.Free();
        }

        return capture ?? throw new InvalidOperationException("Process loopback capture was not created.");
    }

    public void PrepareCapture()
    {
        if (isPrepared)
        {
            return;
        }

        // Process loopback clients return E_NOTIMPL from MixFormat. Use an explicit format
        // and let AutoConvertPcm handle device conversion, matching NAudio's implementation.
        var channelCount = Math.Clamp(preferredChannels, 1, 2);
        waveFormat = WaveFormat.CreateIeeeFloatWaveFormat(preferredSampleRate, channelCount);
        bytesPerFrame = Math.Max(1, waveFormat.BlockAlign);
        recordBuffer = new byte[Math.Max(bufferFrameCount * bytesPerFrame, bytesPerFrame)];

        var streamFlags = WasapiStreamFlags.ForProcessLoopback(useEventSync);

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

        isPrepared = true;
    }

    public void StartRecording()
    {
        if (captureState != CaptureState.Stopped)
        {
            throw new InvalidOperationException("Previous recording still in progress");
        }

        if (!isPrepared)
        {
            PrepareCapture();
        }

        captureState = CaptureState.Starting;
        captureThread = new Thread(() => CaptureThread(audioClient))
        {
            IsBackground = true,
            Name = "ProcessLoopbackCapture",
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

    private void CaptureThread(AudioClient client)
    {
        Exception? exception = null;
        try
        {
            DoRecording(client);
        }
        catch (Exception ex)
        {
            exception = ex;
        }
        finally
        {
            client.Stop();
        }

        captureThread = null;
        captureState = CaptureState.Stopped;
        if (exception is not null)
        {
            isHealthy = false;
        }

        RaiseRecordingStopped(exception);
    }

    private void DoRecording(AudioClient client)
    {
        var bufferFrameCountForWait = client.BufferSize;
        if (bufferFrameCountForWait < 1)
        {
            bufferFrameCountForWait = FallbackBufferFrames;
        }

        var actualDuration = (long)(ReftimesPerSec * bufferFrameCountForWait / (double)waveFormat.SampleRate);
        var waitMilliseconds = Math.Max(1, (int)(actualDuration / ReftimesPerMillisec));
        var capture = client.AudioCaptureClient;
        client.Start();

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
                Thread.Sleep(Math.Max(2, waitMilliseconds / 4));
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

            if (eventBuffer.Length < bytesAvailable)
            {
                eventBuffer = new byte[bytesAvailable];
            }

            Buffer.BlockCopy(recordBuffer, 0, eventBuffer, 0, bytesAvailable);
            DataAvailable?.Invoke(this, new WaveInEventArgs(eventBuffer, bytesAvailable));
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

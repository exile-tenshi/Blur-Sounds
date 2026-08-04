using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Direct WASAPI render loop for virtual cable output. Avoids NAudio WasapiOut stop/restart issues.
/// </summary>
internal sealed class WasapiRenderBroadcast : IDisposable
{
    private const long ReftimesPerMillisecond = 10_000;

    private AudioClient? audioClient;
    private AudioRenderClient? renderClient;
    private IWaveProvider? waveProvider;
    private EventWaitHandle? frameEvent;
    private Thread? renderThread;
    private int bufferFrameCount;
    private int bytesPerFrame;
    private volatile int playbackState;
    private string? lastRenderError;
    private byte[] readBuffer = [];

    public string? LastRenderError => lastRenderError;

    public void Configure(
        MMDevice device,
        AudioClientShareMode shareMode,
        bool useEventSync,
        int latencyMilliseconds,
        IWaveProvider provider,
        bool allowAutoConvert = true)
    {
        Stop();
        DisposeClients();

        waveProvider = provider;
        audioClient = device.AudioClient;
        bytesPerFrame = Math.Max(1, provider.WaveFormat.BlockAlign);

        var streamFlags = WasapiStreamFlags.ForSharedRender(
            shareMode == AudioClientShareMode.Shared && allowAutoConvert,
            useEventSync);

        audioClient.Initialize(
            shareMode,
            streamFlags,
            latencyMilliseconds * ReftimesPerMillisecond,
            0,
            provider.WaveFormat,
            Guid.Empty);

        bufferFrameCount = Math.Max(1, audioClient.BufferSize);
        renderClient = audioClient.AudioRenderClient;

        if (useEventSync)
        {
            frameEvent = new EventWaitHandle(false, EventResetMode.AutoReset);
            audioClient.SetEventHandle(frameEvent.SafeWaitHandle.DangerousGetHandle());
        }
    }

    public void Play()
    {
        if (waveProvider is null || audioClient is null || playbackState == 1)
        {
            return;
        }

        playbackState = 1;
        lastRenderError = null;
        renderThread = new Thread(RenderLoop)
        {
            IsBackground = true,
            Name = "WasapiRenderBroadcast",
            Priority = ThreadPriority.AboveNormal,
        };
        renderThread.Start();
    }

    public void Stop()
    {
        if (playbackState == 0)
        {
            return;
        }

        playbackState = 2;
        frameEvent?.Set();
        renderThread?.Join(500);
        renderThread = null;

        try
        {
            audioClient?.Stop();
        }
        catch
        {
            // Device may already be stopped.
        }

        playbackState = 0;
    }

    public void Dispose()
    {
        Stop();
        DisposeClients();
    }

    private void RenderLoop()
    {
        try
        {
            audioClient!.Start();

            while (playbackState == 1)
            {
                var padding = audioClient.CurrentPadding;
                var framesAvailable = bufferFrameCount - padding;
                if (framesAvailable > 0)
                {
                    WriteFrames(framesAvailable);
                }

                if (!WaitForNextBuffer())
                {
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            lastRenderError = ex.Message;
            AudioDiagnostics.SetRenderError(ex.Message);
        }
        finally
        {
            try
            {
                audioClient?.Stop();
            }
            catch
            {
                // Ignore cleanup failures.
            }

            playbackState = 0;
        }
    }

    private bool WaitForNextBuffer()
    {
        if (playbackState != 1)
        {
            return false;
        }

        if (frameEvent is not null)
        {
            // Event timeout must NOT stop the render loop. Virtual cables (Hi-Fi Cable)
            // often miss EventCallback wakes; treating WaitOne failure as fatal left
            // Cable Input silent after the first buffer fill.
            frameEvent.WaitOne(50);
            return playbackState == 1;
        }

        Thread.Sleep(3);
        return playbackState == 1;
    }

    private void WriteFrames(int frameCount)
    {
        if (renderClient is null || waveProvider is null)
        {
            return;
        }

        var byteCount = frameCount * bytesPerFrame;
        if (readBuffer.Length < byteCount)
        {
            readBuffer = new byte[byteCount];
        }

        var bytesRead = waveProvider.Read(readBuffer, 0, byteCount);
        if (bytesRead < byteCount)
        {
            Array.Clear(readBuffer, bytesRead, byteCount - bytesRead);
            bytesRead = byteCount;
            CaptureDiagnostics.NoteRenderUnderrun();
        }

        OutputPullMeter.ReportPeak(readBuffer, bytesRead, waveProvider.WaveFormat);

        var bytesToWrite = frameCount * bytesPerFrame;
        var bufferPointer = renderClient.GetBuffer(frameCount);
        Marshal.Copy(readBuffer, 0, bufferPointer, bytesToWrite);
        renderClient.ReleaseBuffer(frameCount, AudioClientBufferFlags.None);
    }

    private void DisposeClients()
    {
        frameEvent?.Dispose();
        frameEvent = null;
        renderClient = null;
        audioClient?.Dispose();
        audioClient = null;
        waveProvider = null;
    }
}

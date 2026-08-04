using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceMeeterEngine;

/// <summary>
/// Hi-Fi Cable Input playback via NAudio WasapiOut (prefill + stable shared-mode pump).
/// Custom WasapiRenderBroadcast was leaving virtual-cable Input silent on some hosts.
/// </summary>
internal sealed class WasapiOutBroadcast : IDisposable
{
    private MMDevice? device;
    private WasapiOut? output;

    public bool IsBound => output is not null;

    public string? LastError { get; private set; }

    public void Configure(
        MMDevice endpoint,
        IWaveProvider provider,
        int latencyMilliseconds,
        bool useEventSync)
    {
        Dispose();
        LastError = null;

        // Keep the endpoint alive for the lifetime of WasapiOut.
        device = endpoint;
        HifiCableEndpointVolume.EnsureAudible(device);

        var metered = new PeakReportingWaveProvider(provider);
        output = new WasapiOut(
            device,
            AudioClientShareMode.Shared,
            useEventSync,
            Math.Max(50, latencyMilliseconds));
        output.Init(metered);
    }

    public void Play()
    {
        try
        {
            output?.Play();
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            AudioDiagnostics.SetRenderError(ex.Message);
            throw;
        }
    }

    public void Stop()
    {
        try
        {
            output?.Stop();
        }
        catch
        {
            // Ignore stop races.
        }
    }

    public void Dispose()
    {
        Stop();
        output?.Dispose();
        output = null;
        // Do not Dispose MMDevice — Bind retries reuse the same endpoint instance.
        device = null;
    }
}

using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

internal interface IMixOutputBroadcast : IDisposable
{
    bool IsBound { get; }

    string BindingDescription { get; }

    void Play();

    void Stop();
}

internal sealed class MixOutputRouter : IMixOutputBroadcast
{
    private readonly Func<ISampleProvider> sourceFactory;
    private readonly WaveFormat sourceFormat;
    private IMixOutputBroadcast? activeOutput;

    public MixOutputRouter(Func<ISampleProvider> sourceFactory, WaveFormat sourceFormat)
    {
        this.sourceFactory = sourceFactory;
        this.sourceFormat = sourceFormat;
    }

    public bool IsBound => activeOutput?.IsBound ?? false;

    public string BindingDescription => activeOutput?.BindingDescription ?? string.Empty;

    public void Bind(MMDevice device)
    {
        activeOutput?.Dispose();

        if (ShouldUseAsioOutput())
        {
            try
            {
                var asioOutput = new AsioMixOutputBroadcast(sourceFactory, sourceFormat);
                asioOutput.Bind(device.FriendlyName);
                activeOutput = asioOutput;
                return;
            }
            catch
            {
                // Fall back to WASAPI when ASIO routing is unavailable or misconfigured.
            }
        }

        var wasapiOutput = new WasapiMixOutputBroadcast(sourceFactory, sourceFormat);
        wasapiOutput.Bind(device);
        activeOutput = wasapiOutput;
    }

    public void Play()
    {
        activeOutput?.Play();
    }

    /// <summary>
    /// Hi-Fi only: if the bound pump pulled no bytes after Play, rebind on the other backend.
    /// </summary>
    public bool TryRecoverSilentPump(int settleMilliseconds = 450)
    {
        return activeOutput is WasapiMixOutputBroadcast wasapi &&
               wasapi.TryRecoverSilentPump(settleMilliseconds);
    }

    public void Stop()
    {
        activeOutput?.Stop();
    }

    public void Dispose()
    {
        activeOutput?.Dispose();
        activeOutput = null;
    }

    private static bool ShouldUseAsioOutput()
    {
        var mode = Environment.GetEnvironmentVariable("BLUR_SOUNDS_OUTPUT");
        if (string.Equals(mode, "wasapi", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(mode, "asio", StringComparison.OrdinalIgnoreCase))
        {
            return AsioDriverSelector.IsAvailable();
        }

        // Default to WASAPI for reliable Hi-Fi Cable routing.
        return false;
    }
}

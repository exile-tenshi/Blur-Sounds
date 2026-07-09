using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Streams the live mix to an ASIO driver (typically ASIO4ALL).
/// </summary>
internal sealed class AsioMixOutputBroadcast : IMixOutputBroadcast
{
    private readonly Func<ISampleProvider> sourceFactory;
    private readonly WaveFormat sourceFormat;
    private AsioOut? asioOut;
    private AsioBinding? binding;

    public AsioMixOutputBroadcast(Func<ISampleProvider> sourceFactory, WaveFormat sourceFormat)
    {
        this.sourceFactory = sourceFactory;
        this.sourceFormat = sourceFormat;
    }

    public bool IsBound => asioOut is not null;

    public string BindingDescription { get; private set; } = string.Empty;

    public void Bind(string targetDeviceName)
    {
        DisposeOutput();

        binding = AsioDriverSelector.ResolveBinding(targetDeviceName);
        asioOut = new AsioOut(binding.DriverName)
        {
            ChannelOffset = binding.OutputChannelOffset,
            AutoStop = false,
        };

        var delegatingSource = new DelegateSampleProvider(sourceFormat, sourceFactory);
        var waveProvider = OutputWaveProviderFactory.Create(delegatingSource, EngineAudioFormat.PcmOutputFormat);
        asioOut.Init(waveProvider);

        BindingDescription =
            $"ASIO {binding.DriverName} · {binding.DescribeChannels()} · {EngineAudioFormat.Description}";
    }

    public void Play()
    {
        asioOut?.Play();
    }

    public void Stop()
    {
        asioOut?.Stop();
    }

    public void Dispose()
    {
        DisposeOutput();
    }

    private void DisposeOutput()
    {
        if (asioOut is null)
        {
            return;
        }

        try
        {
            asioOut.Stop();
        }
        catch
        {
            // Ignore shutdown races.
        }

        asioOut.Dispose();
        asioOut = null;
        binding = null;
        BindingDescription = string.Empty;
    }
}

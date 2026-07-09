using NAudio.Wave;

using NAudio.Wave.SampleProviders;



namespace VoiceMeeterEngine;



internal sealed class DelegateSampleProvider : ISampleProvider

{

    private readonly Func<ISampleProvider> providerFactory;

    private readonly WaveFormat waveFormat;



    public DelegateSampleProvider(WaveFormat waveFormat, Func<ISampleProvider> providerFactory)

    {

        this.waveFormat = waveFormat;

        this.providerFactory = providerFactory;

    }



    public WaveFormat WaveFormat => waveFormat;



    public int Read(float[] buffer, int offset, int count)

    {

        return providerFactory().Read(buffer, offset, count);

    }

}



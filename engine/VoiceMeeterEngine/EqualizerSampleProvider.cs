using NAudio.Dsp;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace VoiceMeeterEngine;

/// <summary>
/// Six-band parametric equalizer for high-quality music shaping.
/// </summary>
internal sealed class EqualizerSampleProvider : ISampleProvider
{
    public const float MinBandDb = -12f;
    public const float MaxBandDb = 12f;

    private static readonly float[] FrequenciesHz = [60f, 150f, 400f, 1000f, 2400f, 15000f];
    private static readonly float[] BandQ =
    [
        0.9f,
        1.0f,
        1.15f,
        1.2f,
        1.25f,
        1.35f,
    ];
    /// <summary>Wider Q for mic path — peaking EQ with music Q rings like a “vroom” on desk taps.</summary>
    private static readonly float[] VoiceBandQ =
    [
        0.7f,
        0.75f,
        0.8f,
        0.85f,
        0.85f,
        0.8f,
    ];

    private readonly ISampleProvider source;
    private readonly object filterLock = new();
    private readonly int channels;
    private readonly float[] bandQ;
    private BiQuadFilter[][] bandFilters;
    private float[] appliedBandDb = new float[FrequenciesHz.Length];
    private int[] activeBandIndices = [];
    private bool enabled = true;

    public EqualizerSampleProvider(ISampleProvider source, bool voiceFriendly = false)
    {
        this.source = source;
        WaveFormat = source.WaveFormat;
        channels = Math.Max(1, WaveFormat.Channels);
        bandQ = voiceFriendly ? VoiceBandQ : BandQ;
        bandFilters = CreateFilterBank();
    }

    public WaveFormat WaveFormat { get; }

    public void SetEqualizer(
        bool nextEnabled,
        float band60Db,
        float band150Db,
        float band400Db,
        float band1000Db,
        float band2400Db,
        float band15000Db)
    {
        var nextBands = new[]
        {
            band60Db,
            band150Db,
            band400Db,
            band1000Db,
            band2400Db,
            band15000Db,
        };

        lock (filterLock)
        {
            enabled = nextEnabled;
            if (!enabled || IsFlat(nextBands))
            {
                Array.Clear(appliedBandDb, 0, appliedBandDb.Length);
                activeBandIndices = [];
                return;
            }

            for (var index = 0; index < nextBands.Length; index++)
            {
                var clamped = Math.Clamp(nextBands[index], MinBandDb, MaxBandDb);
                if (Math.Abs(clamped - appliedBandDb[index]) < 0.01f)
                {
                    continue;
                }

                appliedBandDb[index] = clamped;
                UpdateBandFilter(index, clamped);
            }

            activeBandIndices = BuildActiveBandIndices(appliedBandDb);
        }
    }

    public int Read(float[] buffer, int offset, int count)
    {
        var read = source.Read(buffer, offset, count);
        if (read <= 0)
        {
            Array.Clear(buffer, offset, count);
            return count;
        }

        int[] activeBands;
        BiQuadFilter[][] filterSnapshot;

        lock (filterLock)
        {
            if (!enabled || activeBandIndices.Length == 0)
            {
                if (read < count)
                {
                    Array.Clear(buffer, offset + read, count - read);
                }

                return count;
            }

            activeBands = activeBandIndices;
            filterSnapshot = bandFilters;
        }

        for (var index = 0; index < read; index++)
        {
            var channel = index % channels;
            var sample = buffer[offset + index];

            for (var bandIndex = 0; bandIndex < activeBands.Length; bandIndex++)
            {
                var band = activeBands[bandIndex];
                sample = filterSnapshot[band][channel].Transform(sample);
            }

            buffer[offset + index] = sample;
        }

        if (read < count)
        {
            Array.Clear(buffer, offset + read, count - read);
        }

        return count;
    }

    private BiQuadFilter[][] CreateFilterBank()
    {
        var banks = new BiQuadFilter[FrequenciesHz.Length][];

        for (var band = 0; band < FrequenciesHz.Length; band++)
        {
            banks[band] = new BiQuadFilter[channels];
            UpdateBandFilter(band, appliedBandDb[band], banks);
        }

        activeBandIndices = BuildActiveBandIndices(appliedBandDb);
        return banks;
    }

    private void UpdateBandFilter(int band, float gainDb, BiQuadFilter[][]? banks = null)
    {
        var target = banks ?? bandFilters;
        for (var channel = 0; channel < channels; channel++)
        {
            target[band][channel] = BiQuadFilter.PeakingEQ(
                WaveFormat.SampleRate,
                FrequenciesHz[band],
                bandQ[band],
                gainDb);
        }
    }

    private static int[] BuildActiveBandIndices(float[] bands)
    {
        var active = new List<int>(bands.Length);
        for (var index = 0; index < bands.Length; index++)
        {
            if (Math.Abs(bands[index]) >= 0.01f)
            {
                active.Add(index);
            }
        }

        return active.ToArray();
    }

    private static bool IsFlat(float[] bands)
    {
        foreach (var band in bands)
        {
            if (Math.Abs(band) >= 0.01f)
            {
                return false;
            }
        }

        return true;
    }
}

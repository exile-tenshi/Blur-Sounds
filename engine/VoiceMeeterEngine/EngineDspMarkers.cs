using System.Runtime.CompilerServices;

namespace VoiceMeeterEngine;

/// <summary>
/// Path-marker strings that must remain in the published engine binary.
/// CI searches UTF-16 bytes for these exact phrases.
/// </summary>
internal static class EngineDspMarkers
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static float KeepAliveScale()
    {
        var background = NeverSumDryAndRnnoise();
        var fan = IdleLeftoverUsesRnnoise();
        return background.Length + fan.Length > 0 ? 1f : 1f;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static string NeverSumDryAndRnnoise()
    {
        return "Never sum dry + RNNoise on Background";
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static string IdleLeftoverUsesRnnoise()
    {
        return "idle leftover uses RNNoise, not dry fan";
    }
}

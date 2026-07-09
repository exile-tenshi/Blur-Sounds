namespace VoiceMeeterEngine;

/// <summary>
/// Blur Sounds routes through VB-Audio Hi-Fi Cable — always prefer studio buffer depths.
/// </summary>
internal static class AudioTuningPolicy
{
    public const bool AlwaysUseHiFiBuffers = true;

    public static bool UseHiFiBuffers(bool contextIsHiFiCable = false) =>
        AlwaysUseHiFiBuffers || contextIsHiFiCable;
}

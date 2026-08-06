namespace VoiceMeeterEngine;

/// <summary>
/// Historical Output "keep-alive" client. VB-Audio Hi-Fi Cable is Pass-Through without any
/// Output capture client (manual: if ASIO Bridge is not launched, Pass-Through anyway).
/// Opening Output here does not enable the loop and has left Discord/OBS silent on some hosts.
/// Matching Input/Output MixFormats + a listener on Output (Discord/OBS) is what matters.
/// </summary>
internal sealed class HifiCableOutputActivator : IDisposable
{
    public bool IsActive => true;

    public string? LastError => null;

    public string? ListenThroughWarning => null;

    public void Start()
    {
        // No-op: do not open Hi-Fi Cable Output capture.
    }

    public void Stop()
    {
    }

    public void Dispose()
    {
        Stop();
    }
}

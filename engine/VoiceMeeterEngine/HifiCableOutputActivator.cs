namespace VoiceMeeterEngine;

/// <summary>
/// Historical Output "keep-alive" client. Hi-Fi Cable is Pass-Through without any Output
/// capture client (VB-Audio manual: if ASIO Bridge is not launched, Pass-Through anyway).
/// This type is retained only so older call sites compile; Start() is a no-op.
/// </summary>
internal sealed class HifiCableOutputActivator : IDisposable
{
    public bool IsActive => false;

    public string? LastError => null;

    public void Start()
    {
        // No-op: opening Output capture does not enable Pass-Through and is not required
        // for Discord/OBS. Matching Input/Output MixFormats + a listener on Output is.
    }

    public void Stop()
    {
    }

    public void Dispose()
    {
        Stop();
    }
}

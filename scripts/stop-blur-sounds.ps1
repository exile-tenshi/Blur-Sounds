$ErrorActionPreference = 'SilentlyContinue'

@(
    'Blur Sounds',
    'VoiceMeeterEngine',
    'electron'
) | ForEach-Object {
    Get-Process -Name $_ | Stop-Process -Force
}

cmd.exe /c 'taskkill /F /IM "Blur Sounds.exe" /T >nul 2>&1'
cmd.exe /c 'taskkill /F /IM "VoiceMeeterEngine.exe" /T >nul 2>&1'

Start-Sleep -Seconds 2

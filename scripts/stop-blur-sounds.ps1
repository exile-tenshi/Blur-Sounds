Get-Process -Name 'Blur Sounds','VoiceMeeterEngine','electron' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

cmd.exe /c 'taskkill /F /IM "Blur Sounds.exe" /T >nul 2>&1'
cmd.exe /c 'taskkill /F /IM "VoiceMeeterEngine.exe" /T >nul 2>&1'

Start-Sleep -Seconds 2

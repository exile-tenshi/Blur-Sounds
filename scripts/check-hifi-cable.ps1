$ErrorActionPreference = 'Stop'

function Test-HifiCablePresent {
    $devices = Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction SilentlyContinue
    $hifiPlayback = @(
        $devices | Where-Object {
            $_.FriendlyName -match 'Hi-?Fi.*Cable\s+Input' -or
            $_.FriendlyName -match 'CABLE Input.*Hi-?Fi'
        }
    )
    $hifiRecording = @(
        $devices | Where-Object {
            $_.FriendlyName -match 'Hi-?Fi.*Cable\s+Output' -or
            $_.FriendlyName -match 'CABLE Output.*Hi-?Fi'
        }
    )

    return [pscustomobject]@{
        HiFiPlayback = $hifiPlayback | ForEach-Object { $_.FriendlyName }
        HiFiRecording = $hifiRecording | ForEach-Object { $_.FriendlyName }
        Installed = ($hifiPlayback.Count -gt 0)
    }
}

$cables = Test-HifiCablePresent

if ($cables.Installed) {
    Write-Host "VB-Audio Hi-Fi Cable detected."
    Write-Host "  Playback: $($cables.HiFiPlayback -join ', ')"
    if ($cables.HiFiRecording.Count -gt 0) {
        Write-Host "  Recording: $($cables.HiFiRecording -join ', ')"
    }
    exit 0
}

Write-Host ""
Write-Host "WARNING: VB-Audio Hi-Fi Cable was not detected on this PC."
Write-Host "Download Hi-Fi Cable & ASIO Bridge from https://vb-audio.com/Cable/index.htm"
Write-Host ""
Write-Host "The installer will still be built. Install Hi-Fi Cable on target machines before streaming."
Write-Host ""

exit 0

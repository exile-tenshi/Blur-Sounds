$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$staging = Join-Path $env:LOCALAPPDATA 'blur-sounds-release'
$stagingApp = Join-Path $staging 'win-unpacked\Blur Sounds.exe'
$release = Join-Path $root 'release'
$legacyApp = Join-Path $release 'win-unpacked\Blur Sounds.exe'
$portableApp = Join-Path $release 'portable\win-unpacked\Blur Sounds.exe'

function Get-LaunchTarget {
    if (Test-Path $stagingApp) {
        return $stagingApp
    }

    if (Test-Path $portableApp) {
        return $portableApp
    }

    if (Test-Path $legacyApp) {
        return $legacyApp
    }

    return $null
}

$appExe = Get-LaunchTarget
if (-not $appExe) {
    & (Join-Path $PSScriptRoot 'build-installer.ps1')
    $appExe = Get-LaunchTarget
}

if (-not $appExe) {
    throw "Blur Sounds executable was not found. Run scripts/build-installer.ps1 first."
}

Write-Host "Launching $appExe"
Start-Process -FilePath $appExe

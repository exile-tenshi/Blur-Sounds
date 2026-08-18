$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$release = Join-Path $root 'release'
$portableRoot = Join-Path $release 'portable'
$desktopFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blur Sounds'
$clipsFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blur Sounds Clips'

Push-Location $root
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }

    npx electron-builder --win dir --config.directories.output="$portableRoot"
    if ($LASTEXITCODE -ne 0) {
        throw "electron-builder failed with exit code $LASTEXITCODE"
    }

    $appExe = Join-Path $portableRoot 'win-unpacked\Blur Sounds.exe'
    if (-not (Test-Path $appExe)) {
        throw "Portable app was not found at $appExe"
    }

    $launcherBat = Join-Path $release 'Run Blur Sounds.bat'
    @"
@echo off
start "" "%~dp0portable\win-unpacked\Blur Sounds.exe"
"@ | Set-Content -Path $launcherBat -Encoding ASCII

    $launcherPs1 = Join-Path $release 'Run-Blur-Sounds.ps1'
    @"
`$ErrorActionPreference = 'Stop'
Start-Process -FilePath (Join-Path `$PSScriptRoot 'portable\win-unpacked\Blur Sounds.exe')
"@ | Set-Content -Path $launcherPs1 -Encoding UTF8

    Write-Host 'Stopping leftover Blur Sounds processes so Desktop copy is not locked...'
    & (Join-Path $PSScriptRoot 'stop-blur-sounds.ps1')

    $freshFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'BlurSoundsApp'
    New-Item -ItemType Directory -Force -Path $desktopFolder | Out-Null
    New-Item -ItemType Directory -Force -Path $clipsFolder | Out-Null
    New-Item -ItemType Directory -Force -Path $freshFolder | Out-Null
    Copy-Item -Path (Join-Path $portableRoot 'win-unpacked\*') -Destination $desktopFolder -Recurse -Force
    Copy-Item -Path (Join-Path $portableRoot 'win-unpacked\*') -Destination $freshFolder -Recurse -Force

    $desktopLauncher = Join-Path $desktopFolder 'Run Blur Sounds.bat'
    @"
@echo off
start "" "%~dp0Blur Sounds.exe"
"@ | Set-Content -Path $desktopLauncher -Encoding ASCII

    Write-Host ""
    Write-Host "Portable app ready (no installer):"
    Write-Host "  $appExe"
    Write-Host "  $launcherBat"
    Write-Host "Desktop folder copy:"
    Write-Host "  $desktopFolder"
    Write-Host "Clips folder:"
    Write-Host "  $clipsFolder"
}
finally {
    Pop-Location
}

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$desktopFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blur Sounds'
$desktopExe = Join-Path $desktopFolder 'Blur Sounds.exe'
$buildExe = Join-Path $root 'release\portable\win-unpacked\Blur Sounds.exe'
$freshFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'BlurSoundsApp'
$freshExe = Join-Path $freshFolder 'Blur Sounds.exe'

function Test-LaunchableExe([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return $false
    }

    $item = Get-Item -LiteralPath $path
    return $item.Length -gt 0
}

function Start-BlurSoundsExe([string]$path) {
    Unblock-File -LiteralPath $path -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath (Split-Path $path) -Recurse -File -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue

    Write-Host "Launching $path"
    Get-Item -LiteralPath $path | Format-List FullName, Length, LastWriteTime
    Start-Process -FilePath $path -WorkingDirectory (Split-Path $path)
}

Write-Host 'Stopping leftover Blur Sounds processes...'
& (Join-Path $PSScriptRoot 'stop-blur-sounds.ps1')

# Prefer the build output. Desktop\Blur Sounds is often left locked from a previous run.
$candidates = @($buildExe, $desktopExe) | Where-Object { Test-LaunchableExe $_ }
foreach ($exe in $candidates) {
    try {
        Start-BlurSoundsExe $exe
        return
    }
    catch {
        Write-Host "Could not start ${exe}: $($_.Exception.Message)"
    }
}

Write-Host "Copying to a fresh folder (not 'Blur Sounds') so Windows is not holding a lock..."
if (Test-Path -LiteralPath $freshFolder) {
    Remove-Item -LiteralPath $freshFolder -Recurse -Force -ErrorAction SilentlyContinue
}

$source = $null
if (Test-Path -LiteralPath (Join-Path $root 'release\portable\win-unpacked\Blur Sounds.exe')) {
    $source = Join-Path $root 'release\portable\win-unpacked'
}
elseif (Test-Path -LiteralPath $desktopExe) {
    $source = $desktopFolder
}

if (-not $source) {
    throw "Blur Sounds.exe was not found. Run npm.cmd run portable first."
}

Copy-Item -Path $source -Destination $freshFolder -Recurse -Force
Start-BlurSoundsExe $freshExe

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$desktopFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blur Sounds'
$desktopExe = Join-Path $desktopFolder 'Blur Sounds.exe'
$buildExe = Join-Path $root 'release\portable\win-unpacked\Blur Sounds.exe'

function Test-LaunchableExe([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return $false
    }

    $item = Get-Item -LiteralPath $path
    return $item.Length -gt 0
}

Write-Host 'Stopping leftover Blur Sounds processes...'
& (Join-Path $PSScriptRoot 'stop-blur-sounds.ps1')

$candidates = @($desktopExe, $buildExe) | Where-Object { Test-LaunchableExe $_ }
if (-not $candidates) {
    Write-Host 'No portable exe found. Building one with npm run portable...'
    Push-Location $root
    try {
        npm.cmd run portable
        if ($LASTEXITCODE -ne 0) {
            throw "npm run portable failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    & (Join-Path $PSScriptRoot 'stop-blur-sounds.ps1')
    $candidates = @($desktopExe, $buildExe) | Where-Object { Test-LaunchableExe $_ }
}

if (-not $candidates) {
    throw "Blur Sounds.exe was not found. Expected:`n  $desktopExe`n  $buildExe"
}

foreach ($exe in $candidates) {
    Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath (Split-Path $exe) -Recurse -File -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
}

$exe = $candidates[0]
Write-Host "Launching $exe"
Get-Item -LiteralPath $exe | Format-List FullName, Length, LastWriteTime
Start-Process -FilePath $exe

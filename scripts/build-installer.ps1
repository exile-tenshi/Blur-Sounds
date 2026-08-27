$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$staging = Join-Path $env:LOCALAPPDATA 'blur-sounds-release'
$projectRelease = Join-Path $root 'release'

Push-Location $root
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }

    npx electron-builder --win --publish never --config.directories.output="$staging"
    if ($LASTEXITCODE -ne 0) {
        throw "electron-builder failed with exit code $LASTEXITCODE"
    }

    New-Item -ItemType Directory -Path $projectRelease -Force | Out-Null

    $installer = Get-ChildItem -Path $staging -Filter '*-Setup-*.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $installer) {
        throw "Installer executable was not found in $staging"
    }

    Copy-Item $installer.FullName $projectRelease -Force
    Copy-Item "$($installer.FullName).blockmap" $projectRelease -Force -ErrorAction SilentlyContinue

    $winUnpacked = Join-Path $staging 'win-unpacked'
    if (Test-Path $winUnpacked) {
        $projectUnpacked = Join-Path $projectRelease 'win-unpacked'
        if (Test-Path $projectUnpacked) {
            Remove-Item $projectUnpacked -Recurse -Force -ErrorAction SilentlyContinue
        }

        Copy-Item $winUnpacked $projectUnpacked -Recurse -Force
        Write-Host "  $(Join-Path $projectUnpacked 'Blur Sounds.exe')"
    }

    Write-Host ""
    Write-Host "Installer ready:"
    Write-Host "  $($installer.FullName)"
    Write-Host "  $(Join-Path $projectRelease $installer.Name)"
}
finally {
    Pop-Location
}

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$desktopFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blur Sounds'
$desktopExe = Join-Path $desktopFolder 'Blur Sounds.exe'
$buildDir = Join-Path $root 'release\portable\win-unpacked'
$buildExe = Join-Path $buildDir 'Blur Sounds.exe'
$freshFolder = Join-Path $env:LOCALAPPDATA 'BlurSoundsApp'
$freshExe = Join-Path $freshFolder 'Blur Sounds.exe'

function Test-LaunchableExe([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return $false
    }

    return (Get-Item -LiteralPath $path).Length -gt 0
}

function Copy-UnblockedApp([string]$sourceDir, [string]$destinationDir) {
    if (Test-Path -LiteralPath $destinationDir) {
        Remove-Item -LiteralPath $destinationDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    & robocopy.exe $sourceDir $destinationDir /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }

    Get-ChildItem -LiteralPath $destinationDir -Recurse -File -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
}

function Start-BlurSoundsExe([string]$path) {
    $dir = Split-Path $path
    Write-Host "Launching $path"
    Get-Item -LiteralPath $path | Format-List FullName, Length, LastWriteTime
    icacls.exe $path
    Get-Item -LiteralPath $path -Stream Zone.Identifier -ErrorAction SilentlyContinue

    try {
        Start-Process -FilePath $path -WorkingDirectory $dir
        return
    }
    catch {
        Write-Host "Start-Process failed: $($_.Exception.Message)"
    }

    Write-Host 'Retrying with cmd start...'
    cmd.exe /c "start `"`" `"$path`""
}

function Start-DevElectron {
    $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
    $main = Join-Path $root 'dist-electron\index.js'
    if (-not (Test-Path -LiteralPath $electron)) {
        throw "Packaged Blur Sounds.exe is blocked by Windows, and node_modules\\electron is missing. Run npm.cmd install, then npm.cmd run dev."
    }

    if (-not (Test-Path -LiteralPath $main)) {
        Write-Host 'dist-electron is missing. Starting vite/electron with npm run dev...'
        Push-Location $root
        try {
            npm.cmd run dev
        }
        finally {
            Pop-Location
        }
        return
    }

    Write-Host "Windows blocked the packaged exe. Starting Electron from the source tree instead:"
    Write-Host "  $electron"
    Start-Process -FilePath $electron -WorkingDirectory $root -ArgumentList '.'
}

Write-Host 'Stopping leftover Blur Sounds processes...'
& (Join-Path $PSScriptRoot 'stop-blur-sounds.ps1')

$source = $null
if (Test-LaunchableExe $buildExe) {
    $source = $buildDir
}
elseif (Test-LaunchableExe $desktopExe) {
    $source = $desktopFolder
}

if ($source) {
    Write-Host "Copying unblocked app to $freshFolder (not Desktop / OneDrive)..."
    Copy-UnblockedApp $source $freshFolder
    try {
        Start-BlurSoundsExe $freshExe
        Start-Sleep -Seconds 2
        if (Get-Process -Name 'Blur Sounds' -ErrorAction SilentlyContinue) {
            return
        }
        Write-Host 'Packaged exe did not stay running (Windows likely blocked it).'
    }
    catch {
        Write-Host "Packaged exe launch failed: $($_.Exception.Message)"
    }
}

Start-DevElectron

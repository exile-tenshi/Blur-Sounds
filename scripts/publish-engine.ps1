$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $root 'engine/VoiceMeeterEngine/VoiceMeeterEngine.csproj'
$output = Join-Path $root 'resources/engine'

New-Item -ItemType Directory -Path $output -Force | Out-Null

Write-Host "Publishing VoiceMeeterEngine (self-contained win-x64) to $output"

dotnet publish $project `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=false `
    -p:DebugType=none `
    -p:DebugSymbols=false `
    -o $output

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

# Ensure RNNoise native DLL sits beside the engine for DllImport("rnnoise").
$rnnoiseCandidates = @(
    (Join-Path $output 'rnnoise.dll'),
    (Join-Path $output 'runtimes\win-x64\native\rnnoise.dll')
)
$rnnoiseSource = $rnnoiseCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $rnnoiseSource) {
    $nugetRoot = Join-Path $env:USERPROFILE '.nuget\packages\yellowdogman.rrnoise.net'
    $rnnoiseSource = Get-ChildItem -Path $nugetRoot -Recurse -Filter 'rnnoise.dll' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'win-x64' } |
        Select-Object -First 1 -ExpandProperty FullName
}
if ($rnnoiseSource -and (Split-Path $rnnoiseSource -Parent) -ne $output) {
    Copy-Item -Force $rnnoiseSource (Join-Path $output 'rnnoise.dll')
}
if (-not (Test-Path (Join-Path $output 'rnnoise.dll'))) {
    Write-Warning 'rnnoise.dll was not found next to the engine - AI noise cancellation may fail to load.'
}

$exe = Join-Path $output 'VoiceMeeterEngine.exe'
if (-not (Test-Path $exe)) {
    throw "Expected published executable was not found: $exe"
}

Write-Host "Published $exe"

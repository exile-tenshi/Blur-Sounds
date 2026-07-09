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

$exe = Join-Path $output 'VoiceMeeterEngine.exe'
if (-not (Test-Path $exe)) {
    throw "Expected published executable was not found: $exe"
}

Write-Host "Published $exe"

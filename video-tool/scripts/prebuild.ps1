$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$binDir = Join-Path $repoRoot "src-tauri\binaries"
$ffmpeg = Join-Path $binDir "ffmpeg.exe"
$ffprobe = Join-Path $binDir "ffprobe.exe"

if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
  Write-Host "Missing bundled ffmpeg binaries. Run ./scripts/setup-ffmpeg.ps1 first." -ForegroundColor Red
  exit 1
}

Write-Host "Bundled ffmpeg binaries found."

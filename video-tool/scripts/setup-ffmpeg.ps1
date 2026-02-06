$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$binDir = Join-Path $repoRoot "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

function Copy-Binaries($ffmpegExePath) {
  $ffmpegDir = Split-Path -Parent $ffmpegExePath
  $ffprobeExePath = Join-Path $ffmpegDir "ffprobe.exe"

  if (-not (Test-Path $ffmpegExePath)) {
    throw "ffmpeg.exe not found at $ffmpegExePath"
  }
  if (-not (Test-Path $ffprobeExePath)) {
    throw "ffprobe.exe not found at $ffprobeExePath"
  }

  Copy-Item $ffmpegExePath (Join-Path $binDir "ffmpeg.exe") -Force
  Copy-Item $ffprobeExePath (Join-Path $binDir "ffprobe.exe") -Force
}

$ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "Installing ffmpeg via winget..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  }
}

if (-not $ffmpegCommand) {
  Write-Host "Downloading ffmpeg build..."
  $tempDir = Join-Path $env:TEMP "ffmpeg-download"
  $zipPath = Join-Path $tempDir "ffmpeg.zip"
  $downloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

  if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $tempDir

  $ffmpegExe = Get-ChildItem -Path $tempDir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
  if (-not $ffmpegExe) {
    throw "Unable to locate ffmpeg.exe in downloaded archive."
  }
  Copy-Binaries $ffmpegExe.FullName
} else {
  Copy-Binaries $ffmpegCommand.Source
}

Write-Host "ffmpeg.exe and ffprobe.exe copied to $binDir"

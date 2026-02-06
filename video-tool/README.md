# Video Tool

A Windows-focused Tauri app for inspecting and comparing video files, plus exporting/transcoding via bundled ffmpeg.

## Setup

1. Install bundled ffmpeg binaries (copies into `src-tauri/binaries/`):

```powershell
./scripts/setup-ffmpeg.ps1
```

2. Start the dev server and Tauri app (one-liner):

```powershell
./scripts/dev.ps1
```

This launches a lightweight PowerShell server for `src/` at `http://127.0.0.1:1420` and runs `cargo tauri dev`.

## Build (Release)

Ensure the binaries are present before bundling:

```powershell
./scripts/setup-ffmpeg.ps1
```

Then build the installer/exe:

```powershell
cargo tauri build
```

The release bundle uses `src-tauri/binaries/ffmpeg.exe` and `src-tauri/binaries/ffprobe.exe` from the app resources. A pre-build script checks for these binaries before bundling.

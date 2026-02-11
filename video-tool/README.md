# PixelDuel

PixelDuel is a Windows-focused Tauri app for inspecting, comparing, and exporting video files via bundled ffmpeg.

## Features

- Load two videos via file picker or drag-and-drop (auto-probe on load).
- Side-by-side previews with synchronized play/pause/reset controls.
- Single comparison table: left-aligned field labels with centered values for each input.
- Export modes: Input A only, Input B only, or side-by-side.
- Export controls:
  - Container: mp4/mov/mkv
  - Codec: H.264 / H.265
  - CRF
  - Resize with aspect lock
  - Target FPS
  - Trim start/end frame
  - Copy audio or re-encode AAC
- Progress and status updates during export.
- Output folder reveal after export.
- Automatic output filename de-duplication (adds `(1)`, `(2)`, etc.).

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

The release bundle uses `src-tauri/binaries/ffmpeg.exe` and `src-tauri/binaries/ffprobe.exe` from the app resources. A pre-build script checks for these binaries before bundling. After a successful build, run the generated `.exe` from `src-tauri/target/release/bundle/`.

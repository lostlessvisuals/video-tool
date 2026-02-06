$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$serverScript = Join-Path $PSScriptRoot "dev-server.ps1"

Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$serverScript`""
Start-Sleep -Seconds 1

Set-Location $repoRoot
cargo tauri dev

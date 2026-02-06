$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\..\src"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:1420/")
$listener.Start()
Write-Host "Serving $root at http://127.0.0.1:1420"

function Get-ContentType($path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".svg" { "image/svg+xml" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".ico" { "image/x-icon" }
    ".json" { "application/json; charset=utf-8" }
    Default { "application/octet-stream" }
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath
    if ($requestPath -eq "/") {
      $requestPath = "/index.html"
    }

    $relativePath = $requestPath.TrimStart("/")
    $filePath = Join-Path $root $relativePath

    if (Test-Path $filePath) {
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $context.Response.StatusCode = 200
      $context.Response.ContentType = Get-ContentType $filePath
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $message = [Text.Encoding]::UTF8.GetBytes("Not found")
      $context.Response.OutputStream.Write($message, 0, $message.Length)
    }

    $context.Response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
}

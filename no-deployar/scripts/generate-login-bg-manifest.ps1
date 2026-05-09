# Genera assets/login-bg-manifest.json a partir de imágenes en assets/ (jpg, png, gif, webp).
# Ejecutar desde la raíz del proyecto: powershell -NoProfile -File scripts\generate-login-bg-manifest.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$assets = Join-Path $root "assets"
$out = Join-Path $assets "login-bg-manifest.json"
if (-not (Test-Path $assets)) {
  Write-Error "No existe la carpeta assets: $assets"
}
$ext = @("*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp")
$files = @()
foreach ($e in $ext) {
  $files += Get-ChildItem -Path $assets -Filter $e -File -ErrorAction SilentlyContinue
}
$names = $files | Sort-Object Name | ForEach-Object { "assets/$($_.Name)" }
$json = @{ images = [string[]]$names } | ConvertTo-Json -Depth 5
Set-Content -Path $out -Value $json -Encoding UTF8
Write-Host "Escrito $out ($($names.Count) imagenes)."

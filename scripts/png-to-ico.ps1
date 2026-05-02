# Genera favicon.ico en la raíz del proyecto a partir de assets/logo.png
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pngPath = Join-Path $root "assets\logo.png"
$icoPath = Join-Path $root "favicon.ico"
if (-not (Test-Path $pngPath)) {
  Write-Error "No se encontró assets\logo.png"
}
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($pngPath)
try {
  $bw = New-Object System.Drawing.Bitmap(32, 32)
  $g = [System.Drawing.Graphics]::FromImage($bw)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, 32, 32)
  $g.Dispose()
  $hIcon = $bw.GetHicon()
  $ico = [System.Drawing.Icon]::FromHandle($hIcon)
  $fs = [System.IO.File]::Create($icoPath)
  try {
    $ico.Save($fs)
  } finally {
    $fs.Close()
  }
  $ico.Dispose()
  $bw.Dispose()
} finally {
  $img.Dispose()
}
Write-Host "Creado: $icoPath ($((Get-Item $icoPath).Length) bytes)"

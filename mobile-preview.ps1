# Abre la app en Edge y arranca un servidor HTTP local para probar como movil.
# Despues de cargar la pagina: Ctrl+Shift+M (Edge/Chrome) = modo dispositivo responsive.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$ports = @(8765, 8766, 8877, 9888)
$port = $null
foreach ($p in $ports) {
    $inUse = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if (-not $inUse) {
        $port = $p
        break
    }
}
if (-not $port) {
    Write-Host "No hay puerto libre entre $($ports -join ', '). Cierra otros servidores e intenta de nuevo." -ForegroundColor Yellow
    exit 1
}

Write-Host "Sirviendo G-neex en http://127.0.0.1:$port/ (carpeta: $RepoRoot)" -ForegroundColor Cyan

$pyArgs = "-m", "http.server", "$port"
$server = Start-Process -FilePath "py" -ArgumentList $pyArgs -PassThru -WindowStyle Hidden -WorkingDirectory $RepoRoot

Start-Sleep -Seconds 1

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
    $edge = "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $edge)) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    throw "No se encontro Microsoft Edge."
}

Start-Process $edge "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "Edge abierto. Para vista movil:" -ForegroundColor Green
Write-Host "  F12  ->  Ctrl+Shift+M  ->  elige iPhone/Pixel o tamanio manual." -ForegroundColor Green
Write-Host "  Gira el ancho/alto con el boton de rotacion del modo dispositivo." -ForegroundColor Green
Write-Host ""
Write-Host "Pulsa Enter aqui para detener el servidor..." -ForegroundColor Gray
Read-Host | Out-Null

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Write-Host "Servidor detenido." -ForegroundColor Cyan

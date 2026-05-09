# Genera PDF desde los .html de manuales y presentaciones (mismo contenido que en pantalla).
# Requisito: Microsoft Edge (Chromium) instalado.
# Uso: desde la raíz del repo:  powershell -NoProfile -ExecutionPolicy Bypass -File no-deployar\docs\export-user-docs-pdf.ps1
#      o con ruta:  -Root "C:\ruta\al\proyecto"

param(
    [string] $Root = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
)

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
    Write-Error "No se encontró msedge.exe. Instale Microsoft Edge o ajuste la ruta en este script."
    exit 1
}

$pairs = @(
    @{ Html = "no-deployar\User Manual\MANUAL_DE_USUARIO.html"; Pdf = "no-deployar\User Manual\MANUAL_DE_USUARIO.pdf" }
    @{ Html = "no-deployar\User Manual\USER_MANUAL.html";      Pdf = "no-deployar\User Manual\USER_MANUAL.pdf" }
    @{ Html = "no-deployar\User Manual\MANUEL_UTILISATEUR.html"; Pdf = "no-deployar\User Manual\MANUEL_UTILISATEUR.pdf" }
    @{ Html = "no-deployar\Presentation\PRESENTACION_GNEEX.html"; Pdf = "no-deployar\Presentation\PRESENTACION_GNEEX.pdf" }
    @{ Html = "no-deployar\Presentation\PRESENTATION_GNEEX.html"; Pdf = "no-deployar\Presentation\PRESENTATION_GNEEX.pdf" }
    @{ Html = "no-deployar\Presentation\PRESENTATION_GNEEX_FR.html"; Pdf = "no-deployar\Presentation\PRESENTATION_GNEEX_FR.pdf" }
)

foreach ($p in $pairs) {
    $htmlPath = Join-Path $Root $p.Html
    $pdfPath = Join-Path $Root $p.Pdf
    if (-not (Test-Path $htmlPath)) {
        Write-Warning "Omitido (no existe): $htmlPath"
        continue
    }
    $uri = ([Uri]$htmlPath).AbsoluteUri
    Write-Host "PDF <= $([IO.Path]::GetFileName($htmlPath))"
    # Edge headless a veces falla (p. ej. código 13) al escribir directamente en rutas sincronizadas (OneDrive).
    $tempPdf = Join-Path ([IO.Path]::GetTempPath()) ("gneex-print-{0}.pdf" -f [Guid]::NewGuid().ToString('n'))
    $proc = Start-Process -FilePath $edge -ArgumentList @(
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        "--print-to-pdf=$tempPdf",
        $uri
    ) -Wait -PassThru -WindowStyle Hidden
    $ok = $false
    if ($proc.ExitCode -eq 0 -and (Test-Path $tempPdf)) {
        Copy-Item -LiteralPath $tempPdf -Destination $pdfPath -Force
        $ok = $true
    }
    Remove-Item -LiteralPath $tempPdf -ErrorAction SilentlyContinue
    if (-not $ok) {
        Write-Warning "Fallo la impresión PDF (código $($proc.ExitCode)): $pdfPath"
    }
    if (-not (Test-Path $pdfPath)) {
        Write-Warning "No se generó: $pdfPath"
    }
}

Write-Host "Listo."

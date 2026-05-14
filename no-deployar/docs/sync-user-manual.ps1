# Copia manuales y presentaciones PDF desde no-deployar hacia user-manual/ (paquete Ayuda en producción).
# Sustituye rutas ../docs/app-screenshots/ por ./app-screenshots/ en manuales y presentaciones copiados a user-manual/
# (no usar ../app-screenshots/ en user-manual/: apuntaría al padre del repo, no a user-manual/app-screenshots/).
# Añade ?v=<unix> a cada URL de captura para evitar que el navegador sirva PNG viejos (Ayuda abre user-manual/*.html).
# Uso (desde la raíz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File no-deployar\docs\sync-user-manual.ps1

param(
    [string] $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$shotCacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

function Add-ScreenshotCacheBust([string] $Html) {
    # Quitar query previa en rutas app-screenshots/*.png
    $Html = $Html -replace '(\.\/app-screenshots\/[^"''\s>]+\.png)\?[^"''\s>]*', '$1'
    $Html = $Html -replace '(\.\.\/app-screenshots\/[^"''\s>]+\.png)\?[^"''\s>]*', '$1'
    # Añadir ?v= (una sola vez por URL)
    $v = $script:shotCacheBust
    $Html = $Html -replace '(\.\/app-screenshots\/[^"''\s>]+\.png)(")', "`$1?v=$v`$2"
    $Html = $Html -replace '(\.\.\/app-screenshots\/[^"''\s>]+\.png)(")', "`$1?v=$v`$2"
    return $Html
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Read-TextUtf8([string] $Path) {
    return [System.IO.File]::ReadAllText($Path, $Utf8NoBom)
}

function Write-TextUtf8([string] $Path, [string] $Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

$srcManual = Join-Path $Root "no-deployar\User Manual"
$dstManual = Join-Path $Root "user-manual"
$srcShots = Join-Path $Root "no-deployar\docs\app-screenshots"
$dstShots = Join-Path $Root "user-manual\app-screenshots"
$csvSrc = Join-Path $Root "PlantillasPermisos.xlsx.csv"
$csvDst = Join-Path $Root "user-manual\PlantillasPermisos.xlsx.csv"

if (-not (Test-Path $dstManual)) {
    New-Item -ItemType Directory -Path $dstManual -Force | Out-Null
}
if (-not (Test-Path $dstShots)) {
    New-Item -ItemType Directory -Path $dstShots -Force | Out-Null
}

$htmlFiles = @("MANUAL_DE_USUARIO.html", "USER_MANUAL.html", "MANUEL_UTILISATEUR.html")
foreach ($f in $htmlFiles) {
    $src = Join-Path $srcManual $f
    $dst = Join-Path $dstManual $f
    if (-not (Test-Path $src)) {
        Write-Warning "No existe: $src"
        continue
    }
    $content = Read-TextUtf8 $src
    $content = $content -replace '\.\./docs/app-screenshots/', './app-screenshots/'
    $content = Add-ScreenshotCacheBust $content
    Write-TextUtf8 $dst $content
    Write-Host "OK HTML -> $f (capturas ?v=$shotCacheBust)"
}

if (Test-Path $srcShots) {
    Copy-Item (Join-Path $srcShots "*") $dstShots -Force -ErrorAction SilentlyContinue
    Write-Host "OK capturas -> user-manual/app-screenshots"
}

if (Test-Path $csvSrc) {
    Copy-Item -LiteralPath $csvSrc -Destination $csvDst -Force
    Write-Host "OK PlantillasPermisos.xlsx.csv"
}

$pdfPairs = @(
    @{ Src = "no-deployar\User Manual\MANUAL_DE_USUARIO.pdf"; Dst = "user-manual\MANUAL_DE_USUARIO.pdf" }
    @{ Src = "no-deployar\User Manual\USER_MANUAL.pdf"; Dst = "user-manual\USER_MANUAL.pdf" }
    @{ Src = "no-deployar\User Manual\MANUEL_UTILISATEUR.pdf"; Dst = "user-manual\MANUEL_UTILISATEUR.pdf" }
    @{ Src = "no-deployar\Presentation\PRESENTACION_GNEEX.pdf"; Dst = "user-manual\PRESENTACION_GNEEX.pdf" }
    @{ Src = "no-deployar\Presentation\PRESENTATION_GNEEX.pdf"; Dst = "user-manual\PRESENTATION_GNEEX.pdf" }
    @{ Src = "no-deployar\Presentation\PRESENTATION_GNEEX_FR.pdf"; Dst = "user-manual\PRESENTATION_GNEEX_FR.pdf" }
)
foreach ($p in $pdfPairs) {
    $s = Join-Path $Root $p.Src
    $d = Join-Path $Root $p.Dst
    if (Test-Path $s) {
        Copy-Item -LiteralPath $s -Destination $d -Force
        Write-Host "OK PDF -> $($p.Dst)"
    }
}

$srcPres = Join-Path $Root "no-deployar\Presentation"
$presHtml = @("PRESENTACION_GNEEX.html", "PRESENTATION_GNEEX.html", "PRESENTATION_GNEEX_FR.html")
foreach ($f in $presHtml) {
    $src = Join-Path $srcPres $f
    $dst = Join-Path $dstManual $f
    if (-not (Test-Path $src)) {
        Write-Warning "No existe presentación: $src"
        continue
    }
    $content = Read-TextUtf8 $src
    $content = $content -replace '\.\./docs/app-screenshots/', './app-screenshots/'
    $content = Add-ScreenshotCacheBust $content
    Write-TextUtf8 $dst $content
    Write-Host "OK presentation HTML -> $f (capturas ?v=$shotCacheBust)"
}

Write-Host "Listo: user-manual/"

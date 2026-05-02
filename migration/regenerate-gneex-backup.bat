@echo off
setlocal
cd /d "%~dp0"

set "INPUT=generated\intermediate_from_HISTORY.json"
set "OUTPUT=generated\GNEEX_Respaldo_PHOENIX.json"

if not exist "%INPUT%" (
  echo [ERROR] No existe "%INPUT%".
  echo Genera primero el intermedio (history_xlsx_export_separate.py o parse-phoenix-tsv.mjs).
  pause
  exit /b 1
)

echo [INFO] Regenerando respaldo G-NEEX...
node "build-gneex-backup.mjs" --input "%INPUT%" --output "%OUTPUT%"
if errorlevel 1 (
  echo [ERROR] Fallo al generar el respaldo.
  pause
  exit /b 1
)

echo [OK] Respaldo actualizado:
echo      %OUTPUT%
pause

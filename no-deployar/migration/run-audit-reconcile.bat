@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "XLSX=%~1"
if "!XLSX!"=="" (
  echo.
  echo === Auditoria Phoenix (reconciliacion inventario vs movimientos) ===
  echo.
  echo Arrastra tu archivo .xlsx encima de este archivo .bat
  echo   o ejecuta desde aqui:
  echo   run-audit-reconcile.bat "C:\ruta\Libro1.xlsx"
  echo.
  pause
  exit /b 1
)

if not exist "!XLSX!" (
  echo No existe el archivo: !XLSX!
  pause
  exit /b 1
)

echo.
echo Ejecutando auditoria...
echo Excel: !XLSX!
echo.

where py >nul 2>&1
if errorlevel 1 (
  python "%~dp0audit_phoenix_reconcile.py" -i "!XLSX!"
) else (
  py -3 "%~dp0audit_phoenix_reconcile.py" -i "!XLSX!"
)

echo.
echo Informes en: %~dp0generated\
echo Si fallo: py -3 -m pip install openpyxl
echo.
pause

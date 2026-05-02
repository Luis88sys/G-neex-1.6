@echo off
chcp 65001 >nul
REM Activa el icono personalizado de esta carpeta en el Explorador de Windows (usa favicon.ico).
attrib +s "%~dp0"
echo.
echo Carpeta marcada. Pulse F5 en el Explorador si no ve el icono al instante.
echo.
pause

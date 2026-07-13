@echo off
chcp 65001 >nul
REM Snapshot do cadastro de emissores (grupo economico) -> public\Emissores.csv.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-emissores.ps1" %*
echo.
pause

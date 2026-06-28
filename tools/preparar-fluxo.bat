@echo off
chcp 65001 >nul
REM Gera as bases semanais da aba Captacao a partir do Informe Diario da CVM.
REM Sem argumentos = ultimos 12 meses. Ex. com meses: preparar-fluxo.bat -Meses 202504,202505
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-fluxo.ps1" %*
echo.
pause

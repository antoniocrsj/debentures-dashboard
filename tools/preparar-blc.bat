@echo off
chcp 65001 >nul
REM Clique duas vezes (baixa o CDA direto da CVM), ou arraste um .xlsx local
REM pra cima deste arquivo pra usar ele em vez de baixar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-blc.ps1" -XlsxPath "%~1"
echo.
pause

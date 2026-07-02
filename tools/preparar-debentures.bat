@echo off
chcp 65001 >nul
REM Baixa a lista publica de debentures do Debentures.com.br -> public/Debentures.csv
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-debentures.ps1" %*
echo.
pause


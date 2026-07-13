@echo off
chcp 65001 >nul
REM Traz uma edicao feita na planilha de fundos de volta para os arquivos locais Fundos_12431.csv / Fundos_CDI.csv.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sincronizar-fundos-planilha.ps1" %*
echo.
pause

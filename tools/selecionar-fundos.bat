@echo off
chcp 65001 >nul
REM Gera sugestoes de fundos 12.431/CDI (tools\Sugestao_*.csv) para revisao manual. Nao sobrescreve as listas curadas.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0selecionar-fundos.ps1" %*
echo.
pause

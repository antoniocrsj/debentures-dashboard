@echo off
chcp 65001 >nul
REM Atualizacao incremental: processa apenas o mes atual + anterior.
REM Use este para atualizacoes do dia a dia (rapido).
REM Para reconstruir todo o historico, use preparar-fluxo.bat.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-fluxo.ps1" -Incremental %*
echo.
pause

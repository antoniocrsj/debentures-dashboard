@echo off
chcp 65001 >nul
REM Arraste o .xlsx da CVM para cima deste arquivo, ou apenas clique duas vezes
REM (ele pega o cda_fi_BLC mais recente da pasta padrao).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-blc.ps1" %1
echo.
pause

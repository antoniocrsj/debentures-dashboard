@echo off
chcp 65001 >nul
REM Gera public\data\Fundos_Atributos.csv (Forma/Tipo/Situacao/datas/PL dos fundos curados, da CVM) para uso offline.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-atributos-fundos.ps1" %*
echo.
pause

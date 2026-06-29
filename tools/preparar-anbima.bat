@echo off
chcp 65001 >nul
REM Gera a base de Taxas ANBIMA (coluna "Tx Anbima") -> public/Anbima_Tx.csv
REM
REM Uso:
REM   - Duplo clique: usa a ultima data util publicada (baixa sozinho).
REM   - Data especifica:  preparar-anbima.bat -Data 2026-06-26
REM   - Forcar re-download: preparar-anbima.bat -Force
REM   - Modo manual (arquivos ja baixados):
REM       preparar-anbima.bat -DebFile "C:\...\d26jun26.xls" -TpfFile "C:\...\ms260626.txt"
REM
REM Requisitos: Microsoft Excel instalado (le o .xls binario da ANBIMA via COM).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-anbima.ps1" %*
echo.
pause

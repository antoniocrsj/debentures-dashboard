@echo off
chcp 65001 >nul
REM Sobe o BLC_tratado.csv (gerado pelo preparar-blc.bat) para o ar.
cd /d "%~dp0.."

echo.
echo Publicando atualizacao do BLC...
echo.

git add public/BLC_tratado.csv
git commit -m "Atualiza BLC"
git push

echo.
echo ============================================
echo  Pronto! O app atualiza no ar em ~1 minuto.
echo ============================================
echo.
pause

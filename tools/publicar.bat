@echo off
chcp 65001 >nul
REM Sobe os arquivos de dados (BLC e Captacao) gerados em public/ para o ar.
cd /d "%~dp0.."

echo.
echo Publicando atualizacao dos dados...
echo.

git add public/
git commit -m "Atualiza dados (BLC / Captacao)"
git push

echo.
echo ============================================
echo  Pronto! O app atualiza no ar em ~1 minuto.
echo ============================================
echo.
pause

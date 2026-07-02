@echo off
chcp 65001 >nul
REM Atualizacao completa em 1 clique:
REM   1. Captacao sempre
REM   2. BLC se houver mes novo
REM   3. ANBIMA se possivel
REM   4. Pergunta se deve publicar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-tudo.ps1" %*
echo.
pause


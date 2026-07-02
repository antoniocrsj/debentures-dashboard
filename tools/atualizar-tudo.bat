@echo off
chcp 65001 >nul
REM Atualizacao completa em 1 clique:
REM   1. Captacao sempre
REM   2. Cadastro de debentures sempre
REM   3. BLC se houver mes novo
REM   4. ANBIMA se possivel
REM   5. Pergunta se deve publicar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-tudo.ps1" %*
echo.
pause

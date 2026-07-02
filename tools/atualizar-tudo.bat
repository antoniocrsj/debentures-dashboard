@echo off
chcp 65001 >nul
REM Atualizacao completa em 1 clique:
REM   1. Cadastro de debentures sempre
REM   2. Avalia/aplica Fundos_12431 e Fundos_CDI se confirmado
REM   3. Captacao sempre
REM   4. BLC se houver mes novo
REM   5. ANBIMA se possivel
REM   6. Pergunta se deve publicar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-tudo.ps1" %*
echo.
pause

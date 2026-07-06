@echo off
rem Sobe o servidor de desenvolvimento (Vite) e abre o navegador direto no
rem Painel de Atualizacao. O painel so existe em modo dev; por isso este
rem atalho roda "npm run dev". Deixe esta janela aberta enquanto usa o painel.
title Painel de Atualizacao - BI Credito Privado
cd /d "%~dp0.."
echo.
echo   Iniciando o Painel de Atualizacao...
echo   Deixe ESTA janela aberta enquanto usa o painel.
echo   Para encerrar, feche a janela (ou pressione Ctrl+C).
echo.
call npm run dev -- --open "/#atualizacao"
echo.
echo   Servidor encerrado. Pode fechar a janela.
pause

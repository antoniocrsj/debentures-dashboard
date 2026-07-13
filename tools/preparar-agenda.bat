@echo off
chcp 65001 >nul
REM Baixa e mantem em cache a AGENDA DE EVENTOS (juros + amortizacao) de cada
REM debenture (ANBIMA Data API) -> dados-anbima\agenda-cache\<TICKER>.json.
REM E a "peca lenta" do planejamento de Vencimentos 12m (1a carga demora).
REM
REM Uso:
REM   - Duplo clique: rodada incremental (baixa o que falta / esta vencido).
REM   - Limitar tempo (ex.: 15 min):   preparar-agenda.bat -MaxSegundos 900
REM   - Forcar re-download de tudo:    preparar-agenda.bat -Force
REM   - So a carteira (ignora Anbima):  preparar-agenda.bat -SomenteCarteira
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-agenda.ps1" %*
echo.
pause

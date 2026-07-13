@echo off
chcp 65001 >nul
REM Calcula o Caixa Potencial dos fundos de credito (disponibilidades + titulos
REM publicos + compromissadas, direto + look-through via fundos-caixa) a partir
REM do CDA da CVM. Gera public\data\Caixa_Potencial_*.csv/json.
REM
REM Uso:
REM   - Duplo clique: rodada normal (M-1..M-3 + referencia madura; baixa o CDA
REM     que faltar). Demora (~20 min na 1a vez).
REM   - Validar so' o motor (rapido, sem gerar arquivo): preparar-caixa-potencial.bat -SelfTest
REM   - Usar o CDA ja' baixado (nao baixa nada):          preparar-caixa-potencial.bat -NoDownload
REM   - Meses especificos:  preparar-caixa-potencial.bat -MesesRecentes 202605,202604,202603 -MesRefMadura 202602
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-caixa-potencial.ps1" %*
echo.
pause

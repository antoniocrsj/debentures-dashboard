<#
  aplicar-fundos.ps1
  --------------------------------------------------------------------------
  Wrapper fino: aplica a sugestao de fundos ja gerada por selecionar-fundos.ps1
  (copia Sugestao_Lista_Final_12431.csv / Sugestao_Lista_Final_CDI.csv por cima
  de Fundos_12431.csv / Fundos_CDI.csv). Nao roda a selecao de novo.

  Usado pelo painel de controle web (botao "Aplicar sugestao de fundos") e
  pode ser rodado direto no terminal apos conferir o relatorio de
  selecionar-fundos.ps1.
#>

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

$sugestao12431 = Join-Path $PSScriptRoot 'Sugestao_Lista_Final_12431.csv'
$sugestaoCdi   = Join-Path $PSScriptRoot 'Sugestao_Lista_Final_CDI.csv'
if (-not (Test-Path $sugestao12431) -or -not (Test-Path $sugestaoCdi)) {
  throw "Nao encontrei as listas de sugestao. Rode selecionar-fundos.ps1 primeiro."
}

$antes = Get-FundosMetrics $PSScriptRoot
Apply-FundosSuggestion $PSScriptRoot
$depois = Get-FundosMetrics $PSScriptRoot

Write-Host ""
Write-Host "=== Sugestao de fundos aplicada ===" -ForegroundColor Green
Write-FundosCompare $antes $depois

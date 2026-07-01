<#
  sincronizar-fundos-planilha.ps1
  --------------------------------------------------------------------------
  Busca as abas Fundos_12431 e Fundos_CDI da planilha (GAS) e SOBRESCREVE os
  arquivos locais tools\Fundos_12431.csv / tools\Fundos_CDI.csv com o
  conteudo atual da planilha.

  Uso pontual: a partir de agora, preparar-fluxo.ps1 / preparar-blc.ps1 /
  selecionar-fundos.ps1 leem esses dois CSVs locais (nao mais a planilha) --
  rode este script se algum dia editar Fundos_12431/Fundos_CDI direto na
  planilha e quiser trazer essa edicao de volta pro arquivo local.

  Uso: powershell -File sincronizar-fundos-planilha.ps1
#>

param(
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== Sincronizar Fundos_12431 / Fundos_CDI (planilha -> local) ===" -ForegroundColor Green

function Write-FundosCsv($rows, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,CNPJ Gestor')
  foreach ($r in ($rows | Sort-Object Denom)) {
    [void]$sb.AppendLine(('"{0}","{1}","{2}"' -f $r.Cnpj, $r.Denom.Replace('"', '""'), $r.CnpjGestor))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
}

Step "Buscando Fundos_12431 na planilha..."
$rows12431 = Get-FundosRawFromGas $CadastroUrl 'Fundos_12431'
Step "  $($rows12431.Count) fundos"
$out12431 = Join-Path $PSScriptRoot 'Fundos_12431.csv'
Write-FundosCsv $rows12431 $out12431

Step "Buscando Fundos_CDI na planilha..."
$rowsCdi = Get-FundosRawFromGas $CadastroUrl 'Fundos_CDI'
Step "  $($rowsCdi.Count) fundos"
$outCdi = Join-Path $PSScriptRoot 'Fundos_CDI.csv'
Write-FundosCsv $rowsCdi $outCdi

Write-Host ""
Write-Host "=== PRONTO ===" -ForegroundColor Green
Write-Host "  $out12431  ($($rows12431.Count) fundos)" -ForegroundColor Yellow
Write-Host "  $outCdi  ($($rowsCdi.Count) fundos)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Proximo: confira os arquivos e faca 'git add tools/Fundos_12431.csv tools/Fundos_CDI.csv' + commit." -ForegroundColor White
Write-Host ""

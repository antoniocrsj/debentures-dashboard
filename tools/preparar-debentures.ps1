<#
  preparar-debentures.ps1
  --------------------------------------------------------------------------
  Baixa a lista publica de caracteristicas de debentures do Debentures.com.br
  e grava um CSV estatico para o app consumir sem depender do GAS em tempo real.

  Saida:
    public/Debentures.csv
    public/Debentures_meta.json
#>

param(
  [string]$OutPath = '',
  [string]$MetaPath = '',
  [string]$SourceUrl = 'https://www.debentures.com.br/exploreosnd/consultaadados/emissoesdedebentures/caracteristicas_e.asp?tip_deb=publicas&op_exc=False'
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutPath) { $OutPath = Join-Path $Root 'public\Debentures.csv' }
if (-not $MetaPath) { $MetaPath = Join-Path $Root 'public\Debentures_meta.json' }

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Csv-Field($v) { '"' + (([string]$v) -replace '"','""') + '"' }
function Unique-Headers($headers) {
  $seen = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($h in $headers) {
    $name = ([string]$h).Trim()
    if ($name -eq '') { $name = 'Coluna' }
    if (-not $seen.ContainsKey($name)) {
      $seen[$name] = 1
      $out.Add($name)
    } else {
      $seen[$name] += 1
      $out.Add(("{0} {1}" -f $name, $seen[$name]))
    }
  }
  return $out.ToArray()
}

Write-Host ""
Write-Host "=== Preparar cadastro de Debentures ===" -ForegroundColor Green
Step "Baixando base publica do Debentures.com.br..."

$wc = New-Object System.Net.WebClient
$bytes = $wc.DownloadData($SourceUrl)
if ($bytes.Count -lt 100) { throw "Resposta muito pequena ao baixar debentures." }

# O endpoint responde application/vnd.ms-excel, mas o conteudo e texto tabulado latin-1.
$text = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($bytes)
$lines = @($text -split '\r?\n' | Where-Object { $_.Trim() -ne '' })
$headerIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^Codigo do Ativo\s*\t') { $headerIndex = $i; break }
}
if ($headerIndex -lt 0) { throw "Nao encontrei o cabecalho 'Codigo do Ativo' na base baixada." }

$generatedLine = ''
for ($i = 0; $i -lt $headerIndex; $i++) {
  if ($lines[$i] -match 'Gerado em\s+(.+)$') { $generatedLine = $matches[1].Trim() }
}

$headers = @(Unique-Headers ($lines[$headerIndex].Split("`t") | ForEach-Object { $_.Trim() }))
if ($headers.Count -lt 10) { throw "Cabecalho inesperado na base de debentures." }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine(($headers | ForEach-Object { Csv-Field $_ }) -join ',')

$rows = 0
$ativos = New-Object System.Collections.Generic.HashSet[string]
$emissores = New-Object System.Collections.Generic.HashSet[string]
$idxAtivo = [Array]::IndexOf($headers, 'Codigo do Ativo')
$idxCnpj = [Array]::IndexOf($headers, 'CNPJ')

for ($i = $headerIndex + 1; $i -lt $lines.Count; $i++) {
  $cols = @($lines[$i].Split("`t") | ForEach-Object { $_.Trim() })
  if ($cols.Count -lt 2) { continue }
  $ativo = if ($idxAtivo -ge 0 -and $cols.Count -gt $idxAtivo) { $cols[$idxAtivo].Trim() } else { '' }
  if ($ativo -eq '') { continue }

  while ($cols.Count -lt $headers.Count) { $cols += '' }
  if ($cols.Count -gt $headers.Count) { $cols = $cols[0..($headers.Count - 1)] }

  [void]$ativos.Add($ativo)
  if ($idxCnpj -ge 0 -and $cols.Count -gt $idxCnpj -and $cols[$idxCnpj].Trim() -ne '') {
    [void]$emissores.Add(($cols[$idxCnpj] -replace '\D',''))
  }
  [void]$sb.AppendLine(($cols | ForEach-Object { Csv-Field $_ }) -join ',')
  $rows++
}

if ($rows -eq 0) { throw "Nenhuma linha de debenture foi convertida." }

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutPath, $sb.ToString(), $utf8)

$meta = [ordered]@{
  source = $SourceUrl
  generatedAtSource = $generatedLine
  updatedAt = (Get-Date).ToString('s')
  rows = $rows
  ativos = $ativos.Count
  emissores = $emissores.Count
}
[System.IO.File]::WriteAllText($MetaPath, (($meta | ConvertTo-Json) + "`r`n"), $utf8)

Write-Host ""
Write-Host "=== PRONTO ===" -ForegroundColor Green
Write-Host "  Linhas    : $rows"
Write-Host "  Ativos    : $($ativos.Count)"
Write-Host "  Emissores : $($emissores.Count)"
if ($generatedLine) { Write-Host "  Fonte     : gerado em $generatedLine" }
Write-Host "  Arquivo   : $OutPath" -ForegroundColor Yellow
Write-Host ""

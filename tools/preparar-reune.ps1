<#
  preparar-reune.ps1
  --------------------------------------------------------------------------
  Mantem o HISTORICO de previas de negociacao de debentures do REUNE ANBIMA
  (public/REUNE_Historico.csv) -- formato LONG (uma linha por ativo x dia),
  base para a tabela do dia e para graficos de serie temporal (taxa/PU no tempo).

  ACUMULA, nao sobrescreve: a cada rodada garante que os ultimos N dias uteis com
  previa estejam no historico, baixando SO' os dias que ainda faltam (dedup por
  data). Semeia com 5 dias uteis na primeira vez; depois cresce ~1 dia por
  pregao. O historico nunca e' podado -- e' a materia-prima dos graficos.

  LIMPEZA (por dia, pedido do usuario): taxas truncadas para 2 casas e so' trades
  com DISPERSAO REAL de taxa (min != med E max != med). Descarta negocio unico e
  trades sem taxa. PU fica no valor original.

  Fonte/Auth: API data.anbima.com.br (web-bff), JWT anonimo gerado localmente --
  MESMO padrao ja' em producao em preparar-anbima.ps1 (New-AnbimaDataJwt), com
  autorizacao explicita do usuario (2026-07-25). Sem login/captcha; o endpoint
  devolve link S3 pre-assinado (publico) com o CSV.

  Uso:
    - Automatico (garante 5 dias uteis, incremental):  preparar-reune.ps1
    - Semear mais dias:                                 preparar-reune.ps1 -Dias 10

  Saida: public/REUNE_Historico.csv (+ REUNE_Historico_meta.json).
#>

param(
  [int]$Dias = 5,                    # quantos dias uteis recentes garantir no historico
  [ValidateSet('24H00','11H00','13H00','16H00','18H00')]
  [string]$Periodo = '24H00',
  [string]$OutPath = '',
  [int]$LookbackDias = 14           # janela de dias uteis vasculhada (cobre feriados)
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutPath) { $OutPath = Join-Path $Root 'public\REUNE_Historico.csv' }
$MetaPath = ($OutPath -replace '\.csv$', '') + '_meta.json'

function Step($m)  { Write-Host "  $m" -ForegroundColor Cyan }
function Aviso($m) { Write-Host "  $m" -ForegroundColor Yellow }

# --- JWT anonimo: MESMA logica de preparar-anbima.ps1 (New-AnbimaDataJwt) -----
function B64Url($bytes) { [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
function New-AnbimaDataJwt {
  $secret = 'Sx!RNAMs@TXN_d!v9e*B%bPG-+AB%DZv9tq@TuFB'
  $header = B64Url ([Text.Encoding]::UTF8.GetBytes('{"typ":"JWT","alg":"HS256"}'))
  $payloadObj = [ordered]@{
    tokenRecaptcha        = [guid]::NewGuid().ToString()
    verificationHashCache = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  $payload = B64Url ([Text.Encoding]::UTF8.GetBytes(($payloadObj | ConvertTo-Json -Compress)))
  $data = "$header.$payload"
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
  $sig  = B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($data)))
  return "$data.$sig"
}

function Get-ReuneLink([string]$dataPrevia) {
  $qs = "data-previa=$dataPrevia&periodo-previa=$Periodo&tipo-ativo=DEB&extensao-arquivo=CSV"
  $url = "https://data-api.prd.anbima.com.br/web-bff/v1/reune/previas/download?$qs"
  $headers = @{
    'User-Agent'             = 'Mozilla/5.0'
    'Origin'                 = 'https://data.anbima.com.br'
    'Referer'                = 'https://data.anbima.com.br/reune/previas/debentures'
    'g-google-authorization' = New-AnbimaDataJwt
  }
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $headers -TimeoutSec 60
    $j = $resp.Content | ConvertFrom-Json
    if ($j.link_download) { return [string]$j.link_download }
  } catch { }
  return $null
}

function CsvField($v) { '"' + ((''+$v).Trim() -replace '"','""') + '"' }
$ptBR = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')
function Trunc2($s) {   # "8,6148" -> 8.61 (trunca, nao arredonda). $null se vazio/'--'.
  $v = ('' + $s).Trim()
  if (-not $v -or $v -eq '--') { return $null }
  $n = 0.0
  if (-not [double]::TryParse(($v -replace ',', '.'), [Globalization.NumberStyles]::Any,
      [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $null }
  return [Math]::Truncate($n * 100) / 100
}

# Baixa e limpa um dia. Retorna array de PSCustomObject (long) ou $null se sem previa.
function Get-LinhasDoDia([string]$dataISO) {
  $link = Get-ReuneLink $dataISO
  if (-not $link) { return $null }
  $tmp = [IO.Path]::GetTempFileName()
  try { Invoke-WebRequest -Uri $link -OutFile $tmp -TimeoutSec 120 -UseBasicParsing }
  catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; return $null }

  $conteudo = [IO.File]::ReadAllText($tmp, [Text.Encoding]::GetEncoding('ISO-8859-1'))
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($conteudo -notmatch '(?i)CETIP') { return $null }
  $linhas = @($conteudo -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
  $idxHeader = ($linhas | Select-String -Pattern '^CETIP;' | Select-Object -First 1).LineNumber
  if (-not $idxHeader) { return $null }

  $out = New-Object System.Collections.Generic.List[object]
  foreach ($ln in $linhas[$idxHeader..($linhas.Count - 1)]) {
    $c = $ln -split ';'
    if ($c.Count -lt 12) { continue }
    if ($c[4].Trim() -ne 'Total') { continue }
    $ativo = $c[0].Trim()
    if (-not $ativo -or $ativo -eq '--') { continue }
    $mn = Trunc2 $c[5]; $md = Trunc2 $c[6]; $mx = Trunc2 $c[7]
    if ($null -eq $mn -or $null -eq $md -or $null -eq $mx) { continue }   # sem taxa
    if ($mn -eq $md -or $mx -eq $md) { continue }                         # dispersao insuficiente
    $out.Add([pscustomobject]@{
      Ativo        = $ativo
      Data         = $dataISO
      'Taxa Minima' = $mn.ToString('0.00', $ptBR)
      'Taxa Media'  = $md.ToString('0.00', $ptBR)
      'Taxa Maxima' = $mx.ToString('0.00', $ptBR)
      'PU Medio'    = ($c[9]).Trim()
      'Faixa de Volume' = ($c[11]).Trim()
    })
  }
  return $out
}

# Ultimos N dias uteis a partir de hoje (recente -> antigo).
function Get-DiasUteis([int]$n) {
  $r = @(); $d = (Get-Date).Date
  while ($r.Count -lt $n) {
    if ($d.DayOfWeek -ne 'Saturday' -and $d.DayOfWeek -ne 'Sunday') { $r += $d.ToString('yyyy-MM-dd') }
    $d = $d.AddDays(-1)
  }
  return $r
}

Write-Host ""
Write-Host "=== Preparar historico REUNE (mercado secundario) ===" -ForegroundColor Green

# Historico existente (para acumular).
$existentes = @()
$datasHist = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $OutPath) {
  $existentes = @(Import-Csv -LiteralPath $OutPath -Encoding UTF8)
  foreach ($r in $existentes) { [void]$datasHist.Add($r.Data) }
}

# Garante os $Dias dias uteis mais recentes COM previa; baixa so' o que falta.
$novas = New-Object System.Collections.Generic.List[object]
$diasOk = 0; $baixados = @()
foreach ($dt in (Get-DiasUteis $LookbackDias)) {
  if ($diasOk -ge $Dias) { break }
  if ($datasHist.Contains($dt)) { $diasOk++; continue }   # ja' no historico, conta
  Step "Buscando previa de $dt ($Periodo)..."
  $linhas = Get-LinhasDoDia $dt
  if (-not $linhas -or $linhas.Count -eq 0) { Aviso "  sem previa em $dt (feriado?)"; continue }
  foreach ($l in $linhas) { $novas.Add($l) }
  $baixados += $dt; $diasOk++
}

if ($novas.Count -eq 0 -and $existentes.Count -eq 0) {
  Aviso "AVISO: nenhuma previa disponivel e sem historico anterior. Nada gerado."
  return
}

# Merge: existentes + novas, dedup por Ativo+Data, ordena Data desc / Ativo asc.
$todas = New-Object System.Collections.Generic.List[object]
foreach ($r in $existentes) { $todas.Add($r) }
foreach ($r in $novas)      { $todas.Add($r) }
$vistos = New-Object System.Collections.Generic.HashSet[string]
$dedup = foreach ($r in $todas) { if ($vistos.Add("$($r.Ativo)|$($r.Data)")) { $r } }
$ordenado = $dedup | Sort-Object @{Expression='Data';Descending=$true}, @{Expression='Ativo';Descending=$false}

# Grava CSV long (UTF-8, virgula, aspado).
$cols = @('Ativo','Data','Taxa Minima','Taxa Media','Taxa Maxima','PU Medio','Faixa de Volume')
$saida = New-Object System.Collections.Generic.List[string]
$saida.Add(($cols -join ','))
foreach ($r in $ordenado) {
  $saida.Add((($cols | ForEach-Object { CsvField $r.$_ }) -join ','))
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutPath, (($saida -join "`r`n") + "`r`n"), $utf8)

$datas = @($ordenado | ForEach-Object { $_.Data } | Select-Object -Unique | Sort-Object -Descending)
$meta = [ordered]@{
  fonte         = 'REUNE ANBIMA (previas publicas de negociacao) -- historico long'
  periodo       = $Periodo
  dias          = $datas.Count
  data_recente  = if ($datas.Count) { $datas[0] } else { $null }
  data_antiga   = if ($datas.Count) { $datas[-1] } else { $null }
  linhas        = $ordenado.Count
  gerado_em     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
}
[IO.File]::WriteAllText($MetaPath, ($meta | ConvertTo-Json), $utf8)

$msgBaix = if ($baixados.Count) { "baixados: $($baixados -join ', ')" } else { 'nada novo a baixar' }
Write-Host ("  OK: historico com {0} dia(s), {1} linhas ({2}). -> {3}" -f $datas.Count, $ordenado.Count, $msgBaix, $OutPath) -ForegroundColor Green

<#
  preparar-reune-curvas.ps1
  --------------------------------------------------------------------------
  Mantem o HISTORICO de curvas de titulos publicos (NTN-B e LTN) por dia, casado
  as datas do REUNE (public/REUNE_Curvas.csv). E' a materia-prima para converter
  a taxa negociada do secundario em SPREAD sobre a referencia (metodologia do
  Tx Anbima), usando a curva da PROPRIA data de cada trade -- ver
  src/utils/spreadRef.js e enrichReune.

  Fonte: ANBIMA Data API (/web-bff/v1/titulos-publicos, view=precos) -- MESMA auth
  (JWT anonimo, New-AnbimaDataJwt) ja' em producao em preparar-anbima.ps1, com
  autorizacao explicita do usuario. Cada titulo traz o HISTORICO de precos
  (.precos, por data_referencia), entao UMA busca da a curva de TODAS as datas do
  REUNE que a API ainda cobre. Datas fora do alcance do historico da API ficam
  sem curva (conversao pendente; o front mantem a taxa crua).

  ACUMULA por (data,tipo,venc): so' adiciona o que falta; nunca poda.

  Uso:
    preparar-reune-curvas.ps1                # cobre todas as datas do historico
    preparar-reune-curvas.ps1 -MaxDatas 3    # so' as N datas mais recentes (teste)

  Saida: public/REUNE_Curvas.csv (data,tipo,vencimento,taxa) + _meta.json
#>

param(
  [string]$HistPath = '',
  [string]$OutPath  = '',
  [int]$MaxDatas = 0,          # 0 = todas as datas do historico
  [int]$MaxSegundos = 180
)

$ErrorActionPreference = 'Stop'
$ci = [System.Globalization.CultureInfo]::InvariantCulture
$Root = Split-Path $PSScriptRoot -Parent
if (-not $HistPath) { $HistPath = Join-Path $Root 'public\REUNE_Historico.csv' }
if (-not $OutPath)  { $OutPath  = Join-Path $Root 'public\REUNE_Curvas.csv' }
$MetaPath = ($OutPath -replace '\.csv$', '') + '_meta.json'
$Deadline = (Get-Date).AddSeconds($MaxSegundos)

function Log($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }

# --- helpers numericos/datas ------------------------------------------------
function Parse-NumPt($s) {
  if ($null -eq $s) { return $null }
  if ($s -is [double] -or $s -is [int] -or $s -is [long] -or $s -is [decimal] -or $s -is [single]) { return [double]$s }
  $t = ([string]$s).Trim()
  if ($t -eq '' -or $t -eq '--' -or $t -eq '-' -or $t -match '^(?i)n/?d$' -or $t -match '^(?i)n/?a$') { return $null }
  if ($t -match ',') { $t = $t -replace '\.', '' -replace ',', '.' }
  $n = 0.0
  if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Any, $ci, [ref]$n)) { return $n }
  return $null
}
function Cell-ToDate($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [double] -or $v -is [int]) { try { return [DateTime]::FromOADate([double]$v) } catch { return $null } }
  $t = ([string]$v).Trim(); if ($t -eq '') { return $null }
  $d = [DateTime]::MinValue
  foreach ($fmt in @('yyyy-MM-dd', 'dd/MM/yyyy', 'd/M/yyyy', 'yyyyMMdd', 'yyyy-MM-ddTHH:mm:ss')) {
    if ([DateTime]::TryParseExact($t, $fmt, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
  }
  if ([DateTime]::TryParse($t, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
  return $null
}

# --- auth + fetch da ANBIMA Data API (mesma de preparar-anbima.ps1) ----------
function B64Url($bytes) { return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function New-AnbimaDataJwt {
  $secret = 'Sx!RNAMs@TXN_d!v9e*B%bPG-+AB%DZv9tq@TuFB'
  $header = B64Url ([System.Text.Encoding]::UTF8.GetBytes('{"typ":"JWT","alg":"HS256"}'))
  $payloadObj = [ordered]@{
    tokenRecaptcha        = [guid]::NewGuid().ToString()
    verificationHashCache = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  $payload = B64Url ([System.Text.Encoding]::UTF8.GetBytes(($payloadObj | ConvertTo-Json -Compress)))
  $data = "$header.$payload"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($secret))
  $sig = B64Url ($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($data)))
  return "$data.$sig"
}
function Invoke-AnbimaDataApi($path, $query) {
  $qs = ($query.GetEnumerator() | ForEach-Object {
      '{0}={1}' -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value)
    }) -join '&'
  $url = "https://data-api.prd.anbima.com.br$path`?$qs"
  $headers = @{
    'User-Agent'              = 'Mozilla/5.0'
    'Origin'                  = 'https://data.anbima.com.br'
    'Referer'                 = 'https://data.anbima.com.br/busca/debentures?view=precos'
    'g-google-authorization'  = New-AnbimaDataJwt
    'Params'                  = '?view=precos'
  }
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $headers -TimeoutSec 60
  $json = $null
  try { $ms = $resp.RawContentStream; if ($ms -and $ms.Length -gt 0) { $json = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) } } catch { $json = $null }
  if ([string]::IsNullOrEmpty($json)) { $json = [string]$resp.Content }
  return ($json | ConvertFrom-Json)
}
# Baixa TODOS os titulos publicos (paginado), cada um com .precos (historico).
function Fetch-TitulosPublicos {
  $rows = New-Object System.Collections.Generic.List[object]
  $tp = Invoke-AnbimaDataApi '/web-bff/v1/titulos-publicos' ([ordered]@{ view = 'precos'; page = 0; size = 200; field = 'data_vencimento'; order = 'asc' })
  foreach ($x in $tp.content) { $rows.Add($x) }
  for ($p = 1; $p -lt [int]$tp.total_pages; $p++) {
    if ((Get-Date) -gt $Deadline) { Log "Limite de tempo atingido nos titulos publicos; seguindo com o que baixou." 'Yellow'; break }
    $j = Invoke-AnbimaDataApi '/web-bff/v1/titulos-publicos' ([ordered]@{ view = 'precos'; page = $p; size = 200; field = 'data_vencimento'; order = 'asc' })
    foreach ($x in $j.content) { $rows.Add($x) }
  }
  return $rows
}

Write-Host ""
Write-Host "=== Preparar curvas TPF por dia (secundario) ===" -ForegroundColor Green

if (-not (Test-Path $HistPath)) { throw "REUNE_Historico.csv nao encontrado: $HistPath" }
$datas = @(Import-Csv -Path $HistPath | ForEach-Object { $_.Data } | Where-Object { $_ } | Sort-Object -Unique)
Log ("Datas no historico do REUNE: {0}" -f $datas.Count)

# Curvas ja' no arquivo (dedup por linha; datas ja' cobertas)
$linhas = New-Object System.Collections.Generic.List[string]
$chaves = New-Object System.Collections.Generic.HashSet[string]
$temData = @{}
if (Test-Path $OutPath) {
  foreach ($r in Import-Csv -Path $OutPath) {
    $l = '"{0}","{1}","{2}","{3}"' -f $r.data, $r.tipo, $r.vencimento, $r.taxa
    if ($chaves.Add($l)) { $linhas.Add($l) }
    $temData[$r.data] = $true
  }
  Log ("Curvas ja' no arquivo: {0} pontos, {1} data(s)" -f $linhas.Count, $temData.Count)
}

$aFazer = @($datas | Where-Object { -not $temData[$_] })
if ($MaxDatas -gt 0 -and $aFazer.Count -gt $MaxDatas) { $aFazer = @($aFazer)[($aFazer.Count - $MaxDatas)..($aFazer.Count - 1)] }
Log ("Datas a cobrir agora: {0}" -f $aFazer.Count)

$okDatas = 0
$semCurva = New-Object System.Collections.Generic.List[string]
if ($aFazer.Count -gt 0) {
  Log "Baixando titulos publicos (ANBIMA Data API)..." 'Cyan'
  $tpf = Fetch-TitulosPublicos
  Log ("Titulos publicos: {0} (cada um com historico de precos)" -f $tpf.Count)

  # Pre-monta, por titulo: tipo, venc(ISO) e um mapa data_referencia(ISO) -> taxa.
  $titulos = New-Object System.Collections.Generic.List[object]
  foreach ($x in $tpf) {
    $tipo = ([string]$x.tipo_titulo).Trim().ToUpperInvariant()
    if ($tipo -ne 'NTN-B' -and $tipo -ne 'LTN') { continue }
    $venc = Cell-ToDate $x.data_vencimento; if ($null -eq $venc) { continue }
    $porData = @{}
    foreach ($pr in $x.precos) {
      $pd = Cell-ToDate $pr.data_referencia; if ($null -eq $pd) { continue }
      $tx = Parse-NumPt $pr.taxa_indicativa; if ($null -eq $tx) { continue }
      $porData[$pd.ToString('yyyy-MM-dd')] = $tx
    }
    $titulos.Add([pscustomobject]@{ Tipo = $tipo; VencIso = $venc.ToString('yyyy-MM-dd'); PorData = $porData })
  }

  foreach ($dataIso in $aFazer) {
    $n = 0
    foreach ($t in $titulos) {
      if ($t.PorData.ContainsKey($dataIso)) {
        $l = '"{0}","{1}","{2}","{3}"' -f $dataIso, $t.Tipo, $t.VencIso, ([double]$t.PorData[$dataIso]).ToString($ci)
        if ($chaves.Add($l)) { $linhas.Add($l); $n++ }
      }
    }
    if ($n -gt 0) { $okDatas++; Log ("{0}: {1} pontos (NTN-B/LTN)" -f $dataIso, $n) }
    else { $semCurva.Add($dataIso) }
  }
}

# Escreve acumulativo, ordenado (data,tipo,venc).
$ordenadas = @($linhas | Sort-Object)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutPath, ('"data","tipo","vencimento","taxa"' + "`n" + ($ordenadas -join "`n") + "`n"), $utf8)

$datasCobertas = @($ordenadas | ForEach-Object { ($_ -split '","')[0].TrimStart('"') } | Sort-Object -Unique).Count
$meta = [ordered]@{
  fonte           = 'ANBIMA Data API (titulos-publicos, view=precos)'
  totalPontos     = $ordenadas.Count
  datasCobertas   = $datasCobertas
  datasHistorico  = $datas.Count
  datasNovas      = $okDatas
  datasSemCurva   = @($semCurva | Sort-Object -Unique)
  updatedAt       = (Get-Date).ToString('s')
}
[System.IO.File]::WriteAllText($MetaPath, (($meta | ConvertTo-Json) + "`n"), $utf8)

Write-Host ("  OK: {0} pontos, {1}/{2} data(s) do historico cobertas -> {3}" -f $ordenadas.Count, $datasCobertas, $datas.Count, $OutPath) -ForegroundColor Green
if ($semCurva.Count -gt 0) { Log ("Datas sem curva na API (conversao pendente): {0}" -f (@($semCurva | Sort-Object -Unique) -join ', ')) 'Yellow' }

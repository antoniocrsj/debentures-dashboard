<#
  preparar-agenda.ps1
  --------------------------------------------------------------------------
  Baixa e mantem em CACHE a AGENDA DE EVENTOS (juros + amortizacao) de cada
  debenture, direto da ANBIMA Data API (web-bff). E a "peca lenta" do
  planejamento de Vencimentos 12m: na 1a rodada baixa ~2 mil tickers (demora),
  depois so re-baixa o que estiver faltando ou vencido (rapido).

  Cada ticker vira um arquivo em:
      dados-anbima\agenda-cache\<TICKER>.json
  com o formato:
      { "ticker": "IOCHA7", "fetchedAt": "2026-07-13T12:00:00Z",
        "totalElements": 9, "content": [ ...eventos crus da agenda... ] }

  O agregador Node (tools\gerar-agenda-12m.mjs) le esse cache + Debentures.csv
  (emissao/vencimento/notional) + BLC_tratado.csv (alocacao) e monta o
  public\data\Agenda_12m.json que o app consome.

  Universo de tickers (uniao, dedup):
      public\BLC_tratado.csv (CD_ATIVO)  -> carteira dos fundos
      public\Anbima_Tx.csv   (ticker)    -> mercado precificado
  Tickers que a ANBIMA nao conhece (ex.: FIDC/CRA na carteira) caem em cache
  "vazio" (content=[]) pra nao serem re-tentados a cada rodada.

  Uso:
    - Rodada normal (incremental):     .\preparar-agenda.ps1
    - Limitar tempo (ex.: 15 min):     .\preparar-agenda.ps1 -MaxSegundos 900
    - Forcar re-download de tudo:      .\preparar-agenda.ps1 -Force
    - Considerar cache "velho" apos N dias (default 30): -MaxIdadeDias 45
    - So carteira (ignora Anbima_Tx):  .\preparar-agenda.ps1 -SomenteCarteira
#>

param(
  [int]$MaxSegundos     = 0,     # >0: para de baixar apos esse tempo (retoma na proxima rodada)
  [switch]$Force,                # re-baixa mesmo cache valido
  [int]$MaxIdadeDias    = 30,    # cache mais antigo que isso e considerado vencido
  [switch]$SomenteCarteira,      # universo = so BLC (carteira); ignora Anbima_Tx
  [int]$PausaMs         = 120    # pausa entre chamadas (gentileza com a API)
)

$ErrorActionPreference = 'Stop'
$ci = [System.Globalization.CultureInfo]::InvariantCulture

$Root      = Split-Path $PSScriptRoot -Parent
$DataRoot  = Join-Path $Root 'dados-anbima'
$CacheDir  = Join-Path $DataRoot 'agenda-cache'
$LogDir    = Join-Path $DataRoot 'logs'
$BlcCsv    = Join-Path $Root 'public\BLC_tratado.csv'
$AnbimaCsv = Join-Path $Root 'public\Anbima_Tx.csv'
foreach ($d in @($CacheDir,$LogDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$LogLines = New-Object System.Collections.Generic.List[string]
function Log($m, $color='Gray') { Write-Host "  $m" -ForegroundColor $color; $LogLines.Add($m) }
function Step($m) { Write-Host ""; Write-Host (([char]0xBB) + " $m") -ForegroundColor Cyan; $LogLines.Add("== $m ==") }

# ---- Auth ANBIMA Data API (mesmo padrao de preparar-anbima.ps1) -----------
function B64Url($bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function New-AnbimaDataJwt {
  $secret = 'Sx!RNAMs@TXN_d!v9e*B%bPG-+AB%DZv9tq@TuFB'
  $header = B64Url ([System.Text.Encoding]::UTF8.GetBytes('{"typ":"JWT","alg":"HS256"}'))
  $payloadObj = [ordered]@{
    tokenRecaptcha = [guid]::NewGuid().ToString()
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
    'User-Agent' = 'Mozilla/5.0'
    'Origin' = 'https://data.anbima.com.br'
    'Referer' = 'https://data.anbima.com.br/busca/debentures?view=precos'
    'g-google-authorization' = New-AnbimaDataJwt
    'Params' = '?view=precos'
  }
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $headers -TimeoutSec 60
  $json = $null
  try {
    $ms = $resp.RawContentStream
    if ($ms -and $ms.Length -gt 0) { $json = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) }
  } catch { $json = $null }
  if ([string]::IsNullOrEmpty($json)) { $json = [string]$resp.Content }
  return ($json | ConvertFrom-Json)
}

function Norm-Ticker($s) {
  if ($null -eq $s) { return '' }
  $t = [string]$s
  $t = $t -replace '[\u200B\u200C\u200D\uFEFF\u00A0]', ''   # zero-width / nbsp
  return $t.Trim().ToUpperInvariant()
}
# Le a 1a coluna de um CSV (com aspas opcionais) pulando o cabecalho.
function Read-FirstColumn($path) {
  $set = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path $path)) { return $set }
  $lines = [System.IO.File]::ReadAllLines($path)
  for ($i=1; $i -lt $lines.Count; $i++) {
    $ln = $lines[$i]; if ($ln.Trim() -eq '') { continue }
    $first = $ln.Split(',')[0].Trim().Trim('"')
    $tk = Norm-Ticker $first
    if ($tk -ne '') { $set.Add($tk) }
  }
  return $set
}

Write-Host ""
Write-Host "=== Preparar Agenda de Eventos (cache 12m) ===" -ForegroundColor Green
$LogLines.Add("Execucao: " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))

# ---- 1. Montar universo de tickers ----------------------------------------
Step "Montando universo de tickers"
$universe = New-Object System.Collections.Generic.HashSet[string]
$nBlc = 0; $nAnb = 0
foreach ($t in (Read-FirstColumn $BlcCsv))    { if ($universe.Add($t)) { $nBlc++ } }
if (-not $SomenteCarteira) {
  foreach ($t in (Read-FirstColumn $AnbimaCsv)) { if ($universe.Add($t)) { $nAnb++ } }
}
# So tickers com cara de codigo B3 de debenture (4-8 alfanumericos).
$tickers = @($universe | Where-Object { $_ -match '^[A-Z0-9]{4,8}$' } | Sort-Object)
Log ("Carteira (BLC): novos $nBlc | Mercado (Anbima): novos $nAnb | Universo total: $($tickers.Count)")

# ---- 2. Baixar/atualizar cache --------------------------------------------
Step "Baixando agendas (cache incremental)"
$deadline = if ($MaxSegundos -gt 0) { (Get-Date).AddSeconds($MaxSegundos) } else { $null }
$limite   = (Get-Date).AddDays(-$MaxIdadeDias)

$baixados = 0; $pulados = 0; $vazios = 0; $erros = 0; $processados = 0
$total = $tickers.Count
$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($tk in $tickers) {
  $processados++
  $dest = Join-Path $CacheDir ("$tk.json")

  # Cache valido? (existe, nao -Force, e mais novo que o limite de idade)
  if (-not $Force -and (Test-Path $dest)) {
    $fresh = $false
    try {
      $old = Get-Content $dest -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($old.fetchedAt) {
        $ft = [DateTimeOffset]::Parse($old.fetchedAt, $ci).UtcDateTime
        if ($ft -gt $limite.ToUniversalTime()) { $fresh = $true }
      }
    } catch { $fresh = $false }
    if ($fresh) { $pulados++; continue }
  }

  if ($deadline -and (Get-Date) -gt $deadline) {
    Log ("Limite de tempo atingido em $processados/$total. Faltam $($total - $processados) - retomam na proxima rodada.") 'Yellow'
    break
  }

  try {
    $resp = Invoke-AnbimaDataApi "/web-bff/v1/debentures/$tk/agenda" ([ordered]@{ page=0; size=200 })
    $content = @()
    if ($resp -and $resp.content) { $content = @($resp.content) }
    $obj = [ordered]@{
      ticker        = $tk
      fetchedAt     = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
      totalElements = [int]($resp.total_elements)
      content       = $content
    }
    $json = ($obj | ConvertTo-Json -Depth 12)
    [System.IO.File]::WriteAllText($dest, $json, $utf8)
    if ($content.Count -eq 0) { $vazios++ } else { $baixados++ }
  } catch {
    $erros++
    # 404 (ticker que a ANBIMA nao conhece) -> grava cache vazio pra nao re-tentar.
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    if ($status -eq 404) {
      $obj = [ordered]@{ ticker=$tk; fetchedAt=[DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"); totalElements=0; content=@(); naoEncontrado=$true }
      [System.IO.File]::WriteAllText($dest, ($obj | ConvertTo-Json -Depth 6), $utf8)
      $vazios++
    } else {
      $LogLines.Add("ERRO $tk : $($_.Exception.Message)")
    }
  }

  if ($processados % 100 -eq 0) {
    Write-Host ("    $processados/$total  (baixados $baixados | vazios $vazios | cache $pulados | erros $erros)") -ForegroundColor DarkGray
  }
  if ($PausaMs -gt 0) { Start-Sleep -Milliseconds $PausaMs }
}

# ---- 3. Relatorio ----------------------------------------------------------
$emCache = (Get-ChildItem $CacheDir -Filter '*.json' -ErrorAction SilentlyContinue).Count
$report = @(
  "",
  "=== RELATORIO AGENDA ===",
  ("Universo de tickers      : " + $total),
  ("Baixados agora (com dado): " + $baixados),
  ("Vazios/nao encontrados   : " + $vazios),
  ("Ja em cache (pulados)    : " + $pulados),
  ("Erros                    : " + $erros),
  ("Arquivos em cache        : " + $emCache),
  ("Pasta de cache           : " + $CacheDir)
)
$report | ForEach-Object { Write-Host $_; $LogLines.Add($_) }
if ($pulados + $processados -lt $total) {
  Write-Host ("  (Rodada parcial - rode de novo pra continuar de onde parou.)") -ForegroundColor Yellow
}

$logPath = Join-Path $LogDir ("agenda_{0}.log" -f (Get-Date).ToString('yyyyMMdd_HHmmss'))
[System.IO.File]::WriteAllText($logPath, ($LogLines -join "`r`n"), $utf8)
Write-Host ""
Write-Host ("Log: " + $logPath) -ForegroundColor DarkGray
Write-Host ""

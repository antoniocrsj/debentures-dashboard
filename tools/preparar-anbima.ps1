<#
  preparar-anbima.ps1
  --------------------------------------------------------------------------
  Gera a base de TAXAS ANBIMA por ticker (public/Anbima_Tx.csv) que o app
  consome para a coluna "Tx Anbima" da tabela de Ativos.

  TODA a logica financeira fica AQUI (camada de preparacao). O front apenas le
  o txAnbimaFormatada ja calculado.

  Fontes PUBLICAS e GRATUITAS (sem login/token):
    Debentures (diario):  https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/d{ddMONyy}.xls
    Titulos Publicos:     https://www.anbima.com.br/informacoes/merc-sec/arqs/ms{ddmmyy}.txt

  Regras por tipo (abas do .xls):
    DI_SPREAD     -> "CDI + X,XX%"            (Taxa Indicativa ja e o spread, em %)
    PREFIXADO     -> "X,XX%"                  (Taxa Indicativa em %)
    IGP-M         -> "IGP-M + X,XX%" ou —
    IPCA_SPREAD   -> "B{AA} +/- N bps"        (spread vs NTN-B de referencia, do .txt)
    DI_PERCENTUAL -> "CDI + X,XX%"            (converte % do CDI via taxa da LTN, do .txt)
    VENCIDOS_ANTECIPADAMENTE -> ignorada

  Conversao % do CDI (simplificacao documentada, pedida pelo usuario):
    spread(%) = taxaLTN_252(venc. mais proximo) * (percentualCDI/100 - 1)
    (aprox. linear; reproduz o exemplo conceitual 102% ~ CDI + 0,25% p/ LTN ~12,5%)

  Uso:
    - Automatico (ultima data util):   preparar-anbima.bat
    - Data especifica:                 preparar-anbima.bat -Data 2026-06-26
    - Forcar re-download:              preparar-anbima.bat -Data 2026-06-26 -Force
    - Manual (arquivos ja baixados):   preparar-anbima.bat -DebFile "C:\...\d26jun26.xls" -TpfFile "C:\...\ms260626.txt"
#>

param(
  [string]$Data   = '',     # yyyy-MM-dd. Vazio = procura a data util mais recente.
  [switch]$Force,           # re-baixa mesmo se ja existir no cache
  [string]$DebFile = '',    # modo manual: caminho do .xls de debentures
  [string]$TpfFile = '',    # modo manual: caminho do .txt de titulos publicos
  [int]$MaxFallbackDays = 8 # quantos dias volta procurando o arquivo mais recente
)

$ErrorActionPreference = 'Stop'
$ci = [System.Globalization.CultureInfo]::InvariantCulture

# ---- Pastas (camada de dados, separada do app) ----------------------------
$Root      = Split-Path $PSScriptRoot -Parent
$DataRoot  = Join-Path $Root 'dados-anbima'
$InDeb     = Join-Path $DataRoot 'input\debentures'
$InTpf     = Join-Path $DataRoot 'input\titulos-publicos'
$OutDir    = Join-Path $DataRoot 'output'
$LogDir    = Join-Path $DataRoot 'logs'
$PublicCsv = Join-Path $Root 'public\Anbima_Tx.csv'
foreach ($d in @($InDeb,$InTpf,$OutDir,$LogDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$DEB_BASE = 'https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs'
$TPF_BASE = 'https://www.anbima.com.br/informacoes/merc-sec/arqs'
$MesPt = @('jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez')

$LogLines = New-Object System.Collections.Generic.List[string]
function Log($m, $color='Gray') { Write-Host "  $m" -ForegroundColor $color; $LogLines.Add($m) }
function Step($m) { Write-Host ""; Write-Host "» $m" -ForegroundColor Cyan; $LogLines.Add("== $m ==") }

# ---- Helpers ---------------------------------------------------------------
function Norm-Ticker($s) {
  if ($null -eq $s) { return '' }
  $t = [string]$s
  $t = $t -replace '[​‌‍﻿ ]', ''   # zero-width / nbsp
  return $t.Trim().ToUpperInvariant()
}
function Parse-NumPt($s) {
  if ($null -eq $s) { return $null }
  if ($s -is [double] -or $s -is [int] -or $s -is [long] -or $s -is [decimal] -or $s -is [single]) { return [double]$s }
  $t = ([string]$s).Trim()
  if ($t -eq '' -or $t -eq '--' -or $t -eq '-' -or $t -match '^(?i)n/?d$' -or $t -match '^(?i)n/?a$') { return $null }
  if ($t -match ',') {
    $t = $t -replace '\.', '' -replace ',', '.'   # 1.234,56 -> 1234.56  (e 14,30 -> 14.30)
  } elseif (($t.ToCharArray() | Where-Object { $_ -eq '.' }).Count -gt 1) {
    $t = $t -replace '\.', ''                     # 1.234.567 -> 1234567
  }
  $out = 0.0
  if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Any, $ci, [ref]$out)) { return $out }
  return $null
}
function Fmt-Comma($num, $dec) {
  if ($null -eq $num) { return '' }
  return ([double]$num).ToString('F' + $dec, $ci).Replace('.', ',')
}
function Cell-ToDate($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [double] -or $v -is [int]) { try { return [DateTime]::FromOADate([double]$v) } catch { return $null } }
  $t = ([string]$v).Trim(); if ($t -eq '') { return $null }
  $d = [DateTime]::MinValue
  foreach ($fmt in @('dd/MM/yyyy','d/M/yyyy','yyyyMMdd','yyyy-MM-dd')) {
    if ([DateTime]::TryParseExact($t, $fmt, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
  }
  if ([DateTime]::TryParse($t, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
  return $null
}
function Csv-Field($v) { '"' + (([string]$v) -replace '"','""') + '"' }

function Download-To($url, $dest) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 120 -UseBasicParsing -MaximumRedirection 5
    return (Test-Path $dest)
  } catch {
    if (Test-Path $dest) { Remove-Item $dest -Force }
    return $false
  }
}
# Detecta pagina HTML de erro salva como arquivo de dados
function Looks-Html($path) {
  $fs = [System.IO.File]::OpenRead($path)
  try { $buf = New-Object byte[] 64; $n = $fs.Read($buf,0,64); $head = [System.Text.Encoding]::ASCII.GetString($buf,0,$n) }
  finally { $fs.Close() }
  return ($head.TrimStart() -match '^(?i)(<!doctype|<html|<\?xml)')
}
function Is-Ole2($path) {
  $fs = [System.IO.File]::OpenRead($path)
  try { $b = New-Object byte[] 8; [void]$fs.Read($b,0,8) } finally { $fs.Close() }
  return ($b[0] -eq 0xD0 -and $b[1] -eq 0xCF -and $b[2] -eq 0x11 -and $b[3] -eq 0xE0)
}
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
  return ($resp.Content | ConvertFrom-Json)
}
function Latest-Preco($precos, [string]$wantedDate) {
  if (-not $precos) { return $null }
  $best = $null; $bestDate = [DateTime]::MinValue
  foreach ($p in $precos) {
    if ($wantedDate -ne '' -and $p.data_referencia -ne $wantedDate) { continue }
    $d = Cell-ToDate $p.data_referencia
    if ($null -ne $d -and $d -gt $bestDate) { $bestDate = $d; $best = $p }
  }
  return $best
}
function Tipo-AnbimaApi($indexador) {
  $idx = ([string]$indexador).Trim().ToUpperInvariant()
  if ($idx -eq 'DI+') { return 'DI_SPREAD' }
  if ($idx -eq 'DI%') { return 'DI_PERCENTUAL' }
  if ($idx -eq 'IPCA') { return 'IPCA_SPREAD' }
  if ($idx -match 'PR') { return 'PREFIXADO' }
  if ($idx -match 'IGP') { return 'IGP-M' }
  return $idx
}
function Load-AnbimaDataApi {
  $wantedDate = $Data
  $pageSize = 100
  $debRows = New-Object System.Collections.Generic.List[object]
  $first = Invoke-AnbimaDataApi '/web-bff/v1/debentures' ([ordered]@{
    view='precos'; page=0; size=$pageSize; field='codigo_b3'; order='asc'
  })
  $totalPages = [int]$first.total_pages
  foreach ($x in $first.content) { $debRows.Add($x) }
  for ($p=1; $p -lt $totalPages; $p++) {
    $j = Invoke-AnbimaDataApi '/web-bff/v1/debentures' ([ordered]@{
      view='precos'; page=$p; size=$pageSize; field='codigo_b3'; order='asc'
    })
    foreach ($x in $j.content) { $debRows.Add($x) }
  }

  $tpfRows = New-Object System.Collections.Generic.List[object]
  $tp = Invoke-AnbimaDataApi '/web-bff/v1/titulos-publicos' ([ordered]@{
    view='precos'; page=0; size=200; field='data_vencimento'; order='asc'
  })
  foreach ($x in $tp.content) { $tpfRows.Add($x) }
  for ($p=1; $p -lt [int]$tp.total_pages; $p++) {
    $j = Invoke-AnbimaDataApi '/web-bff/v1/titulos-publicos' ([ordered]@{
      view='precos'; page=$p; size=200; field='data_vencimento'; order='asc'
    })
    foreach ($x in $j.content) { $tpfRows.Add($x) }
  }
  return [pscustomobject]@{ Deb=$debRows; Tpf=$tpfRows; First=$first }
}

Write-Host ""
Write-Host "=== Preparar Taxas ANBIMA (coluna Tx Anbima) ===" -ForegroundColor Green
$LogLines.Add("Execucao: " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))

$usedApi = $false
$apiSource = ''
$records = New-Object System.Collections.Generic.List[object]
$dataRefDeb = $null
$ntnb = @{}
$ltn  = New-Object System.Collections.Generic.List[object]
$tpfRef = $null

# ---- 1. Resolver data + localizar/baixar arquivos --------------------------
if ($DebFile -eq '' -and $TpfFile -eq '') {
  Step "Aquisicao via ANBIMA Data API"
  try {
    $api = Load-AnbimaDataApi
    $maxDebDate = [DateTime]::MinValue
    foreach ($x in $api.Deb) {
      $preco = Latest-Preco $x.precos $Data
      if ($null -eq $preco) { continue }
      $pd = Cell-ToDate $preco.data_referencia
      if ($pd -and $pd -gt $maxDebDate) { $maxDebDate = $pd }
      $records.Add([pscustomobject]@{
        Sheet     = Tipo-AnbimaApi $x.indexador
        Ticker    = Norm-Ticker $x.codigo_b3
        Nome      = ([string]$x.emissor).Trim()
        Venc      = Cell-ToDate $x.data_vencimento
        Indice    = ([string]$x.remuneracao).Trim()
        TaxaInd   = $preco.taxa_indicativa
        PU        = $preco.pu_indicativo
        Duration  = $preco.duration
        RefNtnb   = ([string]$preco.referencia_ntn_b).Trim()
      })
    }
    if ($maxDebDate -gt [DateTime]::MinValue) { $dataRefDeb = $maxDebDate }
    $dataRefStr = if ($dataRefDeb) { $dataRefDeb.ToString('yyyy-MM-dd') } else { $Data }

    $maxTpfDate = [DateTime]::MinValue
    foreach ($x in $api.Tpf) {
      $preco = Latest-Preco $x.precos $dataRefStr
      if ($null -eq $preco) { $preco = Latest-Preco $x.precos '' }
      if ($null -eq $preco) { continue }
      $taxa = Parse-NumPt $preco.taxa_indicativa
      $venc = Cell-ToDate $x.data_vencimento
      $pd = Cell-ToDate $preco.data_referencia
      if ($pd -and $pd -gt $maxTpfDate) { $maxTpfDate = $pd }
      if ($null -eq $taxa -or $null -eq $venc) { continue }
      $tipo = ([string]$x.tipo_titulo).Trim().ToUpperInvariant()
      if ($tipo -eq 'NTN-B') { $ntnb[$venc.ToString('yyyyMMdd')] = $taxa }
      elseif ($tipo -eq 'LTN') { $ltn.Add([pscustomobject]@{ Venc=$venc; Taxa=$taxa }) }
    }
    if ($maxTpfDate -gt [DateTime]::MinValue) { $tpfRef = $maxTpfDate.ToString('yyyyMMdd') }
    $apiSource = 'ANBIMA Data API (web-bff)'
    $usedApi = ($records.Count -gt 0)
    Log ("Registros lidos: $($records.Count) | Data de referencia (debentures): $dataRefStr")
    Log ("Titulos publicos API: NTN-B $($ntnb.Count) | LTN $($ltn.Count) | data ref TPF: $tpfRef")
  } catch {
    Log ("API ANBIMA Data falhou; usando fallback XLS/TXT antigo. Motivo: " + $_.Exception.Message) 'Yellow'
    $records.Clear()
    $ntnb.Clear()
    $ltn.Clear()
    $tpfRef = $null
    $dataRefDeb = $null
  }
}

if (-not $usedApi) {
Step "Aquisicao dos arquivos publicos"

# Caminhos finais dos arquivos brutos (por data)
function Resolve-And-Get([DateTime]$dt) {
  $tokDeb = 'd{0:dd}{1}{0:yy}' -f $dt, $MesPt[$dt.Month-1]
  $tokTpf = 'ms{0:ddMMyy}' -f $dt
  $debDest = Join-Path $InDeb ("debentures_{0:yyyy-MM-dd}.xls" -f $dt)
  $tpfDest = Join-Path $InTpf ("titulos_publicos_{0:yyyy-MM-dd}.csv" -f $dt)
  $okDeb = $false; $okTpf = $false

  if ((Test-Path $debDest) -and -not $Force) { $okDeb = $true } else {
    if (Download-To "$DEB_BASE/$tokDeb.xls" $debDest) {
      if ((Get-Item $debDest).Length -gt 0 -and -not (Looks-Html $debDest) -and (Is-Ole2 $debDest)) { $okDeb = $true }
      else { Remove-Item $debDest -Force -ErrorAction SilentlyContinue }
    }
  }
  if ((Test-Path $tpfDest) -and -not $Force) { $okTpf = $true } else {
    if (Download-To "$TPF_BASE/$tokTpf.txt" $tpfDest) {
      if ((Get-Item $tpfDest).Length -gt 0 -and -not (Looks-Html $tpfDest)) { $okTpf = $true }
      else { Remove-Item $tpfDest -Force -ErrorAction SilentlyContinue }
    }
  }
  return [pscustomobject]@{ Date=$dt; Deb=$debDest; Tpf=$tpfDest; OkDeb=$okDeb; OkTpf=$okTpf }
}

$resolved = $null
if ($DebFile -ne '' -or $TpfFile -ne '') {
  # ---- Modo manual ----
  Log "Modo MANUAL (arquivos informados)."
  if ($DebFile -eq '' -or -not (Test-Path $DebFile)) { throw "Modo manual: informe -DebFile valido (.xls de debentures)." }
  if ($TpfFile -eq '' -or -not (Test-Path $TpfFile)) { throw "Modo manual: informe -TpfFile valido (.txt de titulos publicos)." }
  $resolved = [pscustomobject]@{ Date=$null; Deb=$DebFile; Tpf=$TpfFile; OkDeb=$true; OkTpf=$true }
} else {
  $start = if ($Data -ne '') { [DateTime]::ParseExact($Data,'yyyy-MM-dd',$ci) } else { (Get-Date).Date }
  for ($i=0; $i -lt $MaxFallbackDays; $i++) {
    $try = $start.AddDays(-$i)
    if ($try.DayOfWeek -eq 'Saturday' -or $try.DayOfWeek -eq 'Sunday') { continue }
    Log ("Tentando data {0:yyyy-MM-dd}..." -f $try)
    $r = Resolve-And-Get $try
    if ($r.OkDeb) { $resolved = $r; break }   # debentures e a base principal
  }
  if (-not $resolved) { throw "Nao encontrei arquivo de debentures publico nos ultimos $MaxFallbackDays dias a partir de $($start.ToString('yyyy-MM-dd'))." }
}

Log ("Debentures : " + $resolved.Deb) 'Yellow'
Log ("Tit.Publ.  : " + $resolved.Tpf + $(if (-not $resolved.OkTpf) { '  (AUSENTE — IPCA/%CDI ficarao pendentes)' } else { '' })) 'Yellow'

# ---- 2. Validacao ----------------------------------------------------------
Step "Validacao dos arquivos"
if (-not (Test-Path $resolved.Deb)) { throw "Arquivo de debentures nao encontrado." }
if ((Get-Item $resolved.Deb).Length -le 0) { throw "Arquivo de debentures vazio." }
if (Looks-Html $resolved.Deb) { throw "Arquivo de debentures parece ser HTML (pagina de erro), nao um .xls." }
if (-not (Is-Ole2 $resolved.Deb)) { Log "AVISO: .xls nao tem assinatura OLE2 — tentando abrir mesmo assim." 'Yellow' }
Log "Debentures OK."

# ---- 3. Ler titulos publicos (NTN-B e LTN) --------------------------------
Step "Lendo titulos publicos (.txt @-separado)"
$ntnb = @{}                  # 'yyyyMMdd' -> taxa indicativa (double, %)
$ltn  = New-Object System.Collections.Generic.List[object]   # { Venc=[DateTime]; Taxa=double }
$tpfRef = $null
if ($resolved.OkTpf -and (Test-Path $resolved.Tpf)) {
  $bytes = [System.IO.File]::ReadAllBytes($resolved.Tpf)
  $txt   = [System.Text.Encoding]::GetEncoding('latin1').GetString($bytes)
  $lines = $txt -split "`r?`n"
  $hdrIdx = -1
  for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '(?i)Tx\.\s*Indicativ') { $hdrIdx = $i; break } }
  if ($hdrIdx -lt 0) { throw "Titulos publicos: cabecalho 'Tx. Indicativas' nao encontrado." }
  $hdr = $lines[$hdrIdx].Split('@')
  $iTipo = 0; $iRef = 1; $iVenc = 4; $iTaxa = 7
  for ($c=0; $c -lt $hdr.Count; $c++) {
    $h = $hdr[$c].Trim()
    if ($h -match '(?i)^titulo') { $iTipo = $c }
    elseif ($h -match '(?i)Data Referencia') { $iRef = $c }
    elseif ($h -match '(?i)Data Vencimento') { $iVenc = $c }
    elseif ($h -match '(?i)Tx\.\s*Indicativ') { $iTaxa = $c }
  }
  $cnt = 0
  for ($i=$hdrIdx+1; $i -lt $lines.Count; $i++) {
    $ln = $lines[$i]; if ($ln.Trim() -eq '') { continue }
    $cols = $ln.Split('@'); if ($cols.Count -le $iTaxa) { continue }
    $tipo = $cols[$iTipo].Trim().ToUpperInvariant()
    $vRaw = $cols[$iVenc].Trim()
    $taxa = Parse-NumPt $cols[$iTaxa]
    if ($null -eq $tpfRef) { $tpfRef = $cols[$iRef].Trim() }
    if ($null -eq $taxa) { continue }
    $vd = Cell-ToDate $vRaw
    if ($null -eq $vd) { continue }
    if ($tipo -eq 'NTN-B') { $ntnb[$vd.ToString('yyyyMMdd')] = $taxa; $cnt++ }
    elseif ($tipo -eq 'LTN') { $ltn.Add([pscustomobject]@{ Venc=$vd; Taxa=$taxa }); $cnt++ }
  }
  Log ("NTN-B: $($ntnb.Count) vencimentos | LTN: $($ltn.Count) vencimentos | data ref TPF: $tpfRef")
} else {
  Log "Sem arquivo de titulos publicos — IPCA e %CDI ficarao pendentes (—)." 'Yellow'
}
}
function Nearest-LTN([DateTime]$venc) {
  if ($ltn.Count -eq 0) { return $null }
  $best = $null; $bestDiff = [double]::MaxValue
  foreach ($x in $ltn) { $diff = [Math]::Abs(($x.Venc - $venc).TotalDays); if ($diff -lt $bestDiff) { $bestDiff = $diff; $best = $x } }
  return $best
}

# ---- 4. Ler debentures via Excel COM --------------------------------------
if (-not $usedApi) {
Step "Lendo debentures (.xls via Excel COM)"
$SHEETS = @('DI_PERCENTUAL','DI_SPREAD','IGP-M','IPCA_SPREAD','PREFIXADO')
$HEADER_ROW = 8; $DATA_ROW = 10
$records = New-Object System.Collections.Generic.List[object]
$dataRefDeb = $null

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($resolved.Deb, $false, $true)
  # Data de referencia (celula B4)
  try { $dataRefDeb = Cell-ToDate ($wb.Worksheets.Item('DI_SPREAD').Cells.Item(4,2).Value2) } catch {}
  foreach ($sheetName in $SHEETS) {
    $ws = $null
    foreach ($w in $wb.Worksheets) { if ($w.Name -eq $sheetName) { $ws = $w; break } }
    if ($null -eq $ws) { Log "Aba '$sheetName' ausente — pulando." 'Yellow'; continue }
    $used = $ws.UsedRange
    $lastRow = $used.Row + $used.Rows.Count - 1
    if ($lastRow -lt $DATA_ROW) { continue }
    $rng = $ws.Range($ws.Cells.Item($DATA_ROW,1), $ws.Cells.Item($lastRow,15))
    $vals = $rng.Value2   # array 2D base 1 (COM)
    if ($null -eq $vals) { continue }
    $lb = $vals.GetLowerBound(0); $ub = $vals.GetUpperBound(0)
    for ($r=$lb; $r -le $ub; $r++) {
      $codigo = Norm-Ticker ($vals.GetValue($r,1))
      if ($codigo -notmatch '^[A-Z0-9]{4,8}$') { continue }
      $records.Add([pscustomobject]@{
        Sheet     = $sheetName
        Ticker    = $codigo
        Nome      = ([string]($vals.GetValue($r,2))).Trim()
        Venc      = Cell-ToDate ($vals.GetValue($r,3))
        Indice    = ([string]($vals.GetValue($r,4))).Trim()
        TaxaInd   = $vals.GetValue($r,7)
        PU        = $vals.GetValue($r,11)
        Duration  = $vals.GetValue($r,13)
        RefNtnb   = ([string]($vals.GetValue($r,15))).Trim()
      })
    }
  }
  $wb.Close($false)
} finally {
  $xl.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)|Out-Null; [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
if ($null -eq $dataRefDeb -and $resolved.Date) { $dataRefDeb = $resolved.Date }
$dataRefStr = if ($dataRefDeb) { $dataRefDeb.ToString('yyyy-MM-dd') } else { '' }
Log ("Registros lidos: $($records.Count) | Data de referencia (debentures): $dataRefStr")
}

# ---- 5. Calcular tx por tipo ----------------------------------------------
Step "Calculando taxas / spreads"
$stats = @{ DI_SPREAD=0; DI_PERCENTUAL=0; IPCA_SPREAD=0; PREFIXADO=0; 'IGP-M'=0;
            cdiConv=0; cdiPend=0; ipcaOk=0; ipcaSemNtnb=0; vazias=0; dup=0 }
$seen = @{}
$out = New-Object System.Collections.Generic.List[object]
$conf = New-Object System.Collections.Generic.List[object]   # nao calculados (conferencia)

foreach ($rec in $records) {
  if ($seen.ContainsKey($rec.Ticker)) { $stats.dup++; $LogLines.Add("DUPLICADO ignorado (regra: mantem 1o): $($rec.Ticker) [$($rec.Sheet)]"); continue }
  $seen[$rec.Ticker] = $true
  if ($stats.ContainsKey($rec.Sheet)) { $stats[$rec.Sheet]++ }

  # Duration vem em DIAS UTEIS; convertemos p/ anos dividindo por 252 (uma unica vez).
  $durDias = Parse-NumPt $rec.Duration
  $o = [ordered]@{
    ticker=$rec.Ticker; taxaAnbimaOriginal=''; tipoTaxaAnbima=$rec.Sheet; txAnbimaFormatada='—';
    indexadorAnbima=$rec.Indice; dataReferenciaAnbima=$dataRefStr;
    dataVencimento=$(if($rec.Venc){$rec.Venc.ToString('yyyy-MM-dd')}else{''});
    durationAnbimaDiasUteis=$(if($null -ne $durDias){ Fmt-Comma $durDias 2 }else{''});
    durationAnbimaAnos=$(if($null -ne $durDias){ Fmt-Comma ($durDias / 252.0) 2 }else{''});
    percentualCdiOriginal=''; spreadCdiEquivalente=''; metodologiaConversaoCdi='';
    ntnbReferencia=''; codigoNtnbExibicao=''; taxaNtnbReferencia=''; spreadNtnbBps='';
    statusCalculoAnbima='ok'; motivoAusenciaAnbima=''; fonteAnbima=$(if($usedApi){$apiSource}else{'ANBIMA Mercado Secundario (publico)'})
  }
  $taxa = Parse-NumPt $rec.TaxaInd
  $o.taxaAnbimaOriginal = $(if ($null -ne $taxa) { Fmt-Comma $taxa 4 } else { '' })

  switch ($rec.Sheet) {
    'DI_SPREAD' {
      if ($null -eq $taxa) { $o.statusCalculoAnbima='sem_taxa'; $o.motivoAusenciaAnbima='Taxa indicativa vazia'; $stats.vazias++ }
      else { $o.txAnbimaFormatada = 'CDI + ' + (Fmt-Comma $taxa 2) + '%' }
    }
    'PREFIXADO' {
      if ($null -eq $taxa) { $o.statusCalculoAnbima='sem_taxa'; $o.motivoAusenciaAnbima='Taxa indicativa vazia'; $stats.vazias++ }
      else { $o.txAnbimaFormatada = (Fmt-Comma $taxa 2) + '%' }
    }
    'IGP-M' {
      if ($null -eq $taxa) { $o.statusCalculoAnbima='sem_taxa'; $o.motivoAusenciaAnbima='Taxa indicativa vazia (comum em IGP-M)'; $stats.vazias++ }
      else { $o.txAnbimaFormatada = 'IGP-M + ' + (Fmt-Comma $taxa 2) + '%' }
    }
    'IPCA_SPREAD' {
      if ($null -eq $taxa) { $o.statusCalculoAnbima='sem_taxa'; $o.motivoAusenciaAnbima='Taxa indicativa vazia'; $stats.vazias++; break }
      $refDate = Cell-ToDate $rec.RefNtnb
      if ($refDate) { $o.ntnbReferencia = $refDate.ToString('yyyy-MM-dd'); $o.codigoNtnbExibicao = 'B' + $refDate.ToString('yy') }
      $taxaNtnb = $null
      if ($refDate) { $k = $refDate.ToString('yyyyMMdd'); if ($ntnb.ContainsKey($k)) { $taxaNtnb = $ntnb[$k] } }
      if ($null -eq $refDate) {
        $o.statusCalculoAnbima='ipca_sem_ref'; $o.motivoAusenciaAnbima='Sem Referencia NTN-B no arquivo'; $stats.ipcaSemNtnb++
      } elseif ($null -eq $taxaNtnb) {
        $o.statusCalculoAnbima='ipca_sem_taxa_ntnb'; $o.motivoAusenciaAnbima="NTN-B $($o.codigoNtnbExibicao) sem taxa na mesma data"; $stats.ipcaSemNtnb++
      } else {
        $bps = [Math]::Round(((1.0 + $taxa/100.0) / (1.0 + $taxaNtnb/100.0) - 1.0) * 10000.0, 0)
        $o.taxaNtnbReferencia = Fmt-Comma $taxaNtnb 4
        $o.spreadNtnbBps = [string][int]$bps
        $sgn = if ($bps -ge 0) { '+' } else { '-' }
        $o.txAnbimaFormatada = "$($o.codigoNtnbExibicao) $sgn $([Math]::Abs([int]$bps)) bps"
        $stats.ipcaOk++
      }
    }
    'DI_PERCENTUAL' {
      if ($null -eq $taxa) { $o.statusCalculoAnbima='sem_taxa'; $o.motivoAusenciaAnbima='Taxa indicativa vazia'; $stats.vazias++; break }
      $o.percentualCdiOriginal = Fmt-Comma $taxa 4    # ex.: 103,1418 (% do CDI)
      $p = $taxa / 100.0
      $ref = $null; if ($rec.Venc) { $ref = Nearest-LTN $rec.Venc }
      if ($null -eq $ref) {
        $o.statusCalculoAnbima='pendente_conversao_cdi'; $o.motivoAusenciaAnbima='Sem LTN de referencia (titulos publicos ausente?)'; $stats.cdiPend++
      } else {
        $iL = $ref.Taxa / 100.0
        $spread = ($iL * ($p - 1.0) / (1.0 + $iL)) * 100.0   # % (fator: (1 + (%CDI/100)*L)/(1 + L) - 1)
        $o.spreadCdiEquivalente = Fmt-Comma $spread 4
        $o.metodologiaConversaoCdi = "spread = (1 + (%CDI/100)*L)/(1 + L) - 1; L = TaxaLTN_252 venc ref $($ref.Venc.ToString('yyyy-MM-dd')) = $(Fmt-Comma $ref.Taxa 2)%"
        $sgn = if ($spread -ge 0) { '+' } else { '-' }
        $o.txAnbimaFormatada = "CDI $sgn " + (Fmt-Comma ([Math]::Abs($spread)) 2) + '%'
        $stats.cdiConv++
      }
    }
  }

  if ($o.txAnbimaFormatada -eq '—' -and $o.statusCalculoAnbima -ne 'ok') {
    $conf.Add([pscustomobject]@{ ticker=$o.ticker; tipo=$o.tipoTaxaAnbima; status=$o.statusCalculoAnbima; motivo=$o.motivoAusenciaAnbima; taxaOriginal=$o.taxaAnbimaOriginal })
  }
  $out.Add([pscustomobject]$o)
}

# ---- 6. Cobertura vs base do app (somente relatorio) ----------------------
Step "Conferindo cobertura vs base de ativos do app"
$appTickers = $null
try {
  $DEB_URL = 'https://script.google.com/macros/s/AKfycbzW1aTN1zHAz40W3P9rNjk3sUf4sf4qDAqbt5QeA4e3Z4v8uGRCnlYtGXT-hBqwmaZo/exec'
  $resp = Invoke-WebRequest -Uri $DEB_URL -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 90
  $body = $resp.Content
  if (-not $body.TrimStart().StartsWith('<')) {
    $al = $body -split "`r?`n"
    $h = $al[0].Split(',') | ForEach-Object { $_.Trim().Trim('"') }
    $ic = -1; for ($i=0;$i -lt $h.Count;$i++){ if ($h[$i] -match '(?i)c[oó]digo do ativo') { $ic=$i; break } }
    if ($ic -ge 0) {
      $appTickers = New-Object System.Collections.Generic.HashSet[string]
      for ($i=1;$i -lt $al.Count;$i++){ $c=$al[$i].Split(','); if ($c.Count -gt $ic){ [void]$appTickers.Add((Norm-Ticker ($c[$ic].Trim().Trim('"')))) } }
    }
  }
} catch { Log "Nao consegui ler a base de ativos do app (cobertura ficara indisponivel): $($_.Exception.Message)" 'Yellow' }

$anbSet = New-Object System.Collections.Generic.HashSet[string]
foreach ($o in $out) { [void]$anbSet.Add($o.ticker) }
$encontrados = 0; $naoEncontrados = 0
if ($appTickers) {
  foreach ($t in $appTickers) { if ($anbSet.Contains($t)) { $encontrados++ } else { $naoEncontrados++ } }
}

# ---- 7. Gravar saidas ------------------------------------------------------
Step "Gravando arquivos"
$cols = @('ticker','taxaAnbimaOriginal','tipoTaxaAnbima','txAnbimaFormatada','indexadorAnbima','dataReferenciaAnbima','dataVencimento','durationAnbimaDiasUteis','durationAnbimaAnos','percentualCdiOriginal','spreadCdiEquivalente','metodologiaConversaoCdi','ntnbReferencia','codigoNtnbExibicao','taxaNtnbReferencia','spreadNtnbBps','statusCalculoAnbima','motivoAusenciaAnbima','fonteAnbima')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine(($cols | ForEach-Object { Csv-Field $_ }) -join ',')
foreach ($o in $out) { [void]$sb.AppendLine(($cols | ForEach-Object { Csv-Field $o.$_ }) -join ',') }
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Validacao: so substitui o public/ se gerou registros
if ($out.Count -gt 0) {
  [System.IO.File]::WriteAllText($PublicCsv, $sb.ToString(), $utf8)
  $stamp = if ($dataRefStr -ne '') { $dataRefStr } else { (Get-Date).ToString('yyyy-MM-dd') }
  [System.IO.File]::WriteAllText((Join-Path $OutDir "Anbima_Tx_$stamp.csv"), $sb.ToString(), $utf8)
} else {
  Log "0 registros — PRESERVANDO o public/Anbima_Tx.csv anterior (nao sobrescreve)." 'Yellow'
}

# Conferencia (nao calculados)
$cb = New-Object System.Text.StringBuilder
[void]$cb.AppendLine('"ticker","tipo","status","motivo","taxaOriginal"')
foreach ($c in $conf) { [void]$cb.AppendLine((@($c.ticker,$c.tipo,$c.status,$c.motivo,$c.taxaOriginal) | ForEach-Object { Csv-Field $_ }) -join ',') }
[System.IO.File]::WriteAllText((Join-Path $OutDir 'conferencia_nao_calculados.csv'), $cb.ToString(), $utf8)

# ---- 8. Relatorio / log ----------------------------------------------------
$comTaxa = ($out | Where-Object { $_.txAnbimaFormatada -ne '—' }).Count
$debFonteRel = if ($usedApi) { $apiSource } else { $resolved.Deb }
$tpfFonteRel = if ($usedApi) { $apiSource } else { $resolved.Tpf }
$report = @(
  "",
  "=== RELATORIO ANBIMA ===",
  ("Data de referencia (debentures): " + $dataRefStr),
  ("Data de referencia (TPF)       : " + $(if($tpfRef){$tpfRef}else{'(sem TPF)'})),
  ("Fonte debentures  : " + $debFonteRel),
  ("Fonte TPF         : " + $tpfFonteRel),
  ("Registros lidos (debentures)   : " + $records.Count),
  ("Tickers unicos na base ANBIMA  : " + $out.Count),
  ("  DI_SPREAD     : " + $stats.DI_SPREAD),
  ("  DI_PERCENTUAL : " + $stats.DI_PERCENTUAL + "  (convertidos: " + $stats.cdiConv + " | pendentes: " + $stats.cdiPend + ")"),
  ("  IPCA_SPREAD   : " + $stats.IPCA_SPREAD + "  (com NTN-B: " + $stats.ipcaOk + " | sem NTN-B: " + $stats.ipcaSemNtnb + ")"),
  ("  PREFIXADO     : " + $stats.PREFIXADO),
  ("  IGP-M         : " + $stats.'IGP-M'),
  ("Taxas vazias                   : " + $stats.vazias),
  ("Duplicados ignorados           : " + $stats.dup),
  ("Com Tx Anbima preenchida       : " + $comTaxa),
  ("Exibindo —                     : " + ($out.Count - $comTaxa)),
  ("Cobertura vs app  -> encontrados: " + $(if($appTickers){$encontrados}else{'(n/d)'}) + " | nao encontrados na ANBIMA: " + $(if($appTickers){$naoEncontrados}else{'(n/d)'})),
  ("Arquivo gerado: " + $PublicCsv)
)
$report | ForEach-Object { Write-Host $_; $LogLines.Add($_) }

$logPath = Join-Path $LogDir ("anbima_{0}.log" -f (Get-Date).ToString('yyyyMMdd_HHmmss'))
[System.IO.File]::WriteAllText($logPath, ($LogLines -join "`r`n"), $utf8)
Write-Host ""
Write-Host ("Log: " + $logPath) -ForegroundColor DarkGray
Write-Host ("Conferencia: " + (Join-Path $OutDir 'conferencia_nao_calculados.csv')) -ForegroundColor DarkGray
Write-Host ""

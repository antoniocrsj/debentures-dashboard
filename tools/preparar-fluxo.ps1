<#
  preparar-fluxo.ps1
  --------------------------------------------------------------------------
  Gera as bases SEMANAIS de captacao/resgate da aba "Captacao" a partir do
  Informe Diario de Fundos da CVM.

  Fonte CVM: https://dados.cvm.gov.br/dataset/fi-doc-inf_diario
  Arquivos:  inf_diario_fi_AAAAMM.zip  (CSV ; latin-1)
  Colunas usadas: CNPJ_FUNDO_CLASSE (ou CNPJ_FUNDO), DT_COMPTC,
                  VL_PATRIM_LIQ, CAPTC_DIA, RESG_DIA

  O que faz:
    1. Le as listas de fundos (CNPJ -> Gestor_Apelido):
         tools\lista_12431.csv        (Fundos Incentivados - Lei 12.431)
         tools\lista_tradicional.csv  (Credito Tradicional)
    2. Baixa os meses do Informe Diario (cache local, nao rebaixa).
    3. Calcula o fluxo SEMANAL (segunda a domingo) por gestor.
    4. Grava em public\data\:
         Fluxo_Semanal_12431.csv
         Fluxo_Semanal_Trad.csv
       Colunas: Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos

  Uso: clique 2x em preparar-fluxo.bat, ou:
       powershell -File preparar-fluxo.ps1 -Meses 202504,202505
#>

param(
  [string[]]$Meses,                                   # ex: 202504,202505 (default: ultimos 12 meses)
  # "C:\Projeto Credito\CVM _informe_diario" — [char]233 = e-acento (mantem o .ps1 em ASCII)
  [string]$CvmDir   = ("C:\Projeto Cr" + [char]233 + "dito\CVM _informe_diario"),
  [string]$Lista12431,
  [string]$ListaTrad,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$CVM_BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS'

# Defaults relativos ao script
if (-not $Lista12431) { $Lista12431 = Join-Path $PSScriptRoot 'lista_12431.csv' }
if (-not $ListaTrad)  { $ListaTrad  = Join-Path $PSScriptRoot 'lista_tradicional.csv' }
if (-not $OutDir)     { $OutDir     = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\data' }
if (-not $Meses) {
  $Meses = 0..11 | ForEach-Object { (Get-Date).AddMonths(-$_).ToString('yyyyMM') }
}

function NormCNPJ($s) { return ($s -replace '\D','') }
function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

# Le uma lista CNPJ(fundo) -> Gestor_Apelido, tolerante a separador/encoding/nomes.
# Regras de escolha de coluna (lista pode ter CNPJ do fundo E do gestor, gestor E apelido):
#   CNPJ   : prefere a que cita fundo/classe; senao a que NAO cita gestor; senao a 1a com "cnpj".
#   Gestor : prefere a que cita "apelido"; senao a que cita "gestor".
function Load-Lista($path) {
  $blank = @{ map = @{}; missing = $true; colCnpj = ''; colGestor = '' }
  if (-not (Test-Path $path)) { return $blank }
  $lines = [System.IO.File]::ReadAllLines($path)
  if ($lines.Count -lt 2) { $blank.missing = $false; return $blank }
  $sep = if ($lines[0] -match ';') { ';' } else { ',' }
  $hdr = $lines[0].Split($sep) | ForEach-Object { $_.Trim().Trim('"') }

  $iC = -1
  for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i] -match '(?i)cnpj' -and $hdr[$i] -match '(?i)fund|classe') { $iC = $i; break } }
  if ($iC -lt 0) { for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i] -match '(?i)cnpj' -and $hdr[$i] -notmatch '(?i)gestor') { $iC = $i; break } } }
  if ($iC -lt 0) { for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i] -match '(?i)cnpj') { $iC = $i; break } } }

  $iG = -1
  for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i] -match '(?i)apelido') { $iG = $i; break } }
  if ($iG -lt 0) { for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i] -match '(?i)gestor') { $iG = $i; break } } }

  if ($iC -lt 0 -or $iG -lt 0) { throw ("Lista '$path': preciso de uma coluna de CNPJ (fundo) e uma de Gestor/Apelido. Cabecalho: " + ($hdr -join ', ')) }

  $map = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $row = $lines[$i]; if ($row.Trim() -eq '') { continue }
    $cols = $row.Split($sep)
    if ($cols.Count -le [Math]::Max($iC, $iG)) { continue }
    $cnpj = NormCNPJ ($cols[$iC].Trim().Trim('"'))
    $gestor = $cols[$iG].Trim().Trim('"')
    if ($cnpj -ne '' -and $gestor -ne '') { $map[$cnpj] = $gestor }
  }
  return @{ map = $map; missing = $false; colCnpj = $hdr[$iC]; colGestor = $hdr[$iG] }
}

# Meses que SEMPRE rebaixam, mesmo com cache: a CVM vai acrescentando os dias
# ao zip do mes corrente ao longo do mes (e pode revisar o anterior no inicio do
# mes seguinte). Mantemos os 2 mais recentes "frescos" para a rotina SEMANAL.
$script:ForceMonths = @(0, 1) | ForEach-Object { (Get-Date).AddMonths(-$_).ToString('yyyyMM') }

# Garante o zip do mes no cache. Meses antigos usam cache; os 2 mais recentes
# sao rebaixados. Se o download falhar, mantem o cache anterior (se houver).
# Retorna o caminho ou $null.
function Ensure-Month($yyyymm) {
  $zip = Join-Path $CvmDir "inf_diario_fi_$yyyymm.zip"
  $mustRefresh = $script:ForceMonths -contains $yyyymm
  if ((Test-Path $zip) -and (-not $mustRefresh)) { return $zip }
  $url = "$CVM_BASE/inf_diario_fi_$yyyymm.zip"
  $tmp = "$zip.tmp"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 180 -UseBasicParsing
    Move-Item $tmp $zip -Force
    return $zip
  } catch {
    Write-Host "    $yyyymm indisponivel (pulando): $($_.Exception.Message)" -ForegroundColor Yellow
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    if (Test-Path $zip) { return $zip }   # mantem o cache anterior, se houver
    return $null
  }
}

# segunda-feira da semana que contem $date
function WeekStart([datetime]$date) {
  $off = ([int]$date.DayOfWeek + 6) % 7   # Mon=0 .. Sun=6
  return $date.AddDays(-$off)
}

Write-Host ""
Write-Host "=== Preparar bases de Captacao (Fluxo Semanal) ===" -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $CvmDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1. Listas
Step "Lendo listas de fundos..."
$L12431 = Load-Lista $Lista12431
$LTrad  = Load-Lista $ListaTrad
if ($L12431.missing) { Write-Host "    AVISO: nao achei $Lista12431" -ForegroundColor Yellow }
if ($LTrad.missing)  { Write-Host "    AVISO: nao achei $ListaTrad"  -ForegroundColor Yellow }
Write-Host "    12431: $($L12431.map.Count) fundos | Tradicional: $($LTrad.map.Count) fundos"
if ($L12431.map.Count) { Write-Host "      (12431 usando colunas -> CNPJ: '$($L12431.colCnpj)' | Gestor: '$($L12431.colGestor)')" -ForegroundColor DarkGray }
if ($LTrad.map.Count)  { Write-Host "      (Trad  usando colunas -> CNPJ: '$($LTrad.colCnpj)' | Gestor: '$($LTrad.colGestor)')" -ForegroundColor DarkGray }
if ($L12431.map.Count -eq 0 -and $LTrad.map.Count -eq 0) {
  throw "Nenhum fundo nas listas. Crie tools\lista_12431.csv e/ou tools\lista_tradicional.csv (colunas: CNPJ, Gestor_Apelido)."
}

# acumuladores: agg[tipo][weekKey|gestor] = @{ cap; resg; plSum; dates(set); cnpjs(set) }
$agg = @{ '12431' = @{}; 'trad' = @{} }
$seen = @{ '12431' = @{}; 'trad' = @{} }   # cnpjs efetivamente vistos
$tipos = @{ '12431' = $L12431.map; 'trad' = $LTrad.map }

$mesesOk = @(); $mesesFalha = @(); $invalidas = 0; $minDate = $null; $maxDate = $null

# 2-3. Processa cada mes
foreach ($mes in $Meses) {
  Step "Mes $mes ..."
  $zipPath = Ensure-Month $mes
  if (-not $zipPath) { $mesesFalha += $mes; continue }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $entry = $z.Entries | Where-Object { $_.FullName -like '*.csv' } | Select-Object -First 1
    if (-not $entry) { throw "sem CSV no zip" }
    $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::GetEncoding('latin1'))

    $header = $sr.ReadLine().Split(';')
    $idx = @{}; for ($i = 0; $i -lt $header.Count; $i++) { $idx[$header[$i].Trim()] = $i }
    $iCnpj = if ($idx.ContainsKey('CNPJ_FUNDO_CLASSE')) { $idx['CNPJ_FUNDO_CLASSE'] } elseif ($idx.ContainsKey('CNPJ_FUNDO')) { $idx['CNPJ_FUNDO'] } else { -1 }
    $iDt = $idx['DT_COMPTC']; $iPl = $idx['VL_PATRIM_LIQ']; $iCap = $idx['CAPTC_DIA']; $iRes = $idx['RESG_DIA']
    if ($iCnpj -lt 0 -or $null -eq $iDt -or $null -eq $iCap) { throw "colunas esperadas nao encontradas" }

    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    while ($null -ne ($line = $sr.ReadLine())) {
      $c = $line.Split(';')
      if ($c.Count -le $iRes) { $invalidas++; continue }
      $cnpj = NormCNPJ $c[$iCnpj]
      $tipo = if ($tipos['12431'].ContainsKey($cnpj)) { '12431' } elseif ($tipos['trad'].ContainsKey($cnpj)) { 'trad' } else { $null }
      if (-not $tipo) { continue }
      $gestor = $tipos[$tipo][$cnpj]

      $dtRaw = $c[$iDt].Trim()
      [datetime]$dt = [datetime]::MinValue
      if (-not [datetime]::TryParse($dtRaw, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$dt)) { $invalidas++; continue }
      $wkKey = (WeekStart $dt).ToString('yyyy-MM-dd')

      $cap = 0.0; $res = 0.0; $pl = 0.0
      [double]::TryParse($c[$iCap], [System.Globalization.NumberStyles]::Any, $ci, [ref]$cap) | Out-Null
      [double]::TryParse($c[$iRes], [System.Globalization.NumberStyles]::Any, $ci, [ref]$res) | Out-Null
      [double]::TryParse($c[$iPl],  [System.Globalization.NumberStyles]::Any, $ci, [ref]$pl)  | Out-Null

      $key = "$wkKey|$gestor"
      $b = $agg[$tipo][$key]
      if (-not $b) { $b = @{ cap = 0.0; resg = 0.0; plSum = 0.0; dates = @{}; cnpjs = @{} }; $agg[$tipo][$key] = $b }
      $b.cap += $cap; $b.resg += [Math]::Abs($res); $b.plSum += $pl
      $b.dates[$dtRaw] = $true; $b.cnpjs[$cnpj] = $true
      $seen[$tipo][$cnpj] = $true

      if ($null -eq $minDate -or $dt -lt $minDate) { $minDate = $dt }
      if ($null -eq $maxDate -or $dt -gt $maxDate) { $maxDate = $dt }
    }
    $sr.Close(); $z.Dispose()
    $mesesOk += $mes
  } catch {
    Write-Host "    ERRO no mes $mes (pulando): $($_.Exception.Message)" -ForegroundColor Yellow
    $mesesFalha += $mes
  }
}

# 4. Escreve as bases
function Write-Base($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $agg[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $agg[$tipo][$k]
    $parts = $k -split '\|', 2
    $semana = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $nDates = [Math]::Max(1, $b.dates.Count)
    $plMedio = [Math]::Round($b.plSum / $nDates, 2)
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4},{5},{6}' -f $semana, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $liq.ToString($ci), $plMedio.ToString($ci), $b.cnpjs.Count))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

$out12431 = Join-Path $OutDir 'Fluxo_Semanal_12431.csv'
$outTrad  = Join-Path $OutDir 'Fluxo_Semanal_Trad.csv'
$n12431 = Write-Base '12431' $out12431
$nTrad  = Write-Base 'trad'  $outTrad

# 5. Relatorio
$nf12431 = ($L12431.map.Keys | Where-Object { -not $seen['12431'].ContainsKey($_) }).Count
$nfTrad  = ($LTrad.map.Keys  | Where-Object { -not $seen['trad'].ContainsKey($_) }).Count

Write-Host ""
Write-Host "=== RELATORIO ===" -ForegroundColor Green
Write-Host "  Meses processados : $($mesesOk -join ', ')"
if ($mesesFalha.Count) { Write-Host "  Meses com falha   : $($mesesFalha -join ', ')" -ForegroundColor Yellow }
$f1 = $seen['12431'].Count; $f2 = $seen['trad'].Count
Write-Host ("  12431  -> encontrados: {0} | nao encontrados: {1} | linhas: {2}" -f $f1, $nf12431, $n12431)
Write-Host ("  Trad   -> encontrados: {0} | nao encontrados: {1} | linhas: {2}" -f $f2, $nfTrad, $nTrad)
Write-Host "  Linhas invalidas  : $invalidas"
if ($minDate -and $maxDate) { Write-Host ("  Periodo coberto   : {0} a {1}" -f $minDate.ToString('yyyy-MM-dd'), $maxDate.ToString('yyyy-MM-dd')) }
Write-Host "  Arquivos gerados  :"
Write-Host "    $out12431" -ForegroundColor Yellow
Write-Host "    $outTrad"  -ForegroundColor Yellow
Write-Host ""
Write-Host "  Proximo: revise os CSVs, troque FLUXO_IS_MOCK para false em src/hooks/useFluxo.js e publique." -ForegroundColor White
Write-Host ""

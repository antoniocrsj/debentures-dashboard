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
    1. Resolve CNPJ_FUNDO_CLASSE -> Gestor_Apelido (ver lib-cadastro.ps1):
         GAS sheet=Fundos_12431 / sheet=Fundos_CDI  (CNPJ_FUNDO_CLASSE -> CNPJ Gestor)
         GAS sheet=Cadastro_Gestores                (CNPJ Gestor -> Apelido Gestor)
    2. Baixa os meses do Informe Diario (cache local, nao rebaixa).
    3. Calcula o fluxo SEMANAL (segunda a domingo) por gestor.
    4. Grava em public\data\:
         Fluxo_Semanal_12431.csv
         Fluxo_Semanal_Trad.csv
       Colunas: Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos
       Tambem grava public\PL_Gestores.csv (PL mais recente por gestor, consumido
       pela aba Gestores do app).

  Uso: clique 2x em preparar-fluxo.bat, ou:
       powershell -File preparar-fluxo.ps1 -Meses 202504,202505
       powershell -File preparar-fluxo.ps1 -Incremental   # rapido: so mes atual + anterior
#>

param(
  [string[]]$Meses,                                   # ex: 202504,202505 (default: ultimos 12 meses)
  # "C:\Projeto Credito\CVM _informe_diario" — [char]233 = e-acento (mantem o .ps1 em ASCII)
  [string]$CvmDir    = ("C:\Projeto Cr" + [char]233 + "dito\CVM _informe_diario"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [string]$OutDir,
  [switch]$NoDownload,                                # usa apenas os zips ja baixados (nao baixa nada)
  [switch]$Incremental                                # so processa mes atual + anterior; mescla com CSV existente
)

$ErrorActionPreference = 'Stop'
$CVM_BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

# Defaults relativos ao script
if (-not $OutDir) { $OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\data' }
$PublicDir = Split-Path $OutDir -Parent
if (-not $Meses) {
  if ($Incremental) {
    # Modo rapido: apenas os 2 meses mais recentes
    $Meses = @((Get-Date).ToString('yyyyMM'), (Get-Date).AddMonths(-1).ToString('yyyyMM'))
  } else {
    $Meses = 0..11 | ForEach-Object { (Get-Date).AddMonths(-$_).ToString('yyyyMM') }
  }
}

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

# Meses que PODEM ter dias novos: o corrente e, nos primeiros dias, o anterior.
# No modo Incremental forcamos sempre os 2 meses processados.
if ($Incremental) {
  $script:ForceMonths = $Meses
} else {
  $script:ForceMonths = @((Get-Date).ToString('yyyyMM'))
  if ((Get-Date).Day -le 5) { $script:ForceMonths += (Get-Date).AddMonths(-1).ToString('yyyyMM') }
}

function Ensure-Month($yyyymm) {
  $zip = Join-Path $CvmDir "inf_diario_fi_$yyyymm.zip"
  $mustRefresh = $script:ForceMonths -contains $yyyymm
  if (Test-Path $zip) {
    if (-not $mustRefresh) { return $zip }
    if ($NoDownload) { return $zip }
    # Modo incremental: sempre re-baixa os meses forcados (CVM atualiza o zip do mes corrente ao longo do dia).
    # Modo normal: evita re-baixar o mesmo zip mais de uma vez no dia.
    if (-not $Incremental -and (Get-Item $zip).LastWriteTime.Date -eq (Get-Date).Date) { return $zip }
  }
  if ($NoDownload) {
    Write-Host "    $yyyymm sem cache e -NoDownload ativo (pulando)." -ForegroundColor Yellow
    return $null
  }
  $url = "$CVM_BASE/inf_diario_fi_$yyyymm.zip"
  $tmp = "$zip.tmp"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 180 -UseBasicParsing
    Move-Item $tmp $zip -Force
    return $zip
  } catch {
    Write-Host "    $yyyymm indisponivel (pulando): $($_.Exception.Message)" -ForegroundColor Yellow
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    if (Test-Path $zip) { return $zip }
    return $null
  }
}

function WeekStart([datetime]$date) {
  $off = ([int]$date.DayOfWeek + 6) % 7
  return $date.AddDays(-$off)
}

# ─── Merge incremental ────────────────────────────────────────────────────────
# Mescla historico do CSV antigo (antes do periodo reprocessado) com o CSV novo.

function Merge-Semanal($oldLines, $outFile, $processedMeses) {
  if ($oldLines.Count -lt 2) { return }
  $sorted = $processedMeses | Sort-Object
  # Mantemos apenas semanas onde a segunda-feira termina antes do 1o mes processado.
  $cutoff = [datetime]::ParseExact($sorted[0] + '01', 'yyyyMMdd', $null).AddDays(-6)

  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $weekStr = $line.Split(',')[0].Trim('"')
    $d = [datetime]::MinValue
    if ([datetime]::TryParse($weekStr, [ref]$d) -and $d -lt $cutoff) { $kept.Add($line) }
  }
  if ($kept.Count -eq 0) { return }

  $newLines = [System.IO.File]::ReadAllLines($outFile)
  $merged = [System.Collections.Generic.List[string]]::new()
  $merged.Add($newLines[0])
  $merged.AddRange($kept)
  for ($i = 1; $i -lt $newLines.Count; $i++) {
    if ($newLines[$i].Trim() -ne '') { $merged.Add($newLines[$i]) }
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($outFile, $merged.ToArray(), $utf8)
  Write-Host "    +$($kept.Count) linhas historicas mescladas." -ForegroundColor DarkGray
}

function Merge-Mensal($oldLines, $outFile, $processedMeses) {
  if ($oldLines.Count -lt 2) { return }
  $sorted = $processedMeses | Sort-Object
  $cutoffYM = $sorted[0].Substring(0,4) + '-' + $sorted[0].Substring(4,2)

  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $mesStr = $line.Split(',')[0].Trim('"')
    if ($mesStr -lt $cutoffYM) { $kept.Add($line) }
  }
  if ($kept.Count -eq 0) { return }

  $newLines = [System.IO.File]::ReadAllLines($outFile)
  $merged = [System.Collections.Generic.List[string]]::new()
  $merged.Add($newLines[0])
  $merged.AddRange($kept)
  for ($i = 1; $i -lt $newLines.Count; $i++) {
    if ($newLines[$i].Trim() -ne '') { $merged.Add($newLines[$i]) }
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($outFile, $merged.ToArray(), $utf8)
  Write-Host "    +$($kept.Count) linhas historicas mescladas (mensal)." -ForegroundColor DarkGray
}
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Preparar bases de Captacao (Fluxo Semanal) ===" -ForegroundColor Green
if ($Incremental) { Write-Host "  Modo: INCREMENTAL (apenas $($Meses -join ', '))" -ForegroundColor Cyan }
New-Item -ItemType Directory -Force -Path $CvmDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1. Resolve CNPJ_FUNDO_CLASSE -> Apelido_Gestor (Fundos_12431/Fundos_CDI + Cadastro_Gestores)
Step "Buscando Fundos_12431 / Fundos_CDI / Cadastro_Gestores no cadastro..."
$fg12431 = Get-FundosGestorMap $CadastroUrl 'Fundos_12431'
$fgCdi   = Get-FundosGestorMap $CadastroUrl 'Fundos_CDI'
$gestorApelidoMap = Get-GestorApelidoMap $CadastroUrl
Write-Host "    Fundos_12431: $($fg12431.map.Count) | Fundos_CDI: $($fgCdi.map.Count) | Cadastro_Gestores: $($gestorApelidoMap.Count) gestoras"

$bridge12431 = Build-FundoApelidoMap $fg12431.map $gestorApelidoMap
$bridgeCdi   = Build-FundoApelidoMap $fgCdi.map   $gestorApelidoMap
Write-Host "    12431: $($bridge12431.map.Count) fundos resolvidos | Tradicional: $($bridgeCdi.map.Count) fundos resolvidos"
if ($bridge12431.semGestorCadastrado -gt 0 -or $bridgeCdi.semGestorCadastrado -gt 0) {
  Write-Host "      fundos com CNPJ Gestor sem cadastro em Cadastro_Gestores -> 12431: $($bridge12431.semGestorCadastrado) | Trad: $($bridgeCdi.semGestorCadastrado)" -ForegroundColor Yellow
  $faltando = @($bridge12431.gestoresFaltando) + @($bridgeCdi.gestoresFaltando) | Sort-Object -Unique
  if ($faltando.Count) { Write-Host "        CNPJs de gestor ausentes: $($faltando -join ', ')" -ForegroundColor DarkYellow }
}
if ($bridge12431.map.Count -eq 0 -and $bridgeCdi.map.Count -eq 0) {
  throw "Nenhum fundo resolvido. Verifique as abas Fundos_12431 / Fundos_CDI (coluna CNPJ Gestor) e Cadastro_Gestores."
}

$agg      = @{ '12431' = @{}; 'trad' = @{} }
$seen     = @{ '12431' = @{}; 'trad' = @{} }
$weekMax  = @{ '12431' = @{}; 'trad' = @{} }
$aggMonth = @{ '12431' = @{}; 'trad' = @{} }
$tipos    = @{ '12431' = $bridge12431.map; 'trad' = $bridgeCdi.map }

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
      if (-not $weekMax[$tipo].ContainsKey($wkKey) -or $dt -gt $weekMax[$tipo][$wkKey]) { $weekMax[$tipo][$wkKey] = $dt }

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

      $mk = ($dt.ToString('yyyy-MM')) + '|' + $gestor
      $mb = $aggMonth[$tipo][$mk]
      if (-not $mb) { $mb = @{ cap = 0.0; resg = 0.0 }; $aggMonth[$tipo][$mk] = $mb }
      $mb.cap += $cap; $mb.resg += [Math]::Abs($res)

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
  [void]$sb.AppendLine('Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos,DataBase')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $agg[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $agg[$tipo][$k]
    $parts = $k -split '\|', 2
    $semana = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $dataBase = if ($weekMax[$tipo].ContainsKey($semana)) { $weekMax[$tipo][$semana].ToString('yyyy-MM-dd') } else { $semana }
    $nDates = [Math]::Max(1, $b.dates.Count)
    $plMedio = [Math]::Round($b.plSum / $nDates, 2)
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4},{5},{6},{7}' -f $semana, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $liq.ToString($ci), $plMedio.ToString($ci), $b.cnpjs.Count, $dataBase))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

function Write-BaseMensal($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Mes,Gestor_Apelido,Captacao,Resgate,Liquido')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $aggMonth[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $aggMonth[$tipo][$k]
    $parts = $k -split '\|', 2
    $mes = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4}' -f $mes, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci), $liq.ToString($ci)))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

$out12431    = Join-Path $OutDir 'Fluxo_Semanal_12431.csv'
$outTrad     = Join-Path $OutDir 'Fluxo_Semanal_Trad.csv'
$outMes12431 = Join-Path $OutDir 'Fluxo_Mensal_12431.csv'
$outMesTrad  = Join-Path $OutDir 'Fluxo_Mensal_Trad.csv'

# Salva conteudo antigo ANTES de sobrescrever (necessario para o merge incremental)
$oldSem12431 = @(); $oldSemTrad = @(); $oldMes12431Lines = @(); $oldMesTradLines = @()
if ($Incremental) {
  if (Test-Path $out12431)    { $oldSem12431      = [System.IO.File]::ReadAllLines($out12431) }
  if (Test-Path $outTrad)     { $oldSemTrad       = [System.IO.File]::ReadAllLines($outTrad) }
  if (Test-Path $outMes12431) { $oldMes12431Lines = [System.IO.File]::ReadAllLines($outMes12431) }
  if (Test-Path $outMesTrad)  { $oldMesTradLines  = [System.IO.File]::ReadAllLines($outMesTrad) }
}

$n12431    = Write-Base       '12431' $out12431
$nTrad     = Write-Base       'trad'  $outTrad
$nMes12431 = Write-BaseMensal '12431' $outMes12431
$nMesTrad  = Write-BaseMensal 'trad'  $outMesTrad

if ($Incremental) {
  Step "Mesclando com historico existente..."
  Merge-Semanal $oldSem12431      $out12431    $Meses
  Merge-Semanal $oldSemTrad       $outTrad     $Meses
  Merge-Mensal  $oldMes12431Lines $outMes12431 $Meses
  Merge-Mensal  $oldMesTradLines  $outMesTrad  $Meses
}

# 5. PL_Gestores.csv — PL mais recente por gestor (12431 + Trad somados), consumido pela aba Gestores do app.
function Get-LatestPlByGestor($tipo) {
  $latestWk = @{}
  foreach ($k in $agg[$tipo].Keys) {
    $parts = $k -split '\|', 2; $wk = $parts[0]; $g = $parts[1]
    if (-not $latestWk.ContainsKey($g) -or $wk -gt $latestWk[$g]) { $latestWk[$g] = $wk }
  }
  $result = @{}
  foreach ($g in $latestWk.Keys) {
    $b = $agg[$tipo][$latestWk[$g] + '|' + $g]
    $nDates = [Math]::Max(1, $b.dates.Count)
    $result[$g] = $b.plSum / $nDates
  }
  return $result
}

$plByGestor = @{}
foreach ($tipo in @('12431', 'trad')) {
  $plTipo = Get-LatestPlByGestor $tipo
  foreach ($g in $plTipo.Keys) {
    if ($plByGestor.ContainsKey($g)) { $plByGestor[$g] += $plTipo[$g] } else { $plByGestor[$g] = $plTipo[$g] }
  }
}

$outPlGestores = Join-Path $PublicDir 'PL_Gestores.csv'
$sbPl = New-Object System.Text.StringBuilder
[void]$sbPl.AppendLine('Gestor_Apelido,PL')
$ciPl = [System.Globalization.CultureInfo]::InvariantCulture
foreach ($g in ($plByGestor.Keys | Sort-Object)) {
  [void]$sbPl.AppendLine(('"{0}",{1}' -f $g.Replace('"', '""'), ([Math]::Round($plByGestor[$g], 2)).ToString($ciPl)))
}
$utf8Pl = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPlGestores, $sbPl.ToString(), $utf8Pl)

# 6. Relatorio
$nf12431 = ($bridge12431.map.Keys | Where-Object { -not $seen['12431'].ContainsKey($_) }).Count
$nfTrad  = ($bridgeCdi.map.Keys   | Where-Object { -not $seen['trad'].ContainsKey($_) }).Count

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
Write-Host ("    $outMes12431  (mensal: $nMes12431 linhas)") -ForegroundColor Yellow
Write-Host ("    $outMesTrad  (mensal: $nMesTrad linhas)")  -ForegroundColor Yellow
Write-Host ("    $outPlGestores  ($($plByGestor.Count) gestoras)") -ForegroundColor Yellow
Write-Host ""
Write-Host "  Proximo: revise os CSVs, troque FLUXO_IS_MOCK para false em src/hooks/useFluxo.js e publique." -ForegroundColor White
Write-Host ""

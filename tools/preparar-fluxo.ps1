<#
  preparar-fluxo.ps1
  --------------------------------------------------------------------------
  Gera as bases SEMANAIS de captacao/resgate da aba "Captacao" a partir do
  Informe Diario de Fundos da CVM.

  Fonte CVM: https://dados.cvm.gov.br/dataset/fi-doc-inf_diario
  Arquivos:  inf_diario_fi_AAAAMM.zip  (CSV ; latin-1)
  Colunas usadas: CNPJ_FUNDO_CLASSE (ou CNPJ_FUNDO), DT_COMPTC,
                  VL_PATRIM_LIQ, CAPTC_DIA, RESG_DIA, VL_QUOTA

  O que faz:
    1. Resolve CNPJ_FUNDO_CLASSE -> Gestor_Apelido (ver lib-cadastro.ps1):
         tools\Fundos_12431.csv / tools\Fundos_CDI.csv (local, CNPJ_FUNDO_CLASSE -> CNPJ Gestor)
         GAS sheet=Cadastro_Gestores                    (CNPJ Gestor -> Apelido Gestor)
    2. Baixa os meses do Informe Diario (cache local, nao rebaixa).
    3. Calcula o fluxo SEMANAL (segunda a domingo) por gestor.
    4. Calcula a rentabilidade por gestor (retorno da cota ponderado pelo PL de
       cada fundo, comparado ao CDI do mesmo periodo) nas janelas moveis
       1 semana / 1 / 3 / 6 / 12 meses, contadas a partir do dado mais recente.
    5. Grava em public\data\:
         Fluxo_Semanal_12431.csv / Fluxo_Semanal_Trad.csv
           Colunas: Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos,DataBase
         Fluxo_Rentabilidade_12431.csv / Fluxo_Rentabilidade_Trad.csv
           Colunas: Gestor_Apelido,Retorno_1s,Retorno_1m,Retorno_3m,Retorno_6m,Retorno_12m,
                    PctCDI_1s,PctCDI_1m,PctCDI_3m,PctCDI_6m,PctCDI_12m,DataBase
           (Retorno e PctCDI ja' em pontos percentuais, ex 1.23 = 1,23%. Celula
            vazia = sem historico suficiente para aquela janela ainda.)
       Tambem grava public\PL_Gestores.csv (PL mais recente por gestor, consumido
       pela aba Gestores do app).

  Uso: clique 2x em preparar-fluxo.bat, ou:
       powershell -File preparar-fluxo.ps1 -Meses 202504,202505
       powershell -File preparar-fluxo.ps1 -Incremental   # rapido: so mes atual + anterior
#>

param(
  [string[]]$Meses,                                   # ex: 202504,202505 (default: ultimos 12 meses)
  # "C:\Projeto Credito\CVM _informe_diario" - [char]233 = e-acento (mantem o .ps1 em ASCII)
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
# Mescla historico do CSV antigo (fora do periodo reprocessado) com o CSV novo.
#
# Regra: mantem uma linha antiga SE E SOMENTE SE a sua chave (semana ou mes) nao
# foi recalculada nesta rodada (nao esta em $newKeys). Isso evita 2 problemas de
# uma versao anterior baseada em corte de data:
#   1. Nao duplica linhas (uma chave nunca vem de "antigo" E "novo" ao mesmo tempo).
#   2. A semana que atravessa a fronteira do mes mais antigo reprocessado (quando
#      esse mes nao comeca numa segunda-feira) e' removida do calculo novo ANTES
#      de chegar aqui (ver bloco logo abaixo) - como ela nao esta em $newKeys,
#      o valor antigo (completo, de um run anterior) e' preservado automaticamente
#      em vez de ser sobrescrito por um recalculo incompleto.

function Merge-Semanal($oldLines, $outFile, $newKeys) {
  if ($oldLines.Count -lt 2) { return }
  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $weekStr = $line.Split(',')[0].Trim('"')
    if (-not $newKeys.Contains($weekStr)) { $kept.Add($line) }
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

function Merge-Mensal($oldLines, $outFile, $newKeys) {
  if ($oldLines.Count -lt 2) { return }
  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $mesStr = $line.Split(',')[0].Trim('"')
    if (-not $newKeys.Contains($mesStr)) { $kept.Add($line) }
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

# 1. Resolve CNPJ_FUNDO_CLASSE -> Apelido_Gestor (Fundos_12431/Fundos_CDI locais + Cadastro_Gestores)
Step "Lendo Fundos_12431.csv / Fundos_CDI.csv (local) e buscando Cadastro_Gestores no cadastro..."
$fg12431 = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_12431.csv')
$fgCdi   = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
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
  throw "Nenhum fundo resolvido. Verifique tools\Fundos_12431.csv / tools\Fundos_CDI.csv (coluna CNPJ Gestor) e Cadastro_Gestores."
}

function Get-FundosMeta($fundoGestorMap, $fundoApelidoMap) {
  $porGestor = @{}
  foreach ($cnpj in $fundoApelidoMap.Keys) {
    $g = $fundoApelidoMap[$cnpj]
    if ($porGestor.ContainsKey($g)) { $porGestor[$g] += 1 } else { $porGestor[$g] = 1 }
  }
  $orderedGestores = [ordered]@{}
  foreach ($g in ($porGestor.Keys | Sort-Object)) { $orderedGestores[$g] = $porGestor[$g] }
  return [ordered]@{
    fundos = $fundoGestorMap.Count
    gestores = $porGestor.Count
    semGestor = [Math]::Max(0, $fundoGestorMap.Count - $fundoApelidoMap.Count)
    porGestor = $orderedGestores
  }
}

$fluxoMeta = [ordered]@{
  updatedAt = (Get-Date).ToString('s')
  rule = 'Contagem estatica da lista atual de fundos; nao varia por periodo.'
  '12431' = Get-FundosMeta $fg12431.map $bridge12431.map
  trad = Get-FundosMeta $fgCdi.map $bridgeCdi.map
}
$utf8Meta = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'Fluxo_Meta.json'), (($fluxoMeta | ConvertTo-Json -Depth 6) + "`r`n"), $utf8Meta)

$agg      = @{ '12431' = @{}; 'trad' = @{} }
$seen     = @{ '12431' = @{}; 'trad' = @{} }
$weekMax  = @{ '12431' = @{}; 'trad' = @{} }
$aggMonth = @{ '12431' = @{}; 'trad' = @{} }
$tipos    = @{ '12431' = $bridge12431.map; 'trad' = $bridgeCdi.map }
# Serie diaria de cota+PL por fundo (necessaria pra rentabilidade - retorno nao
# e' soma, precisa da cota dia a dia). $quotaSeries[$tipo][$cnpj][dataYyyyMmDd] = @{quota=;pl=}
$quotaSeries = @{ '12431' = @{}; 'trad' = @{} }

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
    $iCota = if ($idx.ContainsKey('VL_QUOTA')) { $idx['VL_QUOTA'] } else { -1 }
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

      if ($iCota -ge 0 -and $c.Count -gt $iCota) {
        $cota = 0.0
        [double]::TryParse($c[$iCota], [System.Globalization.NumberStyles]::Any, $ci, [ref]$cota) | Out-Null
        if ($cota -gt 0 -and $pl -gt 0) {
          $serieFundo = $quotaSeries[$tipo][$cnpj]
          if (-not $serieFundo) { $serieFundo = @{}; $quotaSeries[$tipo][$cnpj] = $serieFundo }
          $serieFundo[$dt.ToString('yyyy-MM-dd')] = @{ quota = $cota; pl = $pl }
        }
      }

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

# Uma semana pode ficar parcial quando um dos seus dias cai num mes ainda nao
# disponivel (ex: mes atual, antes da CVM publicar) ou nao reprocessado neste
# run. Isso e' esperado e mostrado normalmente (nao escondemos a semana) -- a
# coluna DataBase ja indica ate' que dia ela esta' atualizada, entao fica
# visivel que e' uma semana "em andamento". Ela se completa sozinha no proximo
# run, quando os dias que faltam ja tiverem sido publicados/reprocessados.
$mesesOkSet = New-Object System.Collections.Generic.HashSet[string]
$mesesOk | ForEach-Object { [void]$mesesOkSet.Add($_) }
$semanasParciais = New-Object System.Collections.Generic.List[string]
foreach ($tipo in @('12431', 'trad')) {
  foreach ($k in $agg[$tipo].Keys) {
    $wkStr = ($k -split '\|', 2)[0]
    $wkStart = [datetime]::ParseExact($wkStr, 'yyyy-MM-dd', $null)
    for ($d = 0; $d -lt 7; $d++) {
      if (-not $mesesOkSet.Contains($wkStart.AddDays($d).ToString('yyyyMM'))) { $semanasParciais.Add($wkStr); break }
    }
  }
}
if ($semanasParciais.Count -gt 0) {
  $lista = $semanasParciais | Sort-Object -Unique
  Write-Host "    Semana(s) parcial(is) (ainda em andamento, dado disponivel ate' o momento): $($lista -join ', ')" -ForegroundColor DarkGray
}

# 3b. Rentabilidade por gestor -----------------------------------------------
# Retorno da cota (nao e' soma - precisa encadear dia a dia), ponderado pelo
# PL de cada fundo no dia anterior, comparado ao CDI da mesma janela.

# Retorno acumulado no intervalo inicio-exclusivo, fim-inclusivo, a partir de
# uma serie ($dates/$rets paralelas, ja' em ordem cronologica). $null se nao
# houver nenhum dia dentro do intervalo (historico insuficiente pra' janela).
function Get-RetornoJanela($dates, $rets, [datetime]$inicio, [datetime]$fim) {
  $prod = 1.0; $achou = $false
  for ($i = 0; $i -lt $dates.Count; $i++) {
    $d = [datetime]::ParseExact($dates[$i], 'yyyy-MM-dd', $null)
    if ($d -gt $inicio -and $d -le $fim) { $prod *= (1.0 + $rets[$i]); $achou = $true }
  }
  if (-not $achou) { return $null }
  return $prod - 1.0
}

# Serie diaria de retorno por gestor: em cada dia com pelo menos 2 fundos com
# cota valida (dia atual + anterior), o retorno do gestor e' a media dos
# retornos dos fundos ponderada pelo PL de cada um no dia anterior.
function Compute-RetornoDiarioGestor($tipoQuotaSeries, $cnpjsByGestor) {
  $result = @{}
  foreach ($gestor in $cnpjsByGestor.Keys) {
    $cnpjs = $cnpjsByGestor[$gestor]
    $allDates = New-Object System.Collections.Generic.SortedSet[string]
    foreach ($cnpj in $cnpjs) {
      if ($tipoQuotaSeries.ContainsKey($cnpj)) {
        foreach ($d in $tipoQuotaSeries[$cnpj].Keys) { [void]$allDates.Add($d) }
      }
    }
    if ($allDates.Count -lt 2) { continue }
    $sortedDates = @($allDates)
    $dailyDates = New-Object System.Collections.Generic.List[string]
    $dailyRets  = New-Object System.Collections.Generic.List[double]
    for ($i = 1; $i -lt $sortedDates.Count; $i++) {
      $dPrev = $sortedDates[$i - 1]; $dCur = $sortedDates[$i]
      $sumW = 0.0; $sumWR = 0.0
      foreach ($cnpj in $cnpjs) {
        $serie = $tipoQuotaSeries[$cnpj]
        if ($serie -and $serie.ContainsKey($dPrev) -and $serie.ContainsKey($dCur)) {
          $qPrev = $serie[$dPrev].quota; $qCur = $serie[$dCur].quota; $plPrev = $serie[$dPrev].pl
          if ($qPrev -gt 0 -and $plPrev -gt 0) {
            $ret = ($qCur / $qPrev) - 1.0
            $sumW += $plPrev; $sumWR += $plPrev * $ret
          }
        }
      }
      if ($sumW -gt 0) { $dailyDates.Add($dCur); $dailyRets.Add($sumWR / $sumW) }
    }
    if ($dailyDates.Count -gt 0) { $result[$gestor] = @{ dates = $dailyDates; rets = $dailyRets } }
  }
  return $result
}

function Fmt-PctOuVazio($v, $ci) {
  if ($null -eq $v) { return '' }
  return ([Math]::Round($v, 4)).ToString($ci)
}

Step "Buscando serie do CDI (Banco Central, SGS 12) e calculando rentabilidade por gestor..."
$cdiMap = Get-CdiDiario $CvmDir ((Get-Date).AddMonths(-13)) -NoDownload:$NoDownload
Write-Host "    CDI: $($cdiMap.Count) dias carregados"

$JANELAS_DIAS   = @{ '1s' = 7 }
$JANELAS_MESES  = @{ '1m' = 1; '3m' = 3; '6m' = 6; '12m' = 12 }
$ORDEM_JANELAS  = @('1s', '1m', '3m', '6m', '12m')

$rentPorTipo = @{}
foreach ($tipo in @('12431', 'trad')) {
  $cnpjsByGestor = @{}
  foreach ($cnpj in $tipos[$tipo].Keys) {
    $g = $tipos[$tipo][$cnpj]
    if (-not $cnpjsByGestor.ContainsKey($g)) { $cnpjsByGestor[$g] = New-Object System.Collections.Generic.List[string] }
    $cnpjsByGestor[$g].Add($cnpj)
  }
  $retornoGestor = Compute-RetornoDiarioGestor $quotaSeries[$tipo] $cnpjsByGestor
  $linhas = @{}
  foreach ($gestor in $retornoGestor.Keys) {
    $serie = $retornoGestor[$gestor]
    $fimRef = [datetime]::ParseExact($serie.dates[$serie.dates.Count - 1], 'yyyy-MM-dd', $null)
    $linha = @{}
    foreach ($jk in $ORDEM_JANELAS) {
      $inicio = if ($JANELAS_DIAS.ContainsKey($jk)) { $fimRef.AddDays(-$JANELAS_DIAS[$jk]) } else { $fimRef.AddMonths(-$JANELAS_MESES[$jk]) }
      $retGestor = Get-RetornoJanela $serie.dates $serie.rets $inicio $fimRef
      $retCdi = Get-CdiRetornoJanela $cdiMap $inicio $fimRef
      $linha["ret_$jk"] = if ($null -ne $retGestor) { $retGestor * 100.0 } else { $null }
      $linha["pctcdi_$jk"] = if ($null -ne $retGestor -and $null -ne $retCdi -and $retCdi -ne 0) { ($retGestor / $retCdi) * 100.0 } else { $null }
    }
    $linha['dataBase'] = $fimRef.ToString('yyyy-MM-dd')
    $linhas[$gestor] = $linha
  }
  $rentPorTipo[$tipo] = $linhas
}

function Write-BaseRentabilidade($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Gestor_Apelido,Retorno_1s,Retorno_1m,Retorno_3m,Retorno_6m,Retorno_12m,PctCDI_1s,PctCDI_1m,PctCDI_3m,PctCDI_6m,PctCDI_12m,DataBase')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $linhas = $rentPorTipo[$tipo]
  foreach ($gestor in ($linhas.Keys | Sort-Object)) {
    $l = $linhas[$gestor]
    $cols = New-Object System.Collections.Generic.List[string]
    $cols.Add('"' + $gestor.Replace('"', '""') + '"')
    foreach ($jk in $ORDEM_JANELAS) { $cols.Add((Fmt-PctOuVazio $l["ret_$jk"] $ci)) }
    foreach ($jk in $ORDEM_JANELAS) { $cols.Add((Fmt-PctOuVazio $l["pctcdi_$jk"] $ci)) }
    $cols.Add($l['dataBase'])
    [void]$sb.AppendLine(($cols -join ','))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $linhas.Count
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

# Rentabilidade nao e' mesclada com o historico (diferente de Semanal/Mensal):
# cada janela (1s..12m) precisa da serie de cota do periodo INTEIRO presente
# em $quotaSeries NESTA rodada. Rodando com -Incremental (so' 2 meses), as
# janelas maiores (3m/6m/12m) ficam vazias por falta de historico - pra' elas
# sairem preenchidas e' preciso rodar sem -Incremental cobrindo os 12 meses.
$outRent12431 = Join-Path $OutDir 'Fluxo_Rentabilidade_12431.csv'
$outRentTrad  = Join-Path $OutDir 'Fluxo_Rentabilidade_Trad.csv'
$nRent12431 = Write-BaseRentabilidade '12431' $outRent12431
$nRentTrad  = Write-BaseRentabilidade 'trad'  $outRentTrad

if ($Incremental) {
  Step "Mesclando com historico existente..."
  $newWeek12431 = New-Object System.Collections.Generic.HashSet[string]
  $agg['12431'].Keys | ForEach-Object { [void]$newWeek12431.Add(($_ -split '\|', 2)[0]) }
  $newWeekTrad = New-Object System.Collections.Generic.HashSet[string]
  $agg['trad'].Keys | ForEach-Object { [void]$newWeekTrad.Add(($_ -split '\|', 2)[0]) }
  $newMonth12431 = New-Object System.Collections.Generic.HashSet[string]
  $aggMonth['12431'].Keys | ForEach-Object { [void]$newMonth12431.Add(($_ -split '\|', 2)[0]) }
  $newMonthTrad = New-Object System.Collections.Generic.HashSet[string]
  $aggMonth['trad'].Keys | ForEach-Object { [void]$newMonthTrad.Add(($_ -split '\|', 2)[0]) }

  Merge-Semanal $oldSem12431      $out12431    $newWeek12431
  Merge-Semanal $oldSemTrad       $outTrad     $newWeekTrad
  Merge-Mensal  $oldMes12431Lines $outMes12431 $newMonth12431
  Merge-Mensal  $oldMesTradLines  $outMesTrad  $newMonthTrad
}

# 5. PL_Gestores.csv - PL mais recente por gestor (12431 + Trad somados), consumido pela aba Gestores do app.
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
Write-Host ("    $outRent12431  (rentabilidade: $nRent12431 gestoras)") -ForegroundColor Yellow
Write-Host ("    $outRentTrad  (rentabilidade: $nRentTrad gestoras)")  -ForegroundColor Yellow
Write-Host ("    $outPlGestores  ($($plByGestor.Count) gestoras)") -ForegroundColor Yellow
Write-Host ""
Write-Host "  Proximo: revise os CSVs, troque FLUXO_IS_MOCK para false em src/hooks/useFluxo.js e publique." -ForegroundColor White
Write-Host ""

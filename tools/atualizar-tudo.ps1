<#
  atualizar-tudo.ps1
  --------------------------------------------------------------------------
  Fluxo de 1 clique para atualizar as bases publicas do app com seguranca:
    1. Atualiza Captacao sempre (incremental).
    2. Atualiza o cadastro de debentures sempre.
    3. Atualiza BLC somente se o mes-alvo ainda nao estiver registrado.
    4. Tenta atualizar ANBIMA, mas nao trava tudo se falhar.
    5. Mostra resumo.
    6. Pergunta se deve publicar agora.

  Este script nao aplica Sugestao_Novos/Remover e nao altera Fundos_12431/CDI.
#>

param(
  [switch]$ForceBlc,
  [switch]$SkipAnbima,
  [switch]$NoPublishPrompt
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$PublicDir = Join-Path $Root 'public'
$BlcMetaPath = Join-Path $PublicDir 'BLC_meta.json'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

$summary = [ordered]@{
  Captacao = 'nao executado'
  Debentures = 'nao executado'
  BLC      = 'nao executado'
  ANBIMA   = 'nao executado'
  Publicacao = 'nao executada'
}

function Step([string]$msg) {
  Write-Host ""
  Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Ok([string]$msg) {
  Write-Host "  OK - $msg" -ForegroundColor Green
}

function Warn([string]$msg) {
  Write-Host "  AVISO - $msg" -ForegroundColor Yellow
}

function Fail([string]$msg) {
  Write-Host "  ERRO - $msg" -ForegroundColor Red
}

function Read-BlcMeta {
  if (-not (Test-Path $BlcMetaPath)) { return $null }
  try {
    return Get-Content -Raw -Path $BlcMetaPath | ConvertFrom-Json
  } catch {
    Warn "BLC_meta.json existe, mas nao consegui ler. Vou recalcular o BLC."
    return $null
  }
}

function Write-BlcMeta([string]$mesAno) {
  $meta = [ordered]@{
    mesAno = $mesAno
    updatedAt = (Get-Date).ToString('s')
    source = 'CVM CDA'
    rule = 'dia <= 15: mes atual -5; dia > 15: mes atual -4'
  }
  $json = $meta | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($BlcMetaPath, $json + "`r`n", $utf8)
}

function Get-PublicStatus {
  $lines = & git -C $Root status --short -- public/
  if ($LASTEXITCODE -ne 0) { throw "git status falhou" }
  return @($lines | Where-Object { $_ -and $_.Trim() -ne '' })
}

function Read-PublicCsv([string]$relativePath) {
  $path = Join-Path $PublicDir $relativePath
  if (-not (Test-Path $path)) { return @() }
  try {
    $lines = @(Read-AllLinesShared $path ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' })
    if ($lines.Count -lt 1) { return @() }
    return @($lines | ConvertFrom-Csv)
  } catch {
    Warn "Nao consegui ler $relativePath para o resumo comparativo: $($_.Exception.Message)"
    return @()
  }
}

function To-Number($value) {
  if ($null -eq $value) { return 0.0 }
  if ($value -is [double] -or $value -is [int] -or $value -is [long] -or $value -is [decimal]) {
    return [double]$value
  }
  $s = ([string]$value).Trim()
  if ($s -eq '') { return 0.0 }
  if ($s.Contains(',') -and $s.Contains('.')) {
    $s = $s -replace '\.', '' -replace ',', '.'
  } elseif ($s.Contains(',')) {
    $s = $s -replace ',', '.'
  }
  $n = 0.0
  if ([double]::TryParse($s, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return $n
  }
  return 0.0
}

function Max-Text($values) {
  $arr = @($values | Where-Object { $_ -and ([string]$_).Trim() -ne '' } | Sort-Object)
  if ($arr.Count -eq 0) { return '' }
  return [string]$arr[-1]
}

function Get-CaptacaoMetrics([string]$relativePath) {
  $rows = @(Read-PublicCsv $relativePath)
  if ($rows.Count -eq 0) {
    return [pscustomobject]@{
      Rows=0; Semanas=0; Gestores=0; UltimaSemana=''; DataBase=''; FundosRecentes=0
      PLRecente=0.0; CaptacaoRecente=0.0; ResgateRecente=0.0; LiquidoRecente=0.0; LiquidoTotal=0.0
    }
  }

  $semanas = @($rows | ForEach-Object { $_.Semana } | Where-Object { $_ } | Sort-Object -Unique)
  $ultimaSemana = if ($semanas.Count) { [string]$semanas[-1] } else { '' }
  $latestRows = @($rows | Where-Object { $_.Semana -eq $ultimaSemana })
  $gestores = @($rows | ForEach-Object { $_.Gestor_Apelido } | Where-Object { $_ } | Sort-Object -Unique)
  $dataBase = Max-Text ($rows | ForEach-Object {
    if ($_.PSObject.Properties.Name -contains 'DataBase') { $_.DataBase } else { $_.Semana }
  })

  $cap = ($latestRows | ForEach-Object { To-Number $_.Captacao } | Measure-Object -Sum).Sum
  $res = ($latestRows | ForEach-Object { To-Number $_.Resgate } | Measure-Object -Sum).Sum
  $pl  = ($latestRows | ForEach-Object { To-Number $_.PL_Medio } | Measure-Object -Sum).Sum
  $nf  = ($latestRows | ForEach-Object { To-Number $_.Num_Fundos } | Measure-Object -Sum).Sum
  $liqTotal = ($rows | ForEach-Object { (To-Number $_.Captacao) - (To-Number $_.Resgate) } | Measure-Object -Sum).Sum

  return [pscustomobject]@{
    Rows=$rows.Count
    Semanas=$semanas.Count
    Gestores=$gestores.Count
    UltimaSemana=$ultimaSemana
    DataBase=$dataBase
    FundosRecentes=[int][math]::Round($nf)
    PLRecente=[double]$pl
    CaptacaoRecente=[double]$cap
    ResgateRecente=[double]$res
    LiquidoRecente=[double]($cap - $res)
    LiquidoTotal=[double]$liqTotal
  }
}

function Read-MetaJson([string]$relativePath) {
  $path = Join-Path $PublicDir $relativePath
  if (-not (Test-Path $path)) { return $null }
  try { return Get-Content -Raw -Path $path | ConvertFrom-Json } catch { return $null }
}

function Get-DebenturesMetrics {
  $rows = @(Read-PublicCsv 'Debentures.csv')
  $assets = @($rows | ForEach-Object { $_.'Codigo do Ativo' } | Where-Object { $_ } | Sort-Object -Unique)
  $emissores = @($rows | ForEach-Object { $_.CNPJ } | Where-Object { $_ } | Sort-Object -Unique)
  $incentivadas = @($rows | Where-Object { ([string]$_.'Deb. Incent. (Lei 12.431)').Trim().ToUpperInvariant() -eq 'S' })
  $registradas = @($rows | Where-Object { ([string]$_.Situacao).Trim() -match '(?i)registr' })
  $meta = Read-MetaJson 'Debentures_meta.json'
  return [pscustomobject]@{
    Rows=$rows.Count
    Ativos=$assets.Count
    Emissores=$emissores.Count
    Incentivadas=$incentivadas.Count
    Registradas=$registradas.Count
    FonteGeradaEm=$(if ($meta -and $meta.generatedAtSource) { [string]$meta.generatedAtSource } else { '' })
    AssetList=$assets
  }
}

function Get-BlcMetrics {
  $rows = @(Read-PublicCsv 'BLC_tratado.csv')
  $assets = @($rows | ForEach-Object { $_.CD_ATIVO } | Where-Object { $_ } | Sort-Object -Unique)
  $gestores = @($rows | ForEach-Object { $_.GESTOR } | Where-Object { $_ } | Sort-Object -Unique)
  $total = ($rows | ForEach-Object { To-Number $_.VL_ALOCADO } | Measure-Object -Sum).Sum
  $meta = Read-BlcMeta
  return [pscustomobject]@{
    Rows=$rows.Count
    Ativos=$assets.Count
    Gestores=$gestores.Count
    TotalAlocado=[double]$total
    MesAno=$(if ($meta -and $meta.mesAno) { [string]$meta.mesAno } else { '' })
    AssetList=$assets
    GestorList=$gestores
  }
}

function Get-AnbimaMetrics {
  $rows = @(Read-PublicCsv 'Anbima_Tx.csv')
  $dash = [string][char]8212
  $tickers = @($rows | ForEach-Object { $_.ticker } | Where-Object { $_ } | Sort-Object -Unique)
  $comTaxa = @($rows | Where-Object {
    $v = [string]$_.txAnbimaFormatada
    $v.Trim() -ne '' -and $v.Trim() -ne $dash
  })
  $comDuration = @($rows | Where-Object {
    ([string]$_.durationAnbimaAnos).Trim() -ne '' -or ([string]$_.durationAnbimaDiasUteis).Trim() -ne ''
  })
  return [pscustomobject]@{
    Rows=$rows.Count
    Tickers=$tickers.Count
    ComTaxa=$comTaxa.Count
    ComDuration=$comDuration.Count
    DataRef=$(Max-Text ($rows | ForEach-Object { $_.dataReferenciaAnbima }))
  }
}

function Get-DataSnapshot {
  return [pscustomobject]@{
    Captacao12431 = Get-CaptacaoMetrics 'data\Fluxo_Semanal_12431.csv'
    CaptacaoTrad  = Get-CaptacaoMetrics 'data\Fluxo_Semanal_Trad.csv'
    Debentures    = Get-DebenturesMetrics
    BLC           = Get-BlcMetrics
    ANBIMA        = Get-AnbimaMetrics
  }
}

function Format-Count($v) {
  if ($null -eq $v -or $v -eq '') { return '-' }
  return ([double]$v).ToString('N0', [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'))
}

function Format-Money($v) {
  if ($null -eq $v -or $v -eq '') { return '-' }
  $n = [double]$v
  $abs = [math]::Abs($n)
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR')
  if ($abs -ge 1000000000) { return 'R$ ' + ($n / 1000000000).ToString('N1', $culture) + ' bi' }
  if ($abs -ge 1000000)    { return 'R$ ' + ($n / 1000000).ToString('N1', $culture) + ' mi' }
  if ($abs -ge 1000)       { return 'R$ ' + ($n / 1000).ToString('N0', $culture) + ' mil' }
  return 'R$ ' + $n.ToString('N0', $culture)
}

function Format-Value($v, [string]$kind) {
  if ($kind -eq 'money') { return Format-Money $v }
  if ($kind -eq 'count') { return Format-Count $v }
  if ($null -eq $v -or $v -eq '') { return '-' }
  return [string]$v
}

function Format-Delta($before, $after, [string]$kind) {
  if ($kind -eq 'text') {
    if ([string]$before -eq [string]$after) { return 'sem mudanca' }
    return 'mudou'
  }
  $delta = [double]$after - [double]$before
  if ([math]::Abs($delta) -lt 0.0001) { return 'sem mudanca' }
  $prefix = if ($delta -gt 0) { '+' } else { '' }
  if ($kind -eq 'money') { return $prefix + (Format-Money $delta) }
  return $prefix + (Format-Count $delta)
}

function Write-CompareLine([string]$label, $before, $after, [string]$kind = 'count') {
  Write-Host ("  {0}: {1} -> {2} ({3})" -f $label, (Format-Value $before $kind), (Format-Value $after $kind), (Format-Delta $before $after $kind))
}

function Get-NewItems($beforeList, $afterList) {
  $old = @{}
  foreach ($x in @($beforeList)) { if ($x) { $old[[string]$x] = $true } }
  return @($afterList | Where-Object { $_ -and -not $old.ContainsKey([string]$_) })
}

function Write-CaptacaoCompare([string]$label, $before, $after) {
  Write-Host ""
  Write-Host "Captacao - $label" -ForegroundColor White
  Write-CompareLine 'Ultimo dado disponivel' $before.DataBase $after.DataBase 'text'
  Write-CompareLine 'Semana mais recente' $before.UltimaSemana $after.UltimaSemana 'text'
  Write-CompareLine 'Semanas na base' $before.Semanas $after.Semanas 'count'
  Write-CompareLine 'Gestores na base' $before.Gestores $after.Gestores 'count'
  Write-CompareLine 'Fundos na semana recente' $before.FundosRecentes $after.FundosRecentes 'count'
  Write-CompareLine 'PL semana recente' $before.PLRecente $after.PLRecente 'money'
  Write-CompareLine 'Captacao semana recente' $before.CaptacaoRecente $after.CaptacaoRecente 'money'
  Write-CompareLine 'Resgate semana recente' $before.ResgateRecente $after.ResgateRecente 'money'
  Write-CompareLine 'Cap. liquida semana recente' $before.LiquidoRecente $after.LiquidoRecente 'money'
  Write-CompareLine 'Cap. liquida base inteira' $before.LiquidoTotal $after.LiquidoTotal 'money'
}

function Write-BlcCompare($before, $after) {
  Write-Host ""
  Write-Host "BLC / Alocacao" -ForegroundColor White
  Write-CompareLine 'Mes registrado' $before.MesAno $after.MesAno 'text'
  Write-CompareLine 'Linhas ativo+gestor' $before.Rows $after.Rows 'count'
  Write-CompareLine 'Ativos com alocacao' $before.Ativos $after.Ativos 'count'
  Write-CompareLine 'Gestores com alocacao' $before.Gestores $after.Gestores 'count'
  Write-CompareLine 'Total alocado' $before.TotalAlocado $after.TotalAlocado 'money'

  $newAssets = Get-NewItems $before.AssetList $after.AssetList
  $removedAssets = Get-NewItems $after.AssetList $before.AssetList
  $newGestores = Get-NewItems $before.GestorList $after.GestorList
  $removedGestores = Get-NewItems $after.GestorList $before.GestorList
  Write-Host ("  Novos ativos: {0}" -f (Format-Count $newAssets.Count))
  if ($newAssets.Count -gt 0) { Write-Host ("    " + (($newAssets | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
  Write-Host ("  Ativos que sairam: {0}" -f (Format-Count $removedAssets.Count))
  if ($removedAssets.Count -gt 0) { Write-Host ("    " + (($removedAssets | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
  Write-Host ("  Novos gestores: {0}" -f (Format-Count $newGestores.Count))
  if ($newGestores.Count -gt 0) { Write-Host ("    " + (($newGestores | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
  Write-Host ("  Gestores que sairam: {0}" -f (Format-Count $removedGestores.Count))
  if ($removedGestores.Count -gt 0) { Write-Host ("    " + (($removedGestores | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
}

function Write-DebenturesCompare($before, $after) {
  Write-Host ""
  Write-Host "Cadastro de Debentures" -ForegroundColor White
  Write-CompareLine 'Fonte gerada em' $before.FonteGeradaEm $after.FonteGeradaEm 'text'
  Write-CompareLine 'Linhas' $before.Rows $after.Rows 'count'
  Write-CompareLine 'Ativos' $before.Ativos $after.Ativos 'count'
  Write-CompareLine 'Emissores' $before.Emissores $after.Emissores 'count'
  Write-CompareLine 'Deb. incentivadas' $before.Incentivadas $after.Incentivadas 'count'
  Write-CompareLine 'Registradas' $before.Registradas $after.Registradas 'count'

  $newAssets = Get-NewItems $before.AssetList $after.AssetList
  $removedAssets = Get-NewItems $after.AssetList $before.AssetList
  Write-Host ("  Novos ativos no cadastro: {0}" -f (Format-Count $newAssets.Count))
  if ($newAssets.Count -gt 0) { Write-Host ("    " + (($newAssets | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
  Write-Host ("  Ativos que sairam do cadastro: {0}" -f (Format-Count $removedAssets.Count))
  if ($removedAssets.Count -gt 0) { Write-Host ("    " + (($removedAssets | Select-Object -First 10) -join ', ')) -ForegroundColor Yellow }
}

function Write-AnbimaCompare($before, $after) {
  Write-Host ""
  Write-Host "ANBIMA" -ForegroundColor White
  Write-CompareLine 'Data referencia' $before.DataRef $after.DataRef 'text'
  Write-CompareLine 'Tickers na base' $before.Tickers $after.Tickers 'count'
  Write-CompareLine 'Com Tx Anbima' $before.ComTaxa $after.ComTaxa 'count'
  Write-CompareLine 'Com Duration' $before.ComDuration $after.ComDuration 'count'
}

function Write-ImpactReport($before, $after) {
  Write-Host ""
  Write-Host "=== IMPACTO DA ATUALIZACAO (ANTES -> DEPOIS) ===" -ForegroundColor Green
  Write-CaptacaoCompare 'Incentivado 12.431' $before.Captacao12431 $after.Captacao12431
  Write-CaptacaoCompare 'Credito Tradicional' $before.CaptacaoTrad $after.CaptacaoTrad
  Write-DebenturesCompare $before.Debentures $after.Debentures
  Write-BlcCompare $before.BLC $after.BLC
  Write-AnbimaCompare $before.ANBIMA $after.ANBIMA
}

Write-Host ""
Write-Host "=== Atualizacao completa do Debentures CR ===" -ForegroundColor Green
Write-Host "Pasta: $Root"

$snapshotBefore = Get-DataSnapshot

# 1. Captacao sempre
Step "1/6 Captacao"
try {
  & (Join-Path $PSScriptRoot 'preparar-fluxo.ps1') -Incremental
  $summary.Captacao = 'OK'
  Ok "Captacao atualizada."
} catch {
  $summary.Captacao = "FALHOU: $($_.Exception.Message)"
  Fail $summary.Captacao
  throw "Interrompido: Captacao e a atualizacao principal."
}

# 2. Cadastro de debentures sempre
Step "2/6 Cadastro de Debentures"
try {
  & (Join-Path $PSScriptRoot 'preparar-debentures.ps1')
  $summary.Debentures = 'OK'
  Ok "Cadastro de debentures atualizado."
} catch {
  $summary.Debentures = "FALHOU: $($_.Exception.Message)"
  Fail $summary.Debentures
  throw "Interrompido: cadastro de debentures falhou."
}

# 3. BLC se necessario
Step "3/6 BLC / Alocacao"
$targetMonth = Get-CdaTargetMonth
$meta = Read-BlcMeta
$blcFile = Join-Path $PublicDir 'BLC_tratado.csv'
$blcAlreadyCurrent = (
  -not $ForceBlc -and
  $meta -and
  $meta.mesAno -eq $targetMonth -and
  (Test-Path $blcFile)
)

if ($blcAlreadyCurrent) {
  $summary.BLC = "PULADO (mes $targetMonth ja registrado)"
  Ok $summary.BLC
} else {
  try {
    Write-Host "  Mes-alvo: $targetMonth"
    & (Join-Path $PSScriptRoot 'preparar-blc.ps1') -MesAno $targetMonth
    Write-BlcMeta $targetMonth
    $summary.BLC = "OK (mes $targetMonth)"
    Ok "BLC atualizado e BLC_meta.json registrado."
  } catch {
    $summary.BLC = "FALHOU: $($_.Exception.Message)"
    Fail $summary.BLC
    throw "Interrompido: BLC falhou."
  }
}

# 4. ANBIMA opcional
Step "4/6 ANBIMA"
if ($SkipAnbima) {
  $summary.ANBIMA = 'PULADO por parametro -SkipAnbima'
  Warn $summary.ANBIMA
} else {
  try {
    & (Join-Path $PSScriptRoot 'preparar-anbima.ps1')
    $summary.ANBIMA = 'OK'
    Ok "ANBIMA atualizada."
  } catch {
    $summary.ANBIMA = "FALHOU sem travar: $($_.Exception.Message)"
    Warn $summary.ANBIMA
  }
}

# 5. Resumo
Step "5/6 Resumo"
$snapshotAfter = Get-DataSnapshot
Write-ImpactReport $snapshotBefore $snapshotAfter

Write-Host ""
Write-Host "Status das etapas:" -ForegroundColor White
foreach ($k in $summary.Keys) {
  if ($k -eq 'Publicacao') { continue }
  Write-Host ("  {0}: {1}" -f $k, $summary[$k])
}

$publicStatus = Get-PublicStatus
Write-Host ""
Write-Host "Arquivos alterados em public/:"
if ($publicStatus.Count -eq 0) {
  Write-Host "  (nenhuma alteracao em public/)" -ForegroundColor DarkGray
} else {
  $publicStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}

# 6. Publicacao
Step "6/6 Publicacao"
if ($publicStatus.Count -eq 0) {
  $summary.Publicacao = 'nada para publicar'
  Ok $summary.Publicacao
} else {
  $publish = 'N'
  if ($NoPublishPrompt) {
    $publish = 'N'
  } else {
    $publish = Read-Host "Publicar agora? (S/N)"
  }

  if ($publish -match '^(?i)s') {
    try {
      & git -C $Root add public/
      if ($LASTEXITCODE -ne 0) { throw "git add public/ falhou" }

      & git -C $Root commit -m "Atualiza dados"
      if ($LASTEXITCODE -ne 0) { throw "git commit falhou" }

      & git -C $Root push
      if ($LASTEXITCODE -ne 0) { throw "git push falhou" }

      $summary.Publicacao = 'OK'
      Ok "Publicado. A Vercel deve atualizar em cerca de 1 minuto."
    } catch {
      $summary.Publicacao = "FALHOU: $($_.Exception.Message)"
      Fail $summary.Publicacao
      throw
    }
  } else {
    $summary.Publicacao = 'nao publicada por escolha do usuario'
    Warn "Arquivos ficaram gerados localmente. Rode publicar.bat ou este script de novo para publicar."
  }
}

Write-Host ""
Write-Host "=== RESUMO FINAL ===" -ForegroundColor Green
foreach ($k in $summary.Keys) {
  Write-Host ("  {0}: {1}" -f $k, $summary[$k])
}
Write-Host ""

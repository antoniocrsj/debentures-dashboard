<#
  atualizar-tudo.ps1
  --------------------------------------------------------------------------
  Fluxo de 1 clique para atualizar as bases publicas do app com seguranca:
    1. Avalia a lista de fundos 12431/CDI e so aplica se confirmado.
    2. Atualiza Captacao sempre (incremental).
    3. Atualiza o cadastro de debentures sempre.
    4. Atualiza BLC somente se o mes-alvo ainda nao estiver registrado.
    5. Tenta atualizar ANBIMA, mas nao trava tudo se falhar.
    6. Mostra resumo.
    7. Pergunta se deve publicar agora.
#>

param(
  [switch]$SkipFundos,
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
  Fundos   = 'nao executado'
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

function Get-PublishStatus {
  $lines = & git -C $Root status --short -- public/ tools/Fundos_12431.csv tools/Fundos_CDI.csv
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
    Fundos        = Get-FundosMetrics
    Captacao12431 = Get-CaptacaoMetrics 'data\Fluxo_Semanal_12431.csv'
    CaptacaoTrad  = Get-CaptacaoMetrics 'data\Fluxo_Semanal_Trad.csv'
    Debentures    = Get-DebenturesMetrics
    BLC           = Get-BlcMetrics
    ANBIMA        = Get-AnbimaMetrics
  }
}

function Read-FundosRows([string]$path, [string]$segmento) {
  if (-not (Test-Path $path)) { return @() }
  $lines = @(Read-AllLinesShared $path ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -lt 1) { return @() }

  $hdr = Split-CsvLine $lines[0]
  $iFundo = Find-ColIndex $hdr '(?i)cnpj.*(fundo|classe)' '(?i)gestor'
  if ($iFundo -lt 0) { $iFundo = Find-ColIndex $hdr '(?i)cnpj' '(?i)gestor' }
  $iGestor = Find-ColIndex $hdr '(?i)cnpj.*gestor'
  if ($iGestor -lt 0) { $iGestor = Find-ColIndex $hdr '(?i)gestor.*cnpj' }
  $iDenom = Find-ColIndex $hdr '(?i)denom'
  if ($iFundo -lt 0) { throw "$path`: coluna CNPJ_FUNDO_CLASSE nao encontrada." }

  $rows = New-Object System.Collections.Generic.List[object]
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $cols = Split-CsvLine $lines[$i]
    if ($cols.Count -le $iFundo) { continue }
    $cnpj = NormCNPJ $cols[$iFundo]
    if ($cnpj -eq '') { continue }
    $denom = if ($iDenom -ge 0 -and $cols.Count -gt $iDenom) { ([string]$cols[$iDenom]).Trim() } else { '' }
    $gestor = if ($iGestor -ge 0 -and $cols.Count -gt $iGestor) { NormCNPJ $cols[$iGestor] } else { '' }
    $rows.Add([pscustomobject]@{ Cnpj=$cnpj; Denom=$denom; CnpjGestor=$gestor; Segmento=$segmento })
  }
  return $rows.ToArray()
}

function Get-FundosMetricsFromFiles([string]$path12431, [string]$pathCdi) {
  $rows12431 = @(Read-FundosRows $path12431 '12431')
  $rowsCdi = @(Read-FundosRows $pathCdi 'CDI')
  $rows = @($rows12431 + $rowsCdi)

  $segmentMap = @{}
  $rowMap = @{}
  $duplicados = New-Object System.Collections.Generic.List[string]
  foreach ($r in $rows) {
    if ($segmentMap.ContainsKey($r.Cnpj)) {
      $duplicados.Add($r.Cnpj)
    }
    $segmentMap[$r.Cnpj] = $r.Segmento
    $rowMap[$r.Cnpj] = $r
  }

  $gestores = @($rows | ForEach-Object { $_.CnpjGestor } | Where-Object { $_ } | Sort-Object -Unique)
  $semGestor = @($rows | Where-Object { -not $_.CnpjGestor })
  return [pscustomobject]@{
    Rows=@($rows)
    RowMap=$rowMap
    SegmentMap=$segmentMap
    Total=$segmentMap.Count
    Fundos12431=$rows12431.Count
    FundosCdi=$rowsCdi.Count
    Gestores=$gestores.Count
    SemGestor=$semGestor.Count
    Duplicados=@($duplicados | Sort-Object -Unique)
  }
}

function Get-FundosMetrics {
  return Get-FundosMetricsFromFiles `
    (Join-Path $PSScriptRoot 'Fundos_12431.csv') `
    (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
}

function Get-FundosSuggestionMetrics {
  $path12431 = Join-Path $PSScriptRoot 'Sugestao_Lista_Final_12431.csv'
  $pathCdi = Join-Path $PSScriptRoot 'Sugestao_Lista_Final_CDI.csv'
  if (-not (Test-Path $path12431) -or -not (Test-Path $pathCdi)) {
    throw "selecionar-fundos.ps1 nao gerou as listas finais esperadas."
  }
  $metrics = Get-FundosMetricsFromFiles $path12431 $pathCdi
  if ($metrics.Total -eq 0) {
    throw "listas finais de fundos vieram vazias."
  }
  return $metrics
}

function Get-FundosDiff($before, $after) {
  $novos = @(@($after.Rows) | Where-Object { -not $before.RowMap.ContainsKey($_.Cnpj) })
  $removidos = @(@($before.Rows) | Where-Object { -not $after.RowMap.ContainsKey($_.Cnpj) })
  $mudaram = @(@($after.Rows) | Where-Object {
    $before.RowMap.ContainsKey($_.Cnpj) -and $before.RowMap[$_.Cnpj].Segmento -ne $_.Segmento
  })
  $alterados = @(@($after.Rows) | Where-Object {
    $before.RowMap.ContainsKey($_.Cnpj) -and (
      $before.RowMap[$_.Cnpj].Segmento -ne $_.Segmento -or
      $before.RowMap[$_.Cnpj].CnpjGestor -ne $_.CnpjGestor -or
      $before.RowMap[$_.Cnpj].Denom -ne $_.Denom
    )
  })
  return [pscustomobject]@{ Novos=$novos; Removidos=$removidos; Mudaram=$mudaram; Alterados=$alterados }
}

function Test-FundosSame($before, $after) {
  if ($before.Total -ne $after.Total) { return $false }
  $diff = Get-FundosDiff $before $after
  return ($diff.Novos.Count -eq 0 -and $diff.Removidos.Count -eq 0 -and $diff.Alterados.Count -eq 0)
}

function Format-FundosSample($rows) {
  $sample = @(@($rows) | Select-Object -First 10 | ForEach-Object {
    $nome = if ($_.Denom) { $_.Denom } else { $_.Cnpj }
    "{0}: {1}" -f $_.Segmento, $nome
  })
  if ($sample.Count -eq 0) { return @() }
  return $sample
}

function Write-FundosCompare($before, $after) {
  Write-Host ""
  Write-Host "Lista de Fundos 12431/CDI" -ForegroundColor White
  Write-CompareLine 'Fundos distintos' $before.Total $after.Total 'count'
  Write-CompareLine 'Fundos 12431' $before.Fundos12431 $after.Fundos12431 'count'
  Write-CompareLine 'Fundos CDI' $before.FundosCdi $after.FundosCdi 'count'
  Write-CompareLine 'Gestores informados' $before.Gestores $after.Gestores 'count'
  Write-CompareLine 'Fundos sem CNPJ Gestor' $before.SemGestor $after.SemGestor 'count'
  Write-CompareLine 'Duplicados entre listas' $before.Duplicados.Count $after.Duplicados.Count 'count'

  $diff = Get-FundosDiff $before $after
  Write-Host ("  Novos fundos: {0}" -f (Format-Count $diff.Novos.Count))
  foreach ($x in (Format-FundosSample $diff.Novos)) { Write-Host "    $x" -ForegroundColor Yellow }
  Write-Host ("  Fundos removidos: {0}" -f (Format-Count $diff.Removidos.Count))
  foreach ($x in (Format-FundosSample $diff.Removidos)) { Write-Host "    $x" -ForegroundColor Yellow }
  Write-Host ("  Mudaram de lista: {0}" -f (Format-Count $diff.Mudaram.Count))
  foreach ($x in (Format-FundosSample $diff.Mudaram)) { Write-Host "    $x" -ForegroundColor Yellow }
}

function Apply-FundosSuggestion {
  Copy-Item -Path (Join-Path $PSScriptRoot 'Sugestao_Lista_Final_12431.csv') -Destination (Join-Path $PSScriptRoot 'Fundos_12431.csv') -Force
  Copy-Item -Path (Join-Path $PSScriptRoot 'Sugestao_Lista_Final_CDI.csv') -Destination (Join-Path $PSScriptRoot 'Fundos_CDI.csv') -Force
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
  Write-FundosCompare $before.Fundos $after.Fundos
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

# 1. Lista de fundos 12431/CDI: avalia sempre, aplica so com confirmacao.
Step "1/7 Lista de Fundos 12431/CDI"
if ($SkipFundos) {
  $summary.Fundos = 'PULADO por parametro -SkipFundos'
  Warn $summary.Fundos
} else {
  try {
    & (Join-Path $PSScriptRoot 'selecionar-fundos.ps1')
    $fundosAtuais = Get-FundosMetrics
    $fundosSugeridos = Get-FundosSuggestionMetrics

    Write-Host ""
    Write-Host "=== IMPACTO SUGERIDO NA LISTA DE FUNDOS ===" -ForegroundColor Green
    Write-FundosCompare $fundosAtuais $fundosSugeridos

    if ($fundosSugeridos.Duplicados.Count -gt 0) {
      $summary.Fundos = "BLOQUEADO: sugestao tem $($fundosSugeridos.Duplicados.Count) duplicado(s)"
      Warn "$($summary.Fundos). Vou seguir com a lista atual."
    } elseif (Test-FundosSame $fundosAtuais $fundosSugeridos) {
      $summary.Fundos = 'sem alteracoes sugeridas'
      Ok $summary.Fundos
    } else {
      $applyFundos = 'N'
      if ($NoPublishPrompt) {
        $applyFundos = 'N'
      } else {
        $applyFundos = Read-Host "Aplicar lista sugerida de fundos agora? (S/N)"
      }

      if ($applyFundos -match '^(?i)s') {
        Apply-FundosSuggestion
        $fundosDepois = Get-FundosMetrics
        $summary.Fundos = "OK (12431: $($fundosDepois.Fundos12431) | CDI: $($fundosDepois.FundosCdi))"
        Ok "Lista de fundos aplicada."
      } else {
        $summary.Fundos = 'nao aplicada por escolha do usuario'
        Warn "Vou seguir com a lista atual."
      }
    }
  } catch {
    $summary.Fundos = "FALHOU sem travar: $($_.Exception.Message)"
    Warn "$($summary.Fundos). Vou seguir com a lista atual."
  }
}

# 2. Captacao sempre
Step "2/7 Captacao"
try {
  & (Join-Path $PSScriptRoot 'preparar-fluxo.ps1') -Incremental
  $summary.Captacao = 'OK'
  Ok "Captacao atualizada."
} catch {
  $summary.Captacao = "FALHOU: $($_.Exception.Message)"
  Fail $summary.Captacao
  throw "Interrompido: Captacao e a atualizacao principal."
}

# 3. Cadastro de debentures sempre
Step "3/7 Cadastro de Debentures"
try {
  & (Join-Path $PSScriptRoot 'preparar-debentures.ps1')
  $summary.Debentures = 'OK'
  Ok "Cadastro de debentures atualizado."
} catch {
  $summary.Debentures = "FALHOU: $($_.Exception.Message)"
  Fail $summary.Debentures
  throw "Interrompido: cadastro de debentures falhou."
}

# 4. BLC se necessario
Step "4/7 BLC / Alocacao"
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

# 5. ANBIMA opcional
Step "5/7 ANBIMA"
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

# 6. Resumo
Step "6/7 Resumo"
$snapshotAfter = Get-DataSnapshot
Write-ImpactReport $snapshotBefore $snapshotAfter

Write-Host ""
Write-Host "Status das etapas:" -ForegroundColor White
foreach ($k in $summary.Keys) {
  if ($k -eq 'Publicacao') { continue }
  Write-Host ("  {0}: {1}" -f $k, $summary[$k])
}

$publishStatus = Get-PublishStatus
Write-Host ""
Write-Host "Arquivos alterados para publicar:"
if ($publishStatus.Count -eq 0) {
  Write-Host "  (nenhuma alteracao em public/ ou tools/Fundos_*.csv)" -ForegroundColor DarkGray
} else {
  $publishStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}

# 7. Publicacao
Step "7/7 Publicacao"
if ($publishStatus.Count -eq 0) {
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
      & git -C $Root add public/ tools/Fundos_12431.csv tools/Fundos_CDI.csv
      if ($LASTEXITCODE -ne 0) { throw "git add falhou" }

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

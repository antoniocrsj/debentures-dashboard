<#
  atualizar-tudo.ps1
  --------------------------------------------------------------------------
  Fluxo de 1 clique para atualizar as bases publicas do app com seguranca:
    1. Atualiza o cadastro de debentures sempre.
    2. Avalia a lista de fundos 12431/CDI e so aplica se confirmado.
    3. Atualiza Captacao (modo controlado por -CaptacaoModo, default Auto).
    4. Atualiza BLC somente se o mes-alvo ainda nao estiver registrado.
    5. Tenta atualizar ANBIMA, mas nao trava tudo se falhar.
    6. Mostra resumo e grava public\Atualizacao_Resumo.json.
    7. Pergunta se deve publicar agora.

  -CaptacaoModo controla o reprocessamento da Captacao (preparar-fluxo.ps1):
    Auto        (default) completo se a lista de fundos mudou nesta rodada,
                 senao incremental (2 meses mais recentes) - comportamento
                 historico deste script.
    Incremental forca incremental mesmo se a lista de fundos mudou.
    Completa    forca reprocessamento completo (ultimos 12 meses) - use de
                 vez em quando para repopular as janelas de 3m/6m/12m da
                 rentabilidade (%CDI), que nao sao mescladas entre rodadas
                 incrementais.
#>

param(
  [switch]$SkipDebentures,
  [switch]$SkipFundos,
  [switch]$SkipCaptacao,
  [switch]$SkipBlc,
  [switch]$ForceBlc,
  [switch]$SkipAnbima,
  [switch]$SkipOfertas,
  [switch]$SkipRelatorios,
  [switch]$NoPublishPrompt,
  [ValidateSet('Auto', 'Incremental', 'Completa')]
  [string]$CaptacaoModo = 'Auto',
  [string]$BlcMesAno = '',                 # AAAAMM explicito; sobrescreve sempre (ignora o "ja registrado")
  [int]$AnbimaMaxSegundos = 180,           # limite de tempo do passo ANBIMA (evita travar tudo)
  # "C:\Projeto Credito\CVM _ofertas" - [char]233 = e-acento (mantem o .ps1 em ASCII)
  [string]$OfertaDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _ofertas")
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$PublicDir = Join-Path $Root 'public'
$BlcMetaPath = Join-Path $PublicDir 'BLC_meta.json'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

$summary = [ordered]@{
  Debentures = 'nao executado'
  Fundos   = 'nao executado'
  Captacao = 'nao executado'
  BLC      = 'nao executado'
  ANBIMA   = 'nao executado'
  Ofertas  = 'nao executado'
  Relatorios = 'nao executado'
  Publicacao = 'nao executada'
}
$fundosAplicados = $false

# Progresso por etapa: conta so' as etapas que VAO rodar (as puladas nao entram
# no total, pra barra do painel ficar honesta). Emite ##PROGRESS n/total titulo##
# (linha lida e escondida pelo painel) + a mesma info no log humano.
$script:StepsAtivos = New-Object System.Collections.Generic.List[string]
if (-not $SkipDebentures) { $script:StepsAtivos.Add('Debentures') }
if (-not $SkipFundos)     { $script:StepsAtivos.Add('Fundos') }
if (-not $SkipCaptacao)   { $script:StepsAtivos.Add('Captacao') }
if (-not $SkipBlc)        { $script:StepsAtivos.Add('BLC') }
if (-not $SkipAnbima)     { $script:StepsAtivos.Add('ANBIMA') }
if (-not $SkipOfertas)    { $script:StepsAtivos.Add('Ofertas') }
if (-not $SkipRelatorios) { $script:StepsAtivos.Add('Relatorios') }
$script:StepsAtivos.Add('Resumo')
$script:StepTotal = $script:StepsAtivos.Count
$script:StepIndex = 0

function Progress([string]$title) {
  $script:StepIndex++
  Write-Host ("##PROGRESS {0}/{1} {2}##" -f $script:StepIndex, $script:StepTotal, $title)
  Step ("[$($script:StepIndex)/$($script:StepTotal)] $title")
}
$novasEmissoes = @()

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
    Fundos        = Get-FundosMetrics $PSScriptRoot
    Captacao12431 = Get-CaptacaoMetrics 'data\Fluxo_Semanal_12431.csv'
    CaptacaoTrad  = Get-CaptacaoMetrics 'data\Fluxo_Semanal_Trad.csv'
    Debentures    = Get-DebenturesMetrics
    BLC           = Get-BlcMetrics
    ANBIMA        = Get-AnbimaMetrics
  }
}

function Test-FundosSame($before, $after) {
  if ($before.Total -ne $after.Total) { return $false }
  $diff = Get-FundosDiff $before $after
  return ($diff.Novos.Count -eq 0 -and $diff.Removidos.Count -eq 0 -and $diff.Alterados.Count -eq 0)
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

# Campos-resumo (antes/depois) por fonte -- so' os numeros mais relevantes pra
# quem ve o app, nao o dump inteiro do snapshot (que carrega listas grandes
# como RowMap/AssetList, uteis so' internamente pro calculo do diff).
function Get-ResumoFonte($before, $after, [string[]]$campos) {
  $out = [ordered]@{}
  foreach ($c in $campos) {
    $out[$c] = [ordered]@{ antes = $before.$c; depois = $after.$c }
  }
  return $out
}

# Escreve public\Atualizacao_Resumo.json -- resumo cross-fonte desta rodada,
# publicado junto com os dados (mesmo git add public/ do passo 7) e lido tanto
# pelo painel de controle local quanto pelo icone novo do header no app
# publicado. Nao inclui o status de Publicacao (so' se sabe DEPOIS deste
# arquivo ja' ter sido gravado/staged) -- esse status fica so' no console.
function Write-ResumoPublicado($before, $after, $summary, [string]$captacaoModo, $novasEmissoes) {
  $resumo = [ordered]@{
    timestamp = (Get-Date).ToString('s')
    captacaoModo = $captacaoModo
    etapas = [ordered]@{
      Debentures = $summary.Debentures
      Fundos     = $summary.Fundos
      Captacao   = $summary.Captacao
      BLC        = $summary.BLC
      ANBIMA     = $summary.ANBIMA
      Ofertas    = $summary.Ofertas
    }
    impacto = [ordered]@{
      fundos = Get-ResumoFonte $before.Fundos $after.Fundos @('Total', 'Gestores', 'SemGestor')
      captacao12431 = Get-ResumoFonte $before.Captacao12431 $after.Captacao12431 @('Semanas', 'Gestores', 'UltimaSemana', 'LiquidoRecente', 'CaptacaoRecente', 'ResgateRecente', 'PLRecente')
      captacaoTrad = Get-ResumoFonte $before.CaptacaoTrad $after.CaptacaoTrad @('Semanas', 'Gestores', 'UltimaSemana', 'LiquidoRecente', 'CaptacaoRecente', 'ResgateRecente', 'PLRecente')
      debentures = Get-ResumoFonte $before.Debentures $after.Debentures @('Ativos', 'Emissores', 'Incentivadas', 'Registradas')
      blc = Get-ResumoFonte $before.BLC $after.BLC @('MesAno', 'Ativos', 'Gestores', 'TotalAlocado')
      anbima = Get-ResumoFonte $before.ANBIMA $after.ANBIMA @('DataRef', 'Tickers', 'ComTaxa')
    }
    # Emissoes de debentures ja registradas na CVM (Resolucao 160) que ainda
    # nao entraram no nosso cadastro (Debentures.com.br tem defasagem).
    novasEmissoes = @($novasEmissoes | ForEach-Object {
      [ordered]@{
        dataRegistro = $_.DataRegistro
        emissor = $_.Emissor
        emissao = $_.Emissao
        valor = $_.Valor
        incentivada = $_.Incentivada
        lider = $_.Lider
      }
    })
  }
  $utf8Resumo = New-Object System.Text.UTF8Encoding($false)
  $path = Join-Path $PublicDir 'Atualizacao_Resumo.json'
  [System.IO.File]::WriteAllText($path, (($resumo | ConvertTo-Json -Depth 8) + "`r`n"), $utf8Resumo)
}

Write-Host ""
Write-Host "=== Atualizacao completa do Debentures CR ===" -ForegroundColor Green
Write-Host "Pasta: $Root"

$snapshotBefore = Get-DataSnapshot

# 1. Cadastro de debentures
if ($SkipDebentures) {
  $summary.Debentures = 'PULADO'
  Warn "Debentures pulado (mantendo cadastro atual)."
} else {
  Progress 'Cadastro de Debentures'
  try {
    & (Join-Path $PSScriptRoot 'preparar-debentures.ps1')
    $summary.Debentures = 'OK'
    Ok "Cadastro de debentures atualizado."
  } catch {
    $summary.Debentures = "FALHOU: $($_.Exception.Message)"
    Fail $summary.Debentures
    throw "Interrompido: cadastro de debentures falhou."
  }
}

# 2. Lista de fundos 12431/CDI: avalia sempre, aplica so com confirmacao.
if ($SkipFundos) {
  $summary.Fundos = 'PULADO por parametro -SkipFundos'
  Warn $summary.Fundos
} else {
  Progress 'Lista de Fundos 12431/CDI'
  try {
    & (Join-Path $PSScriptRoot 'selecionar-fundos.ps1')
    $fundosAtuais = Get-FundosMetrics $PSScriptRoot
    $fundosSugeridos = Get-FundosSuggestionMetrics $PSScriptRoot

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
        Apply-FundosSuggestion $PSScriptRoot
        $fundosDepois = Get-FundosMetrics $PSScriptRoot
        $fundosAplicados = $true
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

# 3. Captacao
if ($SkipCaptacao) {
  $summary.Captacao = 'PULADO'
  Warn "Captacao pulada (mantendo bases atuais)."
} else {
  Progress 'Captacao'
  try {
    $captacaoCompleta = ($CaptacaoModo -eq 'Completa') -or (($CaptacaoModo -eq 'Auto') -and $fundosAplicados)
    if ($captacaoCompleta) {
      if ($CaptacaoModo -eq 'Completa') {
        Ok "Modo Completa solicitado: recalculando ultimos 12 meses (repopula rentabilidade)."
      } else {
        Warn "Lista de fundos mudou; vou recalcular a captacao completa para evitar historico misto."
      }
      & (Join-Path $PSScriptRoot 'preparar-fluxo.ps1')
      $summary.Captacao = 'OK (recalculo completo)'
    } else {
      & (Join-Path $PSScriptRoot 'preparar-fluxo.ps1') -Incremental
      $summary.Captacao = 'OK (incremental)'
    }
    Ok "Captacao atualizada."
  } catch {
    $summary.Captacao = "FALHOU: $($_.Exception.Message)"
    Fail $summary.Captacao
    throw "Interrompido: Captacao e a atualizacao principal."
  }
}

# 4. BLC / Alocacao. Se -BlcMesAno vier, usa esse mes e SOBRESCREVE sempre.
# Senao, mes-alvo automatico (regra de defasagem) e pula se ja registrado.
if ($SkipBlc) {
  $summary.BLC = 'PULADO'
  Warn "BLC pulado (mantendo alocacao atual)."
} else {
  Progress 'BLC / Alocacao'
  $mesExplicito = ($BlcMesAno -match '^\d{6}$')
  $targetMonth = if ($mesExplicito) { $BlcMesAno } else { Get-CdaTargetMonth }
  $meta = Read-BlcMeta
  $blcFile = Join-Path $PublicDir 'BLC_tratado.csv'
  $blcAlreadyCurrent = (
    -not $mesExplicito -and
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
      if ($mesExplicito) { Write-Host "  Mes escolhido: $targetMonth (sobrescreve o atual)" }
      else { Write-Host "  Mes-alvo: $targetMonth" }
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
}

# 5. ANBIMA opcional (com limite de tempo pra nao segurar o resto)
if ($SkipAnbima) {
  $summary.ANBIMA = 'PULADO por parametro -SkipAnbima'
  Warn $summary.ANBIMA
} else {
  Progress 'ANBIMA'
  try {
    & (Join-Path $PSScriptRoot 'preparar-anbima.ps1') -MaxSegundos $AnbimaMaxSegundos
    $summary.ANBIMA = 'OK'
    Ok "ANBIMA atualizada."
  } catch {
    $summary.ANBIMA = "FALHOU sem travar: $($_.Exception.Message)"
    Warn $summary.ANBIMA
  }
}

# 5b. Ofertas CVM: reconciliacao (best-effort, nao trava a atualizacao).
# Compara as ofertas de debentures ja registradas na CVM (Resolucao 160) com
# o nosso cadastro (recem-gerado no passo 1) e lista as que ainda nao entraram.
if ($SkipOfertas) {
  $summary.Ofertas = 'PULADO por parametro -SkipOfertas'
  Warn $summary.Ofertas
} else {
  Progress 'Ofertas CVM (novas emissoes)'
  try {
    $ofertaExtractDir = Get-OfertaDistribDir $OfertaDir
    $ofertaCsv = Join-Path $ofertaExtractDir 'oferta_resolucao_160.csv'
    $debCsv = Join-Path $PublicDir 'Debentures.csv'
    $novasEmissoes = @(Get-OfertasDebNaoCadastradas $ofertaCsv $debCsv 90)
    $summary.Ofertas = "OK ($($novasEmissoes.Count) emissao(oes) registrada(s) na CVM ainda nao no cadastro)"
    Ok $summary.Ofertas
    foreach ($e in $novasEmissoes) {
      Write-Host ("    {0} | {1} | {2}a emissao | {3}" -f $e.DataRegistro, $e.Emissor, $e.Emissao, (Format-Money $e.Valor)) -ForegroundColor Yellow
    }
  } catch {
    $summary.Ofertas = "FALHOU sem travar: $($_.Exception.Message)"
    Warn $summary.Ofertas
  }
}

# 5c. Resumo do Dia (relatorios diarios) - gerador Node, best-effort. Roda por
# ultimo pra ter todas as bases frescas + salvar snapshots do dia.
if ($SkipRelatorios) {
  $summary.Relatorios = 'PULADO por parametro -SkipRelatorios'
  Warn $summary.Relatorios
} else {
  Progress 'Resumo do Dia (relatorios)'
  try {
    & node (Join-Path $PSScriptRoot 'gerar-relatorios.mjs')
    if ($LASTEXITCODE -ne 0) { throw "node saiu com codigo $LASTEXITCODE" }
    $summary.Relatorios = 'OK'
    Ok "Relatorios diarios gerados em public\reports\daily\."
  } catch {
    $summary.Relatorios = "FALHOU sem travar: $($_.Exception.Message)"
    Warn "$($summary.Relatorios) (Node instalado? 'node -v')"
  }
}

# 6. Resumo
Progress 'Resumo'
$snapshotAfter = Get-DataSnapshot
Write-ImpactReport $snapshotBefore $snapshotAfter

Write-Host ""
Write-Host "Status das etapas:" -ForegroundColor White
foreach ($k in $summary.Keys) {
  if ($k -eq 'Publicacao') { continue }
  Write-Host ("  {0}: {1}" -f $k, $summary[$k])
}

Write-ResumoPublicado $snapshotBefore $snapshotAfter $summary $CaptacaoModo $novasEmissoes
Ok "public\Atualizacao_Resumo.json atualizado (sera incluido na publicacao)."

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

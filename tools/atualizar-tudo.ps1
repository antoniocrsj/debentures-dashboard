<#
  atualizar-tudo.ps1
  --------------------------------------------------------------------------
  Fluxo de 1 clique para atualizar as bases publicas do app com seguranca:
    1. Atualiza Captacao sempre (incremental).
    2. Atualiza BLC somente se o mes-alvo ainda nao estiver registrado.
    3. Tenta atualizar ANBIMA, mas nao trava tudo se falhar.
    4. Mostra resumo.
    5. Pergunta se deve publicar agora.

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

Write-Host ""
Write-Host "=== Atualizacao completa do Debentures CR ===" -ForegroundColor Green
Write-Host "Pasta: $Root"

# 1. Captacao sempre
Step "1/5 Captacao"
try {
  & (Join-Path $PSScriptRoot 'preparar-fluxo.ps1') -Incremental
  $summary.Captacao = 'OK'
  Ok "Captacao atualizada."
} catch {
  $summary.Captacao = "FALHOU: $($_.Exception.Message)"
  Fail $summary.Captacao
  throw "Interrompido: Captacao e a atualizacao principal."
}

# 2. BLC se necessario
Step "2/5 BLC / Alocacao"
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

# 3. ANBIMA opcional
Step "3/5 ANBIMA"
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

# 4. Resumo
Step "4/5 Resumo"
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

# 5. Publicacao
Step "5/5 Publicacao"
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


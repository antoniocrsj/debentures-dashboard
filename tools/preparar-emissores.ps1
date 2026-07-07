<#
  preparar-emissores.ps1
  --------------------------------------------------------------------------
  Baixa a planilha Cadastro_Emissores (Google Apps Script) e grava um snapshot
  estatico em public/Emissores.csv. Esse cadastro (CNPJ -> Grupo economico /
  Setor) e a inteligencia proprietaria do usuario: o app ja usa ao vivo, mas o
  gerador do Resumo do Dia e offline e precisa deste snapshot para:
    - preencher a coluna "Grupo" na secao de ANBIMA;
    - detectar emissores novos ainda nao classificados.
  Tambem serve de backup versionado do cadastro no Git.

  Saida: public/Emissores.csv (preserva o anterior se o download falhar).
#>

param(
  [string]$OutPath = '',
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutPath) { $OutPath = Join-Path $Root 'public\Emissores.csv' }

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== Preparar cadastro de Emissores ===" -ForegroundColor Green
Step "Baixando Cadastro_Emissores (Google Sheet)..."

$url = "$CadastroUrl`?sheet=Cadastro_Emissores&nocache=1"
try {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 90 -MaximumRedirection 10
  # Decodifica sempre de bytes crus como UTF-8 (evita mojibake em acentos).
  $csv = $null
  try {
    $ms = $resp.RawContentStream
    if ($ms -and $ms.Length -gt 0) { $csv = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) }
  } catch { $csv = $null }
  if ([string]::IsNullOrEmpty($csv)) { $csv = [string]$resp.Content }

  # Sanidade: precisa parecer CSV (tem virgula e uma coluna de CNPJ), nao HTML de erro.
  if ($csv.TrimStart().StartsWith('<') -or ($csv -notmatch '(?i)cnpj')) {
    throw "resposta nao parece o CSV do cadastro (login/erro do Apps Script?)."
  }
  $linhas = @($csv -split '\r?\n' | Where-Object { $_.Trim() -ne '' })
  if ($linhas.Count -lt 2) { throw "cadastro vazio (so cabecalho)." }

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutPath, (($linhas -join "`r`n") + "`r`n"), $utf8)
  Write-Host ("  OK: {0} emissores gravados em {1}" -f ($linhas.Count - 1), $OutPath) -ForegroundColor Green
} catch {
  if (Test-Path $OutPath) {
    Write-Host "  AVISO: falha ao baixar o cadastro ($($_.Exception.Message)). PRESERVANDO o Emissores.csv anterior." -ForegroundColor Yellow
  } else {
    Write-Host "  AVISO: falha ao baixar o cadastro e sem snapshot anterior ($($_.Exception.Message)). Grupo/faltantes ficarao indisponiveis." -ForegroundColor Yellow
  }
}

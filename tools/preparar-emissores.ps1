<#
  preparar-emissores.ps1
  --------------------------------------------------------------------------
  Grava um snapshot estatico do cadastro de emissores em public/Emissores.csv.
  Esse cadastro (CNPJ -> Grupo economico / Setor) e a inteligencia proprietaria
  do usuario: o app usa ao vivo, mas o gerador do Resumo do Dia e offline e
  precisa deste snapshot para:
    - preencher a coluna "Grupo" na secao de ANBIMA;
    - detectar emissores novos ainda nao classificados.
  Tambem serve de backup versionado do cadastro no Git.

  FONTE (decisao do usuario, "opcao B" de 2026-07-13): a **Ana** e a fonte
  canonica do cadastro -- a curadoria (register_issuer) nasce la, com origin
  marcado. A planilha do Google e' semente historica e fica como FALLBACK, para
  a atualizacao nao quebrar quando a Ana estiver desligada.

  Ordem: 1) export da Ana; 2) planilha do Google; 3) preserva o snapshot anterior.
  A fonte usada e' sempre impressa -- um snapshot vindo do fallback esta' cego
  para os cadastros feitos na Ana, e quem roda precisa saber disso.

  Saida: public/Emissores.csv
#>

param(
  [string]$OutPath = '',
  [string]$AnaUrl = 'http://127.0.0.1:8000/api/v1/registry/export',
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [switch]$SomentePlanilha
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutPath) { $OutPath = Join-Path $Root 'public\Emissores.csv' }

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Aviso($m) { Write-Host "  $m" -ForegroundColor Yellow }

# Le o corpo como UTF-8 a partir dos bytes crus (evita mojibake nos acentos).
function Get-CorpoUtf8($resp) {
  $texto = $null
  try {
    $ms = $resp.RawContentStream
    if ($ms -and $ms.Length -gt 0) { $texto = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) }
  } catch { $texto = $null }
  if ([string]::IsNullOrEmpty($texto)) { $texto = [string]$resp.Content }
  return $texto
}

function ConvertTo-CampoCsv($valor) {
  if ($null -eq $valor) { return '""' }
  return '"' + ([string]$valor -replace '"', '""') + '"'
}

# Nomes de coluna, sem aspas: a Ana aspa todo campo e a planilha nao aspa o
# cabecalho. Comparar o texto cru acusaria mudanca de coluna a cada troca de
# fonte, sendo que as colunas sao as mesmas. Nenhum nome de coluna tem virgula
# ou aspas, entao um split simples basta aqui.
function Get-NomesDeColuna($linhaCabecalho) {
  if (-not $linhaCabecalho) { return @() }
  return @(($linhaCabecalho -replace '"', '') -split ',' | ForEach-Object { $_.Trim() })
}

# --- Fonte 1: export da Ana (fonte canonica) --------------------------------
# Os nomes das colunas saem das proprias chaves do JSON: o export ja' espelha o
# CSV do dashboard, e assim o script fica ASCII puro (literal acentuado em .ps1
# sem BOM vira mojibake no PowerShell 5.1).
function Get-CadastroDaAna {
  $resp = Invoke-WebRequest -Uri $AnaUrl -UseBasicParsing -TimeoutSec 30
  $linhas = Get-CorpoUtf8 $resp | ConvertFrom-Json
  if (-not $linhas -or @($linhas).Count -lt 100) {
    throw "export da Ana com $(@($linhas).Count) registro(s) -- suspeito, ignorando."
  }
  $colunas = @($linhas[0].PSObject.Properties.Name | Where-Object { $_ -ne 'origin' })
  if ($colunas -notcontains 'Grupo') { throw "export da Ana sem a coluna 'Grupo'." }

  $saida = New-Object System.Collections.Generic.List[string]
  $saida.Add((($colunas | ForEach-Object { ConvertTo-CampoCsv $_ }) -join ','))
  foreach ($linha in $linhas) {
    $campos = foreach ($coluna in $colunas) { ConvertTo-CampoCsv $linha.$coluna }
    $saida.Add(($campos -join ','))
  }
  $manuais = @($linhas | Where-Object { $_.origin -eq 'manual' }).Count
  return [pscustomobject]@{
    Linhas  = $saida
    Total   = @($linhas).Count
    Manuais = $manuais
    Fonte   = 'Ana (fonte canonica)'
  }
}

# --- Fonte 2: planilha do Google (fallback/semente) --------------------------
function Get-CadastroDaPlanilha {
  $url = "$CadastroUrl`?sheet=Cadastro_Emissores&nocache=1"
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 90 -MaximumRedirection 10
  $csv = Get-CorpoUtf8 $resp

  # Sanidade: precisa parecer CSV (tem virgula e uma coluna de CNPJ), nao HTML de erro.
  if ($csv.TrimStart().StartsWith('<') -or ($csv -notmatch '(?i)cnpj')) {
    throw "resposta nao parece o CSV do cadastro (login/erro do Apps Script?)."
  }
  $linhas = @($csv -split '\r?\n' | Where-Object { $_.Trim() -ne '' })
  if ($linhas.Count -lt 2) { throw "cadastro vazio (so cabecalho)." }
  return [pscustomobject]@{
    Linhas  = $linhas
    Total   = $linhas.Count - 1
    Manuais = $null
    Fonte   = 'planilha do Google (fallback)'
  }
}

Write-Host ""
Write-Host "=== Preparar cadastro de Emissores ===" -ForegroundColor Green

# Cabecalho anterior: serve para avisar se o contrato de colunas mudou.
$cabecalhoAnterior = $null
if (Test-Path $OutPath) {
  $cabecalhoAnterior = (Get-Content -LiteralPath $OutPath -TotalCount 1 -Encoding UTF8)
}

$cadastro = $null
if ($SomentePlanilha) {
  Step "Modo -SomentePlanilha: pulando a Ana."
} else {
  Step "Buscando o cadastro na Ana ($AnaUrl)..."
  try {
    $cadastro = Get-CadastroDaAna
  } catch {
    Aviso "Ana indisponivel ($($_.Exception.Message))."
    Aviso "Caindo para a planilha do Google -- cadastros feitos na Ana NAO estarao neste snapshot."
  }
}

if (-not $cadastro) {
  Step "Baixando Cadastro_Emissores (Google Sheet)..."
  try {
    $cadastro = Get-CadastroDaPlanilha
  } catch {
    if (Test-Path $OutPath) {
      Aviso "AVISO: falha ao baixar o cadastro ($($_.Exception.Message)). PRESERVANDO o Emissores.csv anterior."
    } else {
      Aviso "AVISO: falha ao baixar o cadastro e sem snapshot anterior ($($_.Exception.Message)). Grupo/faltantes ficarao indisponiveis."
    }
    return
  }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutPath, (($cadastro.Linhas -join "`r`n") + "`r`n"), $utf8)

Write-Host ("  OK: {0} emissores gravados em {1}" -f $cadastro.Total, $OutPath) -ForegroundColor Green
Write-Host ("  Fonte: {0}" -f $cadastro.Fonte) -ForegroundColor Green
if ($null -ne $cadastro.Manuais) {
  Write-Host ("  Curados na Ana (origin=manual): {0}" -f $cadastro.Manuais) -ForegroundColor Green
}

$colunasAntes = Get-NomesDeColuna $cabecalhoAnterior
$colunasAgora = Get-NomesDeColuna $cadastro.Linhas[0]
if ($colunasAntes.Count -gt 0 -and (($colunasAntes -join '|') -ne ($colunasAgora -join '|'))) {
  Aviso "ATENCAO: as colunas mudaram em relacao ao snapshot anterior."
  Aviso ("  antes: {0}" -f ($colunasAntes -join ', '))
  Aviso ("  agora: {0}" -f ($colunasAgora -join ', '))
}

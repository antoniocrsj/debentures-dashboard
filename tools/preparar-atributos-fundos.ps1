<#
  preparar-atributos-fundos.ps1
  --------------------------------------------------------------------------
  Persiste no repositorio os ATRIBUTOS de cadastro (derivados da CVM) das
  classes que estao nas listas curadas (Fundos_12431.csv / Fundos_CDI.csv).
  O app / gerador do Resumo do Dia rodam sem acesso a CVM, entao gravamos aqui
  o que precisamos consultar offline:
    - Forma_Condominio (Aberto / Fechado)  -> marcar fundos fechados;
    - Tipo_Classe, Situacao                -> contexto/saude do fundo;
    - Data_Registro / Data_Inicio          -> datar fundos novos;
    - Patrimonio_Liquido                   -> porte (referencia do cadastro).

  Fonte: registro_fundo_classe.zip da CVM (mesmo arquivo do selecionar-fundos,
  baixado no max 1x/dia por Get-RegistroFundoClasseDir). Escopo: apenas os
  CNPJs das listas curadas (arquivo enxuto, ~2,5k linhas, versionado no Git).

  Saida: public/data/Fundos_Atributos.csv (UTF-8, virgula) - preserva o
  anterior se o cadastro nao estiver disponivel.
#>

param(
  [string]$RegistroDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cadastro_fundos"),
  [string]$Lista12431 = '',
  [string]$ListaCDI = '',
  [string]$OutPath = '',
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

if (-not $Lista12431) { $Lista12431 = Join-Path $PSScriptRoot 'Fundos_12431.csv' }
if (-not $ListaCDI)   { $ListaCDI   = Join-Path $PSScriptRoot 'Fundos_CDI.csv' }
if (-not $OutPath)    { $OutPath    = Join-Path $Root 'public\data\Fundos_Atributos.csv' }

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

# Le' uma lista curada (CNPJ_FUNDO_CLASSE na 1a coluna) -> conjunto de CNPJs norm.
function Read-ListaCurada([string]$path) {
  $set = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path $path)) { return $set }
  $lines = [System.IO.File]::ReadAllLines($path, (New-Object System.Text.UTF8Encoding($false)))
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]; if ($l.Trim() -eq '') { continue }
    # 1a coluna (pode vir entre aspas); pega ate' a primeira virgula.
    $first = ($l -split ',')[0].Trim().Trim('"')
    $cnpj = NormCNPJ $first
    if ($cnpj -ne '') { [void]$set.Add($cnpj) }
  }
  return $set
}

# Aspas em campo CSV so' quando necessario (virgula/aspas/quebra).
function CsvField($v) {
  $s = [string]$v
  if ($s -match '[",\r\n]') { return '"' + ($s -replace '"', '""') + '"' }
  return $s
}

Write-Host ""
Write-Host "=== Preparar atributos de fundos (Fundos_Atributos.csv) ===" -ForegroundColor Green

try {
  Step "Lendo listas curadas..."
  $set12431 = Read-ListaCurada $Lista12431
  $setCDI = Read-ListaCurada $ListaCDI
  # Um CNPJ -> rotulo da lista (12431 tem precedencia se por acaso estiver nas duas).
  $listaPorCnpj = [ordered]@{}
  foreach ($c in $setCDI)   { $listaPorCnpj[$c] = 'Trad' }
  foreach ($c in $set12431) { $listaPorCnpj[$c] = '12431' }
  Step "  $($set12431.Count) em 12431 | $($setCDI.Count) em Trad | $($listaPorCnpj.Count) distintos"

  Step "Baixando/lendo cadastro de classes da CVM (registro_fundo_classe.zip)..."
  $extractDir = Get-RegistroFundoClasseDir $RegistroDir -NoDownload:$NoDownload
  $atrib = Read-RegistroClasseAtributos (Join-Path $extractDir 'registro_classe.csv')
  Step "  $($atrib.Count) classes no cadastro CVM"

  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CNPJ_FUNDO_CLASSE,Lista,Forma_Condominio,Tipo_Classe,Situacao,Data_Registro,Data_Inicio,Patrimonio_Liquido')
  $achados = 0; $semCadastro = 0
  foreach ($cnpj in $listaPorCnpj.Keys) {
    $lista = $listaPorCnpj[$cnpj]
    if ($atrib.ContainsKey($cnpj)) {
      $a = $atrib[$cnpj]
      $pl = ([double]$a.PL).ToString('0.##', $ci)
      $cols = @($cnpj, $lista, $a.Forma, $a.Tipo, $a.Situacao, $a.DataRegistro, $a.DataInicio, $pl)
      $achados++
    } else {
      # Mantem a linha (com atributos vazios) para nao perder o fundo da lista.
      $cols = @($cnpj, $lista, '', '', '', '', '', '')
      $semCadastro++
    }
    [void]$sb.AppendLine((($cols | ForEach-Object { CsvField $_ }) -join ','))
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $OutPath -Parent) | Out-Null
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutPath, $sb.ToString(), $utf8)
  $fechados = 0
  foreach ($cnpj in $listaPorCnpj.Keys) {
    if ($atrib.ContainsKey($cnpj) -and $atrib[$cnpj].Forma -match '(?i)fechad') { $fechados++ }
  }
  Write-Host ("  OK: {0} fundos gravados em {1} ({2} com atributo, {3} sem cadastro, {4} fechados)" -f $listaPorCnpj.Count, $OutPath, $achados, $semCadastro, $fechados) -ForegroundColor Green
} catch {
  if (Test-Path $OutPath) {
    Write-Host "  AVISO: falha ao gerar atributos ($($_.Exception.Message)). PRESERVANDO Fundos_Atributos.csv anterior." -ForegroundColor Yellow
  } else {
    Write-Host "  AVISO: falha ao gerar atributos e sem snapshot anterior ($($_.Exception.Message))." -ForegroundColor Yellow
  }
}

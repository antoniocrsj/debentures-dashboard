<#
  lib-cadastro.ps1
  --------------------------------------------------------------------------
  Biblioteca compartilhada por preparar-fluxo.ps1 e preparar-blc.ps1.

  Resolve o mapa CNPJ_FUNDO -> Apelido_Gestor a partir de 3 fontes:
    1. GAS (Google Apps Script) — abas manuais da planilha Cadastro_Credito:
         Fundos_12431 / Fundos_CDI   (CNPJ_FUNDO_CLASSE, DENOM_SOCIAL)
         Cadastro_Gestores          (CNPJ Gestor, Nome Gestor, Apelido Gestor)
    2. CVM cad_fi.csv (ponte publica CNPJ_FUNDO -> CNPJ_GESTOR)
         https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv

  Uso: dot-source no inicio do script -> . (Join-Path $PSScriptRoot 'lib-cadastro.ps1')
#>

function NormCNPJ($s) { return ($s -replace '\D', '') }

# Faz GET numa URL do GAS e retorna o corpo (string). Lanca erro se vier HTML.
function Get-GasBody([string]$url) {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 90
  $body = $resp.Content
  if ($body.TrimStart().StartsWith('<')) {
    throw "GAS retornou HTML em vez de CSV para: $url (tente rodar de novo ou verifique a publicacao do Apps Script)"
  }
  return $body
}

# Parser do CSV produzido pelo GAS: cada celula sempre entre aspas, "" escapa aspas interna.
# Formato fixo (gerado pelo doGet): '"' + valor.replace(/"/g,'""') + '"' juntado por ','.
function ConvertFrom-GasCsv([string]$body) {
  $lines = $body -split '\r?\n' | Where-Object { $_.Trim() -ne '' }
  if ($lines.Count -lt 1) { return @{ headers = @(); rows = @() } }

  function Split-GasLine([string]$line) {
    $t = $line.Trim()
    if ($t.StartsWith('"') -and $t.EndsWith('"')) {
      $inner = $t.Substring(1, $t.Length - 2)
      return ($inner -split '","') | ForEach-Object { $_ -replace '""', '"' }
    }
    # Fallback (linha nao veio entre aspas): split simples por virgula.
    return $t -split ','
  }

  $headers = Split-GasLine $lines[0]
  $rows = New-Object System.Collections.Generic.List[object]
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $cols = Split-GasLine $lines[$i]
    $row = @{}
    for ($c = 0; $c -lt $headers.Count -and $c -lt $cols.Count; $c++) { $row[$headers[$c]] = $cols[$c] }
    $rows.Add($row)
  }
  return @{ headers = $headers; rows = $rows }
}

# Acha o indice de uma coluna no array de headers, por regex (case-insensitive).
function Find-ColIndex($headers, [string]$mustMatch, [string]$mustNotMatch = $null) {
  for ($i = 0; $i -lt $headers.Count; $i++) {
    if ($headers[$i] -match $mustMatch) {
      if ($mustNotMatch -and $headers[$i] -match $mustNotMatch) { continue }
      return $i
    }
  }
  return -1
}

# Busca uma aba de fundos (Fundos_12431 / Fundos_CDI) e retorna o Set de CNPJ_FUNDO_CLASSE normalizados.
function Get-FundosCnpjSet([string]$cadastroUrl, [string]$sheetName) {
  $body = Get-GasBody "$cadastroUrl?sheet=$sheetName"
  $parsed = ConvertFrom-GasCsv $body
  $iCnpj = Find-ColIndex $parsed.headers '(?i)cnpj'
  if ($iCnpj -lt 0) { throw "Aba '$sheetName': nao achei coluna de CNPJ. Cabecalho: $($parsed.headers -join ', ')" }
  $col = $parsed.headers[$iCnpj]

  $set = New-Object System.Collections.Generic.HashSet[string]
  foreach ($row in $parsed.rows) {
    $cnpj = NormCNPJ ([string]$row[$col])
    if ($cnpj -ne '') { [void]$set.Add($cnpj) }
  }
  return $set
}

# Busca a aba Cadastro_Gestores e retorna hashtable: CNPJ_GESTOR(norm) -> Apelido Gestor.
function Get-GestorApelidoMap([string]$cadastroUrl, [string]$sheetName = 'Cadastro_Gestores') {
  $body = Get-GasBody "$cadastroUrl?sheet=$sheetName"
  $parsed = ConvertFrom-GasCsv $body
  $iCnpj = Find-ColIndex $parsed.headers '(?i)cnpj'
  $iApl  = Find-ColIndex $parsed.headers '(?i)apelido'
  if ($iCnpj -lt 0 -or $iApl -lt 0) { throw "Aba '$sheetName': preciso de coluna CNPJ Gestor e Apelido Gestor. Cabecalho: $($parsed.headers -join ', ')" }
  $colCnpj = $parsed.headers[$iCnpj]; $colApl = $parsed.headers[$iApl]

  $map = @{}
  foreach ($row in $parsed.rows) {
    $cnpj = NormCNPJ ([string]$row[$colCnpj])
    $apl  = ([string]$row[$colApl]).Trim()
    if ($cnpj -ne '' -and $apl -ne '') { $map[$cnpj] = $apl }
  }
  return $map
}

# Baixa/cacheia o cad_fi.csv da CVM e retorna hashtable: CNPJ_FUNDO(norm) -> CNPJ_GESTOR(norm).
# Re-baixa no maximo 1x por dia (arquivo e grande, ~70-90 mil linhas).
function Get-CadFiFundoGestorMap([string]$cvmCadDir, [switch]$NoDownload) {
  New-Item -ItemType Directory -Force -Path $cvmCadDir | Out-Null
  $path = Join-Path $cvmCadDir 'cad_fi.csv'
  $url = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv'

  $precisaBaixar = $true
  if (Test-Path $path) {
    $precisaBaixar = (Get-Item $path).LastWriteTime.Date -ne (Get-Date).Date
  }
  if ($precisaBaixar -and -not $NoDownload) {
    $tmp = "$path.tmp"
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 300 -UseBasicParsing
      Move-Item $tmp $path -Force
    } catch {
      Write-Host "    AVISO: nao consegui baixar cad_fi.csv ($($_.Exception.Message))." -ForegroundColor Yellow
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
      if (-not (Test-Path $path)) { throw "cad_fi.csv indisponivel e sem cache local em $path" }
    }
  }

  $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::GetEncoding('latin1'))
  if ($lines.Count -lt 2) { throw "cad_fi.csv vazio ou invalido em $path" }
  $sep = if ($lines[0] -match ';') { ';' } else { ',' }
  $hdr = $lines[0].Split($sep) | ForEach-Object { $_.Trim().Trim('"') }

  $iFundo  = Find-ColIndex $hdr '(?i)cnpj.*(fundo|classe)' '(?i)gestor'
  if ($iFundo -lt 0) { $iFundo = Find-ColIndex $hdr '(?i)cnpj' '(?i)gestor' }
  $iGestor = Find-ColIndex $hdr '(?i)cnpj.*gestor'
  if ($iGestor -lt 0) { $iGestor = Find-ColIndex $hdr '(?i)gestor.*cnpj' }
  if ($iFundo -lt 0 -or $iGestor -lt 0) { throw "cad_fi.csv: nao achei colunas de CNPJ_FUNDO e CNPJ_GESTOR. Cabecalho: $($hdr -join ', ')" }

  $map = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]; if ($line.Trim() -eq '') { continue }
    $cols = $line.Split($sep)
    if ($cols.Count -le [Math]::Max($iFundo, $iGestor)) { continue }
    $cnpjFundo  = NormCNPJ ($cols[$iFundo].Trim().Trim('"'))
    $cnpjGestor = NormCNPJ ($cols[$iGestor].Trim().Trim('"'))
    if ($cnpjFundo -ne '' -and $cnpjGestor -ne '') { $map[$cnpjFundo] = $cnpjGestor }
  }
  return $map
}

# Combina os 3 mapas: para cada CNPJ_FUNDO do set, acha o gestor via cad_fi.csv e o apelido via Cadastro_Gestores.
# Retorna @{ map = (fundoCnpj -> apelido); semCadFi = N; semGestorCadastrado = N }
function Build-FundoApelidoMap($fundoCnpjSet, $cadFiMap, $gestorApelidoMap) {
  $map = @{}
  $semCadFi = 0
  $semGestorCadastrado = 0
  foreach ($cnpjFundo in $fundoCnpjSet) {
    if (-not $cadFiMap.ContainsKey($cnpjFundo)) { $semCadFi++; continue }
    $cnpjGestor = $cadFiMap[$cnpjFundo]
    if (-not $gestorApelidoMap.ContainsKey($cnpjGestor)) { $semGestorCadastrado++; continue }
    $map[$cnpjFundo] = $gestorApelidoMap[$cnpjGestor]
  }
  return @{ map = $map; semCadFi = $semCadFi; semGestorCadastrado = $semGestorCadastrado }
}

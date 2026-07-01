<#
  lib-cadastro.ps1
  --------------------------------------------------------------------------
  Biblioteca compartilhada por preparar-fluxo.ps1 e preparar-blc.ps1.

  Resolve o mapa CNPJ_FUNDO_CLASSE -> Apelido_Gestor a partir das abas manuais
  da planilha Cadastro_Credito (servidas como CSV pelo Google Apps Script):
    - Fundos_12431 / Fundos_CDI  (CNPJ_FUNDO_CLASSE, DENOM_SOCIAL, CNPJ Gestor)
    - Cadastro_Gestores          (CNPJ Gestor, Nome Gestor, Apelido Gestor)

  O cruzamento e' inteiramente planilha->planilha (a CVM nao publica uma tabela
  unica ligando CNPJ da classe ao CNPJ do gestor):
    fundo -> CNPJ Gestor (aba Fundos_*) -> Apelido (aba Cadastro_Gestores)

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

# Busca uma aba de fundos (Fundos_12431 / Fundos_CDI) e retorna hashtable:
#   CNPJ_FUNDO_CLASSE(norm) -> CNPJ_GESTOR(norm)
function Get-FundosGestorMap([string]$cadastroUrl, [string]$sheetName) {
  $body = Get-GasBody "${cadastroUrl}?sheet=$sheetName"
  $parsed = ConvertFrom-GasCsv $body

  # Coluna do CNPJ do fundo: cita fundo/classe (e nao gestor); senao o 1o cnpj que nao e' gestor.
  $iFundo = Find-ColIndex $parsed.headers '(?i)cnpj.*(fundo|classe)' '(?i)gestor'
  if ($iFundo -lt 0) { $iFundo = Find-ColIndex $parsed.headers '(?i)cnpj' '(?i)gestor' }
  # Coluna do CNPJ do gestor: cita cnpj e gestor.
  $iGestor = Find-ColIndex $parsed.headers '(?i)cnpj.*gestor'
  if ($iGestor -lt 0) { $iGestor = Find-ColIndex $parsed.headers '(?i)gestor.*cnpj' }
  if ($iFundo -lt 0 -or $iGestor -lt 0) {
    throw "Aba '$sheetName': preciso de coluna CNPJ do fundo (CNPJ_FUNDO_CLASSE) e coluna CNPJ Gestor. Cabecalho: $($parsed.headers -join ', ')"
  }
  $colFundo = $parsed.headers[$iFundo]; $colGestor = $parsed.headers[$iGestor]

  $map = @{}
  foreach ($row in $parsed.rows) {
    $cf = NormCNPJ ([string]$row[$colFundo])
    $cg = NormCNPJ ([string]$row[$colGestor])
    if ($cf -ne '' -and $cg -ne '') { $map[$cf] = $cg }
  }
  return @{ map = $map; colFundo = $colFundo; colGestor = $colGestor }
}

# Busca a aba Cadastro_Gestores e retorna hashtable: CNPJ_GESTOR(norm) -> Apelido Gestor.
function Get-GestorApelidoMap([string]$cadastroUrl, [string]$sheetName = 'Cadastro_Gestores') {
  $body = Get-GasBody "${cadastroUrl}?sheet=$sheetName"
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

# Combina os mapas: para cada CNPJ_FUNDO -> CNPJ_GESTOR (aba Fundos_*), resolve o Apelido
# via Cadastro_Gestores. Retorna @{ map = (fundoCnpj -> apelido); semGestorCadastrado = N }
function Build-FundoApelidoMap($fundoGestorMap, $gestorApelidoMap) {
  $map = @{}
  $semGestorCadastrado = 0
  $gestoresFaltando = @{}
  foreach ($cnpjFundo in $fundoGestorMap.Keys) {
    $cnpjGestor = $fundoGestorMap[$cnpjFundo]
    if (-not $gestorApelidoMap.ContainsKey($cnpjGestor)) {
      $semGestorCadastrado++
      $gestoresFaltando[$cnpjGestor] = $true
      continue
    }
    $map[$cnpjFundo] = $gestorApelidoMap[$cnpjGestor]
  }
  return @{ map = $map; semGestorCadastrado = $semGestorCadastrado; gestoresFaltando = $gestoresFaltando.Keys }
}

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
  # nocache=1: scripts rodam raramente (semanal/mensal) e precisam sempre do dado
  # mais recente da planilha, sem esperar o cache de 6h do Apps Script expirar.
  $body = Get-GasBody "${cadastroUrl}?sheet=$sheetName&nocache=1"
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

# Busca uma aba de fundos no GAS e retorna as linhas CRUAS (Cnpj, Denom,
# CnpjGestor) sem descartar nada -- usado so' por
# sincronizar-fundos-planilha.ps1 pra exportar pro CSV local (Fundos_12431/
# Fundos_CDI passaram a viver como arquivo local, nao mais na planilha).
function Get-FundosRawFromGas([string]$cadastroUrl, [string]$sheetName) {
  $body = Get-GasBody "${cadastroUrl}?sheet=$sheetName&nocache=1"
  $parsed = ConvertFrom-GasCsv $body

  $iFundo = Find-ColIndex $parsed.headers '(?i)cnpj.*(fundo|classe)' '(?i)gestor'
  if ($iFundo -lt 0) { $iFundo = Find-ColIndex $parsed.headers '(?i)cnpj' '(?i)gestor' }
  $iGestor = Find-ColIndex $parsed.headers '(?i)cnpj.*gestor'
  if ($iGestor -lt 0) { $iGestor = Find-ColIndex $parsed.headers '(?i)gestor.*cnpj' }
  $iDenom = Find-ColIndex $parsed.headers '(?i)denom'
  if ($iFundo -lt 0 -or $iGestor -lt 0) {
    throw "Aba '$sheetName': preciso de coluna CNPJ do fundo e coluna CNPJ Gestor. Cabecalho: $($parsed.headers -join ', ')"
  }
  $colFundo = $parsed.headers[$iFundo]; $colGestor = $parsed.headers[$iGestor]
  $colDenom = if ($iDenom -ge 0) { $parsed.headers[$iDenom] } else { $null }

  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($row in $parsed.rows) {
    $cf = NormCNPJ ([string]$row[$colFundo])
    if ($cf -eq '') { continue }
    $denom = if ($colDenom) { ([string]$row[$colDenom]).Trim() } else { '' }
    $cg = NormCNPJ ([string]$row[$colGestor])
    $rows.Add([pscustomobject]@{ Cnpj = $cf; Denom = $denom; CnpjGestor = $cg })
  }
  return $rows
}

# Parser generico de uma linha CSV (campo opcionalmente entre aspas, ""
# escapa aspas interna). Ao contrario de ConvertFrom-GasCsv (que assume TODO
# campo sempre entre aspas), aqui cada campo pode ou nao estar entre aspas --
# necessario pra ler tanto Fundos_12431.csv (sem aspas, gerado por script)
# quanto Sugestao_Lista_Final_*.csv (sempre com aspas).
function Split-CsvLine([string]$line) {
  $fields = New-Object System.Collections.Generic.List[string]
  $i = 0; $n = $line.Length
  while ($i -le $n) {
    if ($i -lt $n -and $line[$i] -eq '"') {
      $i++
      $sb = New-Object System.Text.StringBuilder
      while ($i -lt $n) {
        if ($line[$i] -eq '"') {
          if ($i + 1 -lt $n -and $line[$i + 1] -eq '"') { [void]$sb.Append('"'); $i += 2 }
          else { $i++; break }
        } else { [void]$sb.Append($line[$i]); $i++ }
      }
      $fields.Add($sb.ToString())
      if ($i -lt $n -and $line[$i] -eq ',') { $i++ } else { $i++ }
    } else {
      $start = $i
      while ($i -lt $n -and $line[$i] -ne ',') { $i++ }
      $fields.Add($line.Substring($start, $i - $start))
      $i++
    }
  }
  return $fields.ToArray()
}

# Le' um Fundos_12431.csv / Fundos_CDI.csv LOCAL (CNPJ_FUNDO_CLASSE,
# DENOM_SOCIAL, CNPJ Gestor) e retorna a mesma forma de Get-FundosGestorMap:
# @{ map = (CNPJ_FUNDO_CLASSE(norm) -> CNPJ_GESTOR(norm)); colFundo; colGestor }
function Read-FundosGestorCsv([string]$path) {
  if (-not (Test-Path $path)) { throw "Arquivo nao encontrado: $path" }
  $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' }
  if ($lines.Count -lt 1) { return @{ map = @{}; colFundo = ''; colGestor = '' } }

  $hdr = Split-CsvLine $lines[0]
  $iFundo = Find-ColIndex $hdr '(?i)cnpj.*(fundo|classe)' '(?i)gestor'
  if ($iFundo -lt 0) { $iFundo = Find-ColIndex $hdr '(?i)cnpj' '(?i)gestor' }
  $iGestor = Find-ColIndex $hdr '(?i)cnpj.*gestor'
  if ($iGestor -lt 0) { $iGestor = Find-ColIndex $hdr '(?i)gestor.*cnpj' }
  if ($iFundo -lt 0 -or $iGestor -lt 0) {
    throw "$path`: preciso de coluna CNPJ do fundo (CNPJ_FUNDO_CLASSE) e coluna CNPJ Gestor. Cabecalho: $($hdr -join ', ')"
  }

  $map = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $cols = Split-CsvLine $lines[$i]
    if ($cols.Count -le [Math]::Max($iFundo, $iGestor)) { continue }
    $cf = NormCNPJ $cols[$iFundo]
    $cg = NormCNPJ $cols[$iGestor]
    if ($cf -ne '' -and $cg -ne '') { $map[$cf] = $cg }
  }
  return @{ map = $map; colFundo = $hdr[$iFundo]; colGestor = $hdr[$iGestor] }
}

# Busca a aba Cadastro_Gestores e retorna hashtable: CNPJ_GESTOR(norm) -> Apelido Gestor.
function Get-GestorApelidoMap([string]$cadastroUrl, [string]$sheetName = 'Cadastro_Gestores') {
  $body = Get-GasBody "${cadastroUrl}?sheet=$sheetName&nocache=1"
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

# ─── Leitura do CDA_FI_BLC.xlsx (CVM) ──────────────────────────────────────
# Usado por preparar-blc.ps1 e selecionar-fundos.ps1.

# Acha o cda_fi_BLC*.xlsx mais recente numa pasta. Retorna $null se nao achar.
function Find-LatestCdaFiBlc([string]$folder) {
  $cand = Get-ChildItem -Path $folder -Filter 'cda_fi_BLC*.xlsx' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $cand) { return $null }
  return $cand.FullName
}

# Letra(s) da coluna de uma referencia de celula (ex: "AB12" -> 28).
function ColNum([string]$ref) {
  $letters = ($ref -replace '\d', '')
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n
}

# Le' o CDA_FI_BLC.xlsx (sem precisar do Excel, mesmo travado por ele aberto) e
# retorna as linhas BRUTAS de debentures: lista de @{ Ativo; Cnpj; Val }.
function Read-CdaFiBlcDebentures([string]$xlsxPath) {
  $rawRows = New-Object System.Collections.Generic.List[object]
  Add-Type -AssemblyName System.IO.Compression | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
  $fs  = [System.IO.File]::Open($xlsxPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read)
  try {
    $ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
    $shared = New-Object System.Collections.Generic.List[string]
    if ($ssEntry) {
      $rd = New-Object System.IO.StreamReader($ssEntry.Open())
      $ssXml = $rd.ReadToEnd(); $rd.Close()
      foreach ($m in [regex]::Matches($ssXml, '<si>(.*?)</si>', 'Singleline')) {
        $inner = $m.Groups[1].Value
        $txt = -join ([regex]::Matches($inner, '<t[^>]*>(.*?)</t>', 'Singleline') | ForEach-Object { $_.Groups[1].Value })
        $shared.Add([System.Net.WebUtility]::HtmlDecode($txt))
      }
    }

    $shEntry = $zip.Entries | Where-Object { $_.FullName -like 'xl/worksheets/sheet1.xml' }
    if (-not $shEntry) { $shEntry = $zip.Entries | Where-Object { $_.FullName -like 'xl/worksheets/*.xml' } | Select-Object -First 1 }
    $stream = $shEntry.Open()
    $xr = [System.Xml.XmlReader]::Create($stream)

    $headers = @{}
    $colCNPJ = 0; $colApl = 0; $colVal = 0; $colAtivo = 0
    $headerDone = $false
    $rowIdx = 0
    $cellVals = @{}
    $curCol = 0; $curType = $null

    while ($xr.Read()) {
      switch ($xr.NodeType) {
        'Element' {
          if ($xr.Name -eq 'row') {
            $rowIdx = [int]$xr.GetAttribute('r')
            $cellVals.Clear()
          }
          elseif ($xr.Name -eq 'c') {
            $curCol  = ColNum $xr.GetAttribute('r')
            $curType = $xr.GetAttribute('t')
          }
          elseif ($xr.Name -eq 'v') {
            $v = $xr.ReadElementContentAsString()
            if ($curType -eq 's') { $cellVals[$curCol] = $shared[[int]$v] }
            else                  { $cellVals[$curCol] = $v }
          }
          elseif ($xr.Name -eq 't' -and $curType -eq 'inlineStr') {
            $cellVals[$curCol] = $xr.ReadElementContentAsString()
          }
        }
        'EndElement' {
          if ($xr.Name -eq 'row') {
            if ($rowIdx -eq 1) {
              foreach ($k in $cellVals.Keys) { $headers[$k] = ([string]$cellVals[$k]).Trim() }
              foreach ($k in $headers.Keys) {
                switch ($headers[$k]) {
                  'CNPJ_FUNDO_CLASSE'  { $colCNPJ  = $k }
                  'TP_APLIC'           { $colApl   = $k }
                  'VL_MERC_POS_FINAL'  { $colVal   = $k }
                  'CD_ATIVO'           { $colAtivo = $k }
                }
              }
              if ($colCNPJ -eq 0 -or $colVal -eq 0 -or $colAtivo -eq 0) {
                throw "Colunas obrigatorias nao encontradas (CNPJ_FUNDO_CLASSE / VL_MERC_POS_FINAL / CD_ATIVO). Cabecalhos: $($headers.Values -join ', ')"
              }
              $headerDone = $true
            }
            elseif ($headerDone) {
              $ativo = if ($cellVals.ContainsKey($colAtivo)) { ([string]$cellVals[$colAtivo]).Trim() } else { '' }
              $cnpj  = if ($cellVals.ContainsKey($colCNPJ))  { ([string]$cellVals[$colCNPJ]).Trim() }  else { '' }
              $aplOk = $true
              if ($colApl -ne 0) {
                $apl = if ($cellVals.ContainsKey($colApl)) { [string]$cellVals[$colApl] } else { '' }
                $aplOk = ($apl -like 'Deb*')
              }
              if ($aplOk -and $ativo -ne '' -and $cnpj -ne '') {
                $val = 0.0
                if ($cellVals.ContainsKey($colVal)) {
                  [double]::TryParse([string]$cellVals[$colVal], [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$val) | Out-Null
                }
                $rawRows.Add([pscustomobject]@{ Ativo = $ativo; Cnpj = (NormCNPJ $cnpj); Val = $val })
              }
            }
          }
        }
      }
    }
    $xr.Close(); $stream.Close()
  }
  finally {
    $zip.Dispose(); $fs.Dispose()
  }
  return $rawRows
}

# ─── Cadastro de classes/fundos da CVM (registro_fundo_classe.zip) ────────
# Universo completo de classes ativas + PL + gestor (via ID_Registro_Fundo).
# Usado por selecionar-fundos.ps1. Diferente do cad_fi.csv (legado, nivel
# fundo): estes arquivos sao pos-Resolucao CVM 175, no nivel de CLASSE - a
# mesma granularidade do CNPJ_FUNDO_CLASSE usado no Informe Diario/CDA.

# Baixa/cacheia o registro_fundo_classe.zip e extrai. Re-baixa no max 1x/dia.
function Get-RegistroFundoClasseDir([string]$registroDir, [switch]$NoDownload) {
  New-Item -ItemType Directory -Force -Path $registroDir | Out-Null
  $zipPath = Join-Path $registroDir 'registro_fundo_classe.zip'
  $url = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip'

  $precisaBaixar = $true
  if (Test-Path $zipPath) { $precisaBaixar = (Get-Item $zipPath).LastWriteTime.Date -ne (Get-Date).Date }
  if ($precisaBaixar -and -not $NoDownload) {
    $tmp = "$zipPath.tmp"
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 300 -UseBasicParsing
      Move-Item $tmp $zipPath -Force
    } catch {
      Write-Host "    AVISO: nao consegui baixar registro_fundo_classe.zip ($($_.Exception.Message))." -ForegroundColor Yellow
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
      if (-not (Test-Path $zipPath)) { throw "registro_fundo_classe.zip indisponivel e sem cache local em $zipPath" }
    }
  }

  $extractDir = Join-Path $registroDir 'registro_extraido'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)
  return $extractDir
}

# Le' um CSV de registro (';' separado, latin-1) e retorna @{ lines; idx }  - 
# idx mapeia nome de coluna -> indice, pra acesso por nome nas linhas cruas.
function Read-RegistroCsv([string]$path) {
  $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::GetEncoding('latin1'))
  $hdr = $lines[0].Split(';')
  $idx = @{}
  for ($i = 0; $i -lt $hdr.Count; $i++) { $idx[$hdr[$i].Trim()] = $i }
  return @{ lines = $lines; idx = $idx }
}

# Le' registro_classe.csv (classes ATIVAS apenas) e retorna hashtable:
#   CNPJ_Classe(norm) -> @{ Denom; PL; IdFundo }
function Read-RegistroClasse([string]$path) {
  $rc = Read-RegistroCsv $path
  $iCnpj = $rc.idx['CNPJ_Classe']; $iId = $rc.idx['ID_Registro_Fundo']
  $iDenom = $rc.idx['Denominacao_Social']; $iSit = $rc.idx['Situacao']; $iPL = $rc.idx['Patrimonio_Liquido']
  if ($null -eq $iCnpj -or $null -eq $iId -or $null -eq $iDenom -or $null -eq $iSit -or $null -eq $iPL) {
    throw "registro_classe.csv: colunas esperadas nao encontradas (CNPJ_Classe/ID_Registro_Fundo/Denominacao_Social/Situacao/Patrimonio_Liquido)."
  }
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $map = @{}
  for ($i = 1; $i -lt $rc.lines.Count; $i++) {
    $l = $rc.lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iPL) { continue }
    if ($c[$iSit].Trim() -ne 'Em Funcionamento Normal') { continue }
    $cnpj = NormCNPJ $c[$iCnpj]
    if ($cnpj -eq '') { continue }
    $pl = 0.0
    [double]::TryParse($c[$iPL], [System.Globalization.NumberStyles]::Any, $ci, [ref]$pl) | Out-Null
    $map[$cnpj] = @{ Denom = $c[$iDenom].Trim(); PL = $pl; IdFundo = $c[$iId].Trim() }
  }
  return $map
}

# Le' registro_fundo.csv e retorna hashtable: ID_Registro_Fundo -> CNPJ_Gestor(norm).
function Read-RegistroFundoGestor([string]$path) {
  $rf = Read-RegistroCsv $path
  $iId = $rf.idx['ID_Registro_Fundo']; $iGestor = $rf.idx['CPF_CNPJ_Gestor']
  if ($null -eq $iId -or $null -eq $iGestor) {
    throw "registro_fundo.csv: colunas esperadas nao encontradas (ID_Registro_Fundo/CPF_CNPJ_Gestor)."
  }
  $map = @{}
  for ($i = 1; $i -lt $rf.lines.Count; $i++) {
    $l = $rf.lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iGestor) { continue }
    $g = NormCNPJ $c[$iGestor]
    if ($g -ne '') { $map[$c[$iId].Trim()] = $g }
  }
  return $map
}

# --- CDA da CVM (cda_fi_AAAAMM.zip) - fonte primaria de selecionar-fundos.ps1 ---
# Diferente do CDA_FI_BLC.xlsx (que o usuario baixa e as vezes ajusta manualmente
# em outra pasta), este e' o CSV CRU publicado pela CVM, baixado e cacheado
# automaticamente. Mesmas colunas do xlsx (CNPJ_FUNDO_CLASSE/TP_APLIC/CD_ATIVO/
# VL_MERC_POS_FINAL), mas ';'-separado / latin-1, igual aos outros arquivos CVM.

# Calcula o mes-alvo (AAAAMM) do CDA a usar, respeitando a defasagem de
# publicacao: a CVM aceita retificacao do CDA dos ultimos meses, entao so'
# confiamos num mes que ja fechou essa janela. Regra do usuario: ate' o dia 15
# do mes corrente, usa mes atual -5; depois do dia 15, usa mes atual -4.
function Get-CdaTargetMonth {
  $hoje = Get-Date
  $lag = if ($hoje.Day -le 15) { 5 } else { 4 }
  return $hoje.AddMonths(-$lag).ToString('yyyyMM')
}

# Baixa/cacheia e extrai o cda_fi_{mesAno}.zip da CVM. Um mes especifico e'
# imutavel uma vez publicado e fora da janela de retificacao (ver
# Get-CdaTargetMonth), entao o cache nao expira - so' baixa se ainda nao tiver.
function Get-CdaFiDir([string]$cdaDir, [string]$mesAno, [switch]$NoDownload) {
  New-Item -ItemType Directory -Force -Path $cdaDir | Out-Null
  $zipPath = Join-Path $cdaDir "cda_fi_$mesAno.zip"
  $url = "https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/cda_fi_$mesAno.zip"

  if (-not (Test-Path $zipPath) -and -not $NoDownload) {
    $tmp = "$zipPath.tmp"
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 300 -UseBasicParsing
      Move-Item $tmp $zipPath -Force
    } catch {
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
      throw "Nao consegui baixar cda_fi_$mesAno.zip da CVM ($($_.Exception.Message)). Verifique se esse mes ja foi publicado."
    }
  }
  if (-not (Test-Path $zipPath)) { throw "cda_fi_$mesAno.zip nao encontrado (sem cache local e -NoDownload ativo)." }

  $extractDir = Join-Path $cdaDir "cda_extraido_$mesAno"
  if (-not (Test-Path (Join-Path $extractDir "cda_fi_BLC_4_$mesAno.csv"))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)
  }
  return $extractDir
}

# Le' o cda_fi_BLC_4_{mesAno}.csv (bloco misto - acoes, debentures, etc; filtra
# so' TP_APLIC que comeca com "Deb") e retorna a mesma forma de
# Read-CdaFiBlcDebentures: lista de @{ Ativo; Cnpj; Val }.
function Read-CdaFiBlcCsv([string]$path) {
  $rawRows = New-Object System.Collections.Generic.List[object]
  $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::GetEncoding('latin1'))
  if ($lines.Count -lt 1) { return $rawRows }
  $hdr = $lines[0].Split(';')
  $idx = @{}
  for ($i = 0; $i -lt $hdr.Count; $i++) { $idx[$hdr[$i].Trim()] = $i }
  $iCnpj = $idx['CNPJ_FUNDO_CLASSE']; $iApl = $idx['TP_APLIC']; $iVal = $idx['VL_MERC_POS_FINAL']; $iAtivo = $idx['CD_ATIVO']
  if ($null -eq $iCnpj -or $null -eq $iApl -or $null -eq $iVal -or $null -eq $iAtivo) {
    throw "cda_fi_BLC_4: colunas esperadas nao encontradas (CNPJ_FUNDO_CLASSE/TP_APLIC/VL_MERC_POS_FINAL/CD_ATIVO)."
  }
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iAtivo) { continue }
    if ($c[$iApl].Trim() -notlike 'Deb*') { continue }
    $cnpj = NormCNPJ $c[$iCnpj]
    $ativo = $c[$iAtivo].Trim()
    if ($cnpj -eq '' -or $ativo -eq '') { continue }
    $val = 0.0
    [double]::TryParse($c[$iVal], [System.Globalization.NumberStyles]::Any, $ci, [ref]$val) | Out-Null
    $rawRows.Add([pscustomobject]@{ Ativo = $ativo; Cnpj = $cnpj; Val = $val })
  }
  return $rawRows
}

# Le' o cda_fi_PL_{mesAno}.csv (PL por fundo, MESMA data de referencia do CDA -
# mais preciso que o PL do registro_classe.csv, que pode ser de outra data) e
# retorna hashtable: CNPJ_FUNDO_CLASSE(norm) -> VL_PATRIM_LIQ.
function Read-CdaFiPL([string]$path) {
  $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::GetEncoding('latin1'))
  $hdr = $lines[0].Split(';')
  $idx = @{}
  for ($i = 0; $i -lt $hdr.Count; $i++) { $idx[$hdr[$i].Trim()] = $i }
  $iCnpj = $idx['CNPJ_FUNDO_CLASSE']; $iPL = $idx['VL_PATRIM_LIQ']
  if ($null -eq $iCnpj -or $null -eq $iPL) { throw "cda_fi_PL: colunas esperadas nao encontradas (CNPJ_FUNDO_CLASSE/VL_PATRIM_LIQ)." }
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $map = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iPL) { continue }
    $cnpj = NormCNPJ $c[$iCnpj]
    if ($cnpj -eq '') { continue }
    $pl = 0.0
    [double]::TryParse($c[$iPL], [System.Globalization.NumberStyles]::Any, $ci, [ref]$pl) | Out-Null
    $map[$cnpj] = $pl
  }
  return $map
}

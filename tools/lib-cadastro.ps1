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

function Read-AllLinesShared([string]$path, [System.Text.Encoding]$encoding) {
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
  try {
    $sr = New-Object System.IO.StreamReader($fs, $encoding, $true)
    try {
      return @($sr.ReadToEnd() -split '\r?\n')
    } finally {
      $sr.Dispose()
    }
  } finally {
    $fs.Dispose()
  }
}

# Le' um Fundos_12431.csv / Fundos_CDI.csv LOCAL (CNPJ_FUNDO_CLASSE,
# DENOM_SOCIAL, CNPJ Gestor) e retorna a mesma forma de Get-FundosGestorMap:
# @{ map = (CNPJ_FUNDO_CLASSE(norm) -> CNPJ_GESTOR(norm)); colFundo; colGestor }
function Read-FundosGestorCsv([string]$path) {
  if (-not (Test-Path $path)) { throw "Arquivo nao encontrado: $path" }
  $lines = Read-AllLinesShared $path ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' }
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
#   CNPJ_Classe(norm) -> @{ Denom; PL; IdFundo; TipoClasse; Classificacao;
#                           DataRegistro; DataInicio; Forma }
function Read-RegistroClasse([string]$path) {
  $rc = Read-RegistroCsv $path
  $iCnpj = $rc.idx['CNPJ_Classe']; $iId = $rc.idx['ID_Registro_Fundo']
  $iDenom = $rc.idx['Denominacao_Social']; $iSit = $rc.idx['Situacao']; $iPL = $rc.idx['Patrimonio_Liquido']
  $iTipo = $rc.idx['Tipo_Classe']; $iClassif = $rc.idx['Classificacao']
  $iDataReg = $rc.idx['Data_Registro']; $iDataIni = $rc.idx['Data_Inicio']; $iForma = $rc.idx['Forma_Condominio']
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
    $tipoClasse = if ($null -ne $iTipo -and $c.Count -gt $iTipo) { $c[$iTipo].Trim() } else { '' }
    $classificacao = if ($null -ne $iClassif -and $c.Count -gt $iClassif) { $c[$iClassif].Trim() } else { '' }
    $dataReg = if ($null -ne $iDataReg -and $c.Count -gt $iDataReg) { $c[$iDataReg].Trim() } else { '' }
    $dataIni = if ($null -ne $iDataIni -and $c.Count -gt $iDataIni) { $c[$iDataIni].Trim() } else { '' }
    $forma = if ($null -ne $iForma -and $c.Count -gt $iForma) { $c[$iForma].Trim() } else { '' }
    $map[$cnpj] = @{
      Denom = $c[$iDenom].Trim()
      PL = $pl
      IdFundo = $c[$iId].Trim()
      TipoClasse = $tipoClasse
      Classificacao = $classificacao
      DataRegistro = $dataReg
      DataInicio = $dataIni
      Forma = $forma
    }
  }
  return $map
}

# Le' registro_classe.csv e retorna hashtable com ATRIBUTOS por classe, SEM
# filtrar por Situacao (a propria Situacao vira atributo). Usado para gerar
# public/data/Fundos_Atributos.csv (forma de condominio Aberto/Fechado, tipo,
# datas de registro/inicio, PL) - fonte para marcar fundos fechados e datar
# fundos novos, sem depender de acesso a CVM no ambiente do app.
#   CNPJ_Classe(norm) -> @{ Forma; Tipo; Situacao; DataRegistro; DataInicio; PL; Denom }
function Read-RegistroClasseAtributos([string]$path) {
  $rc = Read-RegistroCsv $path
  $iCnpj = $rc.idx['CNPJ_Classe']; $iForma = $rc.idx['Forma_Condominio']
  $iTipo = $rc.idx['Tipo_Classe']; $iSit = $rc.idx['Situacao']
  $iDataReg = $rc.idx['Data_Registro']; $iDataIni = $rc.idx['Data_Inicio']
  $iPL = $rc.idx['Patrimonio_Liquido']; $iDenom = $rc.idx['Denominacao_Social']
  if ($null -eq $iCnpj) {
    throw "registro_classe.csv: coluna CNPJ_Classe nao encontrada."
  }
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $map = @{}
  for ($i = 1; $i -lt $rc.lines.Count; $i++) {
    $l = $rc.lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iCnpj) { continue }
    $cnpj = NormCNPJ $c[$iCnpj]
    if ($cnpj -eq '') { continue }
    $forma = if ($null -ne $iForma -and $c.Count -gt $iForma) { $c[$iForma].Trim() } else { '' }
    $tipo = if ($null -ne $iTipo -and $c.Count -gt $iTipo) { $c[$iTipo].Trim() } else { '' }
    $sit = if ($null -ne $iSit -and $c.Count -gt $iSit) { $c[$iSit].Trim() } else { '' }
    $dReg = if ($null -ne $iDataReg -and $c.Count -gt $iDataReg) { $c[$iDataReg].Trim() } else { '' }
    $dIni = if ($null -ne $iDataIni -and $c.Count -gt $iDataIni) { $c[$iDataIni].Trim() } else { '' }
    $denom = if ($null -ne $iDenom -and $c.Count -gt $iDenom) { $c[$iDenom].Trim() } else { '' }
    $plStr = if ($null -ne $iPL -and $c.Count -gt $iPL) { $c[$iPL].Trim() } else { '' }
    $pl = 0.0
    if ($plStr -ne '') { [double]::TryParse($plStr, [System.Globalization.NumberStyles]::Any, $ci, [ref]$pl) | Out-Null }
    $map[$cnpj] = @{
      Forma = $forma
      Tipo = $tipo
      Situacao = $sit
      DataRegistro = $dReg
      DataInicio = $dIni
      PL = $pl
      Denom = $denom
    }
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

# Busca a serie diaria do CDI (SGS/BCB, serie 12 - Taxa de juros - CDI, % ao dia)
# e retorna hashtable: 'yyyy-MM-dd' -> taxa diaria (fracao, ex 0.0005216 = 0,05216%).
# Cacheia em disco (CDI_Diario.csv, dentro de $cacheDir) para nao rebaixar toda
# hora; so' rebaixa se o cache nao existir, estiver desatualizado (ultima data
# ha' mais de 4 dias) ou nao tiver $NoDownload.
function Get-CdiDiario([string]$cacheDir, [datetime]$desde, [switch]$NoDownload) {
  $cacheFile = Join-Path $cacheDir 'CDI_Diario.csv'
  $map = @{}
  $precisaBaixar = $true
  $ci = [System.Globalization.CultureInfo]::InvariantCulture

  if (Test-Path $cacheFile) {
    $lines = [System.IO.File]::ReadAllLines($cacheFile, [System.Text.Encoding]::UTF8)
    $maxData = $null
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $l = $lines[$i]; if ($l.Trim() -eq '') { continue }
      $c = $l.Split(',')
      if ($c.Count -lt 2) { continue }
      $d = $c[0].Trim()
      $taxa = 0.0
      [double]::TryParse($c[1], [System.Globalization.NumberStyles]::Any, $ci, [ref]$taxa) | Out-Null
      $map[$d] = $taxa
      $dt = [datetime]::MinValue
      if ([datetime]::TryParseExact($d, 'yyyy-MM-dd', $ci, [System.Globalization.DateTimeStyles]::None, [ref]$dt)) {
        if ($null -eq $maxData -or $dt -gt $maxData) { $maxData = $dt }
      }
    }
    if ($maxData -and ((Get-Date) - $maxData).TotalDays -le 4) { $precisaBaixar = $false }
  }

  if ($NoDownload) { $precisaBaixar = $false }

  if ($precisaBaixar) {
    try {
      $dataIni = $desde.ToString('dd/MM/yyyy')
      $dataFim = (Get-Date).ToString('dd/MM/yyyy')
      $url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=$dataIni&dataFinal=$dataFim"
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 90
      $json = $resp.Content | ConvertFrom-Json
      $novoMap = @{}
      foreach ($item in $json) {
        $dt = [datetime]::ParseExact($item.data, 'dd/MM/yyyy', $ci)
        $taxa = 0.0
        [double]::TryParse($item.valor, [System.Globalization.NumberStyles]::Any, $ci, [ref]$taxa) | Out-Null
        $novoMap[$dt.ToString('yyyy-MM-dd')] = $taxa / 100.0
      }
      if ($novoMap.Count -gt 0) {
        $map = $novoMap
        $sb = New-Object System.Text.StringBuilder
        [void]$sb.AppendLine('Data,TaxaDiaria')
        foreach ($k in ($map.Keys | Sort-Object)) {
          [void]$sb.AppendLine(('{0},{1}' -f $k, $map[$k].ToString($ci)))
        }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($cacheFile, $sb.ToString(), $utf8)
      }
    } catch {
      Write-Host "    Falha ao baixar CDI do Banco Central (usando cache local, se houver): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }

  return $map
}

# Retorno acumulado do CDI no intervalo inicio-exclusivo, fim-inclusivo,
# a partir do mapa retornado por Get-CdiDiario. Retorna $null se nao houver
# nenhum dia de CDI publicado no intervalo (janela maior que o historico).
function Get-CdiRetornoJanela($cdiMap, [datetime]$inicio, [datetime]$fim) {
  $prod = 1.0
  $achou = $false
  foreach ($k in $cdiMap.Keys) {
    $dt = [datetime]::MinValue
    if (-not [datetime]::TryParseExact($k, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$dt)) { continue }
    if ($dt -gt $inicio -and $dt -le $fim) {
      $prod *= (1.0 + $cdiMap[$k])
      $achou = $true
    }
  }
  if (-not $achou) { return $null }
  return $prod - 1.0
}

# ─── Lista de Fundos 12431/CDI: metricas, diff e aplicacao da sugestao ─────
# Movido de atualizar-tudo.ps1 (GER-3): usado tanto pelo fluxo interativo do
# terminal quanto pelo painel de controle web (tools/aplicar-fundos.ps1).

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

function Get-FundosMetrics([string]$scriptRoot) {
  return Get-FundosMetricsFromFiles `
    (Join-Path $scriptRoot 'Fundos_12431.csv') `
    (Join-Path $scriptRoot 'Fundos_CDI.csv')
}

function Get-FundosSuggestionMetrics([string]$scriptRoot) {
  $path12431 = Join-Path $scriptRoot 'Sugestao_Lista_Final_12431.csv'
  $pathCdi = Join-Path $scriptRoot 'Sugestao_Lista_Final_CDI.csv'
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

# Aplica a sugestao gerada por selecionar-fundos.ps1: copia os 2 CSVs de
# sugestao por cima dos reais. Usado pelo fluxo interativo (atualizar-tudo.ps1)
# e pelo botao "Aplicar sugestao de fundos" do painel de controle web
# (tools/aplicar-fundos.ps1).
function Apply-FundosSuggestion([string]$scriptRoot) {
  Copy-Item -Path (Join-Path $scriptRoot 'Sugestao_Lista_Final_12431.csv') -Destination (Join-Path $scriptRoot 'Fundos_12431.csv') -Force
  Copy-Item -Path (Join-Path $scriptRoot 'Sugestao_Lista_Final_CDI.csv') -Destination (Join-Path $scriptRoot 'Fundos_CDI.csv') -Force
}

# ─── Ofertas publicas de distribuicao (CVM) ──────────────────────────────
# Base de OFERTAS registradas na CVM (Resolucao 160). Mais tempestiva que o
# cadastro do Debentures.com.br (que tem defasagem): serve pra detectar
# emissoes ja registradas na CVM que ainda nao entraram no nosso cadastro.

# Baixa/cacheia oferta_distribuicao.zip da CVM e extrai. Re-baixa no max 1x/dia.
# O zip contem oferta_distribuicao.csv (Instrucao 400, historico) e
# oferta_resolucao_160.csv (regime atual) - usamos o segundo.
function Get-OfertaDistribDir([string]$ofertaDir, [switch]$NoDownload) {
  New-Item -ItemType Directory -Force -Path $ofertaDir | Out-Null
  $zipPath = Join-Path $ofertaDir 'oferta_distribuicao.zip'
  $url = 'https://dados.cvm.gov.br/dados/OFERTA/DISTRIB/DADOS/oferta_distribuicao.zip'

  $precisaBaixar = $true
  if (Test-Path $zipPath) { $precisaBaixar = (Get-Item $zipPath).LastWriteTime.Date -ne (Get-Date).Date }
  if ($precisaBaixar -and -not $NoDownload) {
    $tmp = "$zipPath.tmp"
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 300 -UseBasicParsing
      Move-Item $tmp $zipPath -Force
    } catch {
      Write-Host "    AVISO: nao consegui baixar oferta_distribuicao.zip ($($_.Exception.Message))." -ForegroundColor Yellow
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
      if (-not (Test-Path $zipPath)) { throw "oferta_distribuicao.zip indisponivel e sem cache local em $zipPath" }
    }
  }

  $extractDir = Join-Path $ofertaDir 'oferta_extraida'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)
  return $extractDir
}

# Le' Debentures.csv (UTF-8, virgula, campos entre aspas) e retorna um HashSet
# de chaves "cnpj|emissao" (emissao como inteiro, sem zeros a esquerda) - o
# conjunto de emissoes que JA existem no nosso cadastro.
function Get-DebenturesEmissaoSet([string]$debenturesPath) {
  $set = New-Object System.Collections.Generic.HashSet[string]
  if (-not (Test-Path $debenturesPath)) { return $set }
  $lines = @(Read-AllLinesShared $debenturesPath ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -lt 2) { return $set }
  $hdr = Split-CsvLine $lines[0]
  $iCnpj = Find-ColIndex $hdr '(?i)^cnpj$'
  if ($iCnpj -lt 0) { $iCnpj = Find-ColIndex $hdr '(?i)cnpj' }
  $iEmis = Find-ColIndex $hdr '(?i)^emissao$'
  if ($iEmis -lt 0) { $iEmis = Find-ColIndex $hdr '(?i)emissao' '(?i)data|registro|cvm' }
  if ($iCnpj -lt 0 -or $iEmis -lt 0) { return $set }
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $cols = Split-CsvLine $lines[$i]
    if ($cols.Count -le [Math]::Max($iCnpj, $iEmis)) { continue }
    $cnpj = NormCNPJ $cols[$iCnpj]
    $emisDigits = ($cols[$iEmis] -replace '\D', '')
    if ($cnpj -eq '' -or $emisDigits -eq '') { continue }
    [void]$set.Add("$cnpj|$([int]$emisDigits)")
  }
  return $set
}

# Reconcilia a base de ofertas (oferta_resolucao_160.csv) contra o nosso
# cadastro: retorna as ofertas de DEBENTURES com Registro Concedido nos
# ultimos $janelaDias dias que NAO tem par (CNPJ + numero da emissao) no
# Debentures.csv - ou seja, emissoes ja registradas na CVM que o
# Debentures.com.br ainda nao publicou. Uma linha por (CNPJ, emissao).
function Get-OfertasDebNaoCadastradas([string]$ofertaCsvPath, [string]$debenturesPath, [int]$janelaDias = 90) {
  $resultado = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path $ofertaCsvPath)) { return $resultado.ToArray() }

  $have = Get-DebenturesEmissaoSet $debenturesPath
  $rc = Read-RegistroCsv $ofertaCsvPath
  $idx = $rc.idx
  $iVm = $idx['Valor_Mobiliario']; $iStatus = $idx['Status_Requerimento']
  $iDataReg = $idx['Data_Registro']; $iCnpj = $idx['CNPJ_Emissor']; $iNome = $idx['Nome_Emissor']
  $iDataReq = $idx['Data_requerimento']
  $iEmis = $idx['Emissao']; $iValor = $idx['Valor_Total_Registrado']
  $iIncent = $idx['Titulo_incentivado']; $iLider = $idx['Nome_Lider']
  if ($null -eq $iVm -or $null -eq $iStatus -or $null -eq $iDataReg -or $null -eq $iCnpj -or $null -eq $iEmis) {
    Write-Host "    AVISO: oferta_resolucao_160.csv sem as colunas esperadas; pulando reconciliacao." -ForegroundColor Yellow
    return $resultado.ToArray()
  }

  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $corte = (Get-Date).Date.AddDays(-$janelaDias)
  # "Debentures" com e-circunflexo (char 234), mantendo o .ps1 em ASCII.
  $rotuloDeb = 'Deb' + [char]234 + 'ntures'
  $vistos = @{}
  for ($i = 1; $i -lt $rc.lines.Count; $i++) {
    $l = $rc.lines[$i]; if ($l.Trim() -eq '') { continue }
    $c = $l.Split(';')
    if ($c.Count -le $iEmis) { continue }
    if ($c[$iVm].Trim() -ne $rotuloDeb) { continue }
    if ($c[$iStatus].Trim() -ne 'Registro Concedido') { continue }
    $dt = [datetime]::MinValue
    if (-not [datetime]::TryParseExact($c[$iDataReg].Trim(), 'yyyy-MM-dd', $ci, [System.Globalization.DateTimeStyles]::None, [ref]$dt)) { continue }
    if ($dt -lt $corte) { continue }
    $cnpj = NormCNPJ $c[$iCnpj]
    $emisDigits = ($c[$iEmis] -replace '\D', '')
    if ($cnpj -eq '' -or $emisDigits -eq '') { continue }
    $chave = "$cnpj|$([int]$emisDigits)"
    if ($have.Contains($chave)) { continue }
    if ($vistos.ContainsKey($chave)) { continue }
    $vistos[$chave] = $true

    $valor = 0.0
    if ($null -ne $iValor -and $c.Count -gt $iValor) {
      [double]::TryParse($c[$iValor], [System.Globalization.NumberStyles]::Any, $ci, [ref]$valor) | Out-Null
    }
    $incent = if ($null -ne $iIncent -and $c.Count -gt $iIncent) { $c[$iIncent].Trim() } else { '' }
    $lider = if ($null -ne $iLider -and $c.Count -gt $iLider) { $c[$iLider].Trim() } else { '' }
    $dataReq = if ($null -ne $iDataReq -and $c.Count -gt $iDataReq) { $c[$iDataReq].Trim() } else { '' }
    $resultado.Add([pscustomobject]@{
      DataRegistro = $c[$iDataReg].Trim()
      DataRequerimento = $dataReq
      Emissor = $c[$iNome].Trim()
      Cnpj = $cnpj
      Emissao = [int]$emisDigits
      Valor = $valor
      Incentivada = ($incent -match '^(?i)s')
      Lider = $lider
    })
  }
  return @($resultado | Sort-Object DataRegistro)
}

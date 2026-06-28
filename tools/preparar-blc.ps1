<#
  preparar-blc.ps1
  --------------------------------------------------------------------------
  Transforma o arquivo bruto da CVM (CDA_FI_BLC, .xlsx) no arquivo enxuto
  que o app de debentures consome.

  O que faz:
    1. Le o .xlsx (mesmo aberto no Excel)
    2. Mantem apenas linhas de Debentures (coluna TP_APLIC), se existir
    3. Busca o mapa fundo->gestor no GAS de cadastro (sheet=fundos)
    4. Agrega somando VL_MERC_POS_FINAL por (CD_ATIVO, GESTOR)
    5. Grava um CSV de 3 colunas: CD_ATIVO,GESTOR,VL_ALOCADO

  Uso:
    - Arraste o .xlsx para cima do preparar-blc.bat   (mais facil), ou
    - powershell -File preparar-blc.ps1 "C:\caminho\arquivo.xlsx"
    - Sem argumento: pega o cda_fi_BLC*.xlsx mais recente da pasta padrao.
#>

param(
  [string]$XlsxPath = '',
  [string]$OutPath  = ''
)

$ErrorActionPreference = 'Stop'

# ---- Configuracao ----------------------------------------------------------
# "C:\Projeto Credito\Power BI" — [char]233 = e-acento (mantem o .ps1 lendo certo em ANSI)
$DefaultFolder = ("C:\Projeto Cr" + [char]233 + "dito\Power BI")
$FundosUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec?sheet=fundos'
# ---------------------------------------------------------------------------

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function NormCNPJ($s) { return ($s -replace '\D','') }

# Letra(s) da coluna de uma referencia (ex: "AB12" -> 28)
function ColNum([string]$ref) {
  $letters = ($ref -replace '\d','')
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n
}

Write-Host ""
Write-Host "=== Preparar BLC para o app ===" -ForegroundColor Green

# ---- 1. Localizar o arquivo .xlsx -----------------------------------------
if ([string]::IsNullOrWhiteSpace($XlsxPath)) {
  Write-Step "Nenhum arquivo informado. Procurando o mais recente em: $DefaultFolder"
  $cand = Get-ChildItem -Path $DefaultFolder -Filter 'cda_fi_BLC*.xlsx' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $cand) { throw "Nao achei nenhum 'cda_fi_BLC*.xlsx' em $DefaultFolder. Arraste o arquivo para o .bat ou informe o caminho." }
  $XlsxPath = $cand.FullName
}
if (-not (Test-Path $XlsxPath)) { throw "Arquivo nao encontrado: $XlsxPath" }
Write-Step "Arquivo: $XlsxPath"

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  # Salva direto na pasta public/ do app (o script mora em tools/, public/ e' irma)
  $appPublic = Join-Path (Split-Path $PSScriptRoot -Parent) 'public'
  if (Test-Path $appPublic) {
    $OutPath = Join-Path $appPublic 'BLC_tratado.csv'
  } else {
    $OutPath = Join-Path (Split-Path $XlsxPath -Parent) 'BLC_tratado.csv'
  }
}

$swTotal = [System.Diagnostics.Stopwatch]::StartNew()
$rawRows = New-Object System.Collections.Generic.List[object]

# ---- 2. Abrir o xlsx (mesmo travado pelo Excel) ----------------------------
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$fs  = [System.IO.File]::Open($XlsxPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read)

try {
  # ---- 2a. sharedStrings -> array indice/texto -----------------------------
  Write-Step "Lendo textos (sharedStrings)..."
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
  Write-Step "  $($shared.Count) textos carregados"

  # ---- 2b. Stream da planilha ---------------------------------------------
  $shEntry = $zip.Entries | Where-Object { $_.FullName -like 'xl/worksheets/sheet1.xml' }
  if (-not $shEntry) { $shEntry = $zip.Entries | Where-Object { $_.FullName -like 'xl/worksheets/*.xml' } | Select-Object -First 1 }
  $stream = $shEntry.Open()
  $xr = [System.Xml.XmlReader]::Create($stream)

  # Acumuladores
  $headers = @{}            # colNum -> nome (linha 1)
  $colCNPJ = 0; $colApl = 0; $colVal = 0; $colAtivo = 0
  $headerDone = $false
  $rowIdx = 0
  $cellVals = @{}          # colNum -> valor (linha corrente)
  $curCol = 0; $curType = $null

  Write-Step "Lendo linhas da planilha (pode levar 1-2 min)..."
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
            # Cabecalho: mapear nomes -> colunas
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
            # Linha de dados — guardar bruto pra agregar depois
            $ativo = if ($cellVals.ContainsKey($colAtivo)) { ([string]$cellVals[$colAtivo]).Trim() } else { '' }
            $cnpj  = if ($cellVals.ContainsKey($colCNPJ))  { ([string]$cellVals[$colCNPJ]).Trim() }  else { '' }
            $aplOk = $true
            if ($colApl -ne 0) {
              $apl = if ($cellVals.ContainsKey($colApl)) { [string]$cellVals[$colApl] } else { '' }
              $aplOk = ($apl -like 'Deb*')   # Debentures (sem depender de acento)
            }
            if ($aplOk -and $ativo -ne '' -and $cnpj -ne '') {
              $val = 0.0
              if ($cellVals.ContainsKey($colVal)) {
                [double]::TryParse([string]$cellVals[$colVal], [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$val) | Out-Null
              }
              $rawRows.Add([pscustomobject]@{ Ativo=$ativo; Cnpj=(NormCNPJ $cnpj); Val=$val })
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

Write-Step "  $($rawRows.Count) linhas de debentures lidas"

# ---- 3. Mapa fundo->gestor (GAS cadastro) ---------------------------------
Write-Step "Buscando mapa fundo->gestor no cadastro..."
$resp = Invoke-WebRequest -Uri $FundosUrl -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 90
$body = $resp.Content
if ($body.TrimStart().StartsWith('<')) { throw "O GAS de cadastro retornou HTML em vez de CSV. Tente rodar de novo." }
$fLines = $body -split "`n"
$fundo2gestor = @{}
for ($i = 1; $i -lt $fLines.Count; $i++) {
  $line = $fLines[$i].Trim(); if ($line -eq '') { continue }
  $cols = [regex]::Matches($line, '("([^"]*)")|([^,]+)') | ForEach-Object {
            if ($_.Groups[2].Success) { $_.Groups[2].Value } else { $_.Groups[3].Value } }
  $cnpj = NormCNPJ $cols[0]
  $apelido    = if ($cols.Count -ge 7) { $cols[6].Trim() } else { '' }
  $nomeGestor = if ($cols.Count -ge 4) { $cols[3].Trim() } else { '' }
  $g = if ($apelido -ne '') { $apelido } elseif ($nomeGestor -ne '') { $nomeGestor } else { '(sem gestor)' }
  if ($cnpj -ne '') { $fundo2gestor[$cnpj] = $g }
}
Write-Step "  $($fundo2gestor.Count) fundos mapeados"

# ---- 4. Agregar por (ativo, gestor) ---------------------------------------
Write-Step "Agregando por (ativo, gestor)..."
$agg = @{}
$ativos = New-Object System.Collections.Generic.HashSet[string]
$gestores = New-Object System.Collections.Generic.HashSet[string]
$semMatch = 0
foreach ($r in $rawRows) {
  [void]$ativos.Add($r.Ativo)
  $g = if ($fundo2gestor.ContainsKey($r.Cnpj)) { $fundo2gestor[$r.Cnpj] } else { $semMatch++; '(fundo nao cadastrado)' }
  [void]$gestores.Add($g)
  $k = $r.Ativo + '|' + $g
  if ($agg.ContainsKey($k)) { $agg[$k] += $r.Val } else { $agg[$k] = $r.Val }
}

# ---- 5. Gravar CSV ---------------------------------------------------------
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('CD_ATIVO,GESTOR,VL_ALOCADO')
foreach ($kv in $agg.GetEnumerator()) {
  $p = $kv.Key -split '\|', 2
  $ativo  = $p[0].Replace('"','""')
  $gestor = $p[1].Replace('"','""')
  $valor  = [math]::Round($kv.Value, 2).ToString([System.Globalization.CultureInfo]::InvariantCulture)
  [void]$sb.AppendLine('"' + $ativo + '","' + $gestor + '",' + $valor)
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutPath, $sb.ToString(), $utf8)

$swTotal.Stop()
$kb = [math]::Round([System.Text.Encoding]::UTF8.GetByteCount($sb.ToString())/1024, 1)

Write-Host ""
Write-Host "=== PRONTO em $($swTotal.Elapsed.TotalSeconds.ToString('F0'))s ===" -ForegroundColor Green
Write-Host "  Debentures alocadas : $($ativos.Count)"
Write-Host "  Gestores            : $($gestores.Count)"
Write-Host "  Linhas (ativo+gestor): $($agg.Count)"
Write-Host "  Tamanho             : $kb KB"
if ($semMatch -gt 0) { Write-Host "  Aviso: $semMatch linhas de fundos sem cadastro (viraram '(fundo nao cadastrado)')" -ForegroundColor Yellow }
Write-Host ""
Write-Host "  Arquivo gerado:" -ForegroundColor White
Write-Host "  $OutPath" -ForegroundColor Yellow
Write-Host ""

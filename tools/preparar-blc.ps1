<#
  preparar-blc.ps1
  --------------------------------------------------------------------------
  Transforma o arquivo bruto da CVM (CDA_FI_BLC, .xlsx) no arquivo enxuto
  que o app de debentures consome.

  O que faz:
    1. Le o .xlsx (mesmo aberto no Excel)
    2. Mantem apenas linhas de Debentures (coluna TP_APLIC), se existir
    3. Resolve o mapa fundo->gestor (ver lib-cadastro.ps1):
         tools\Fundos_12431.csv / tools\Fundos_CDI.csv (local, CNPJ_FUNDO_CLASSE -> CNPJ Gestor)
         GAS sheet=Cadastro_Gestores                    (CNPJ Gestor -> Apelido Gestor)
    4. Agrega somando VL_MERC_POS_FINAL por (CD_ATIVO, GESTOR)
    5. Grava um CSV de 3 colunas: CD_ATIVO,GESTOR,VL_ALOCADO

  Uso:
    - Arraste o .xlsx para cima do preparar-blc.bat   (mais facil), ou
    - powershell -File preparar-blc.ps1 "C:\caminho\arquivo.xlsx"
    - Sem argumento: pega o cda_fi_BLC*.xlsx mais recente da pasta padrao.
#>

param(
  [string]$XlsxPath = '',
  [string]$OutPath  = '',
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec'
)

$ErrorActionPreference = 'Stop'

# ---- Configuracao ----------------------------------------------------------
# "C:\Projeto Credito\Power BI" - [char]233 = e-acento (mantem o .ps1 lendo certo em ANSI)
$DefaultFolder = ("C:\Projeto Cr" + [char]233 + "dito\Power BI")
# ---------------------------------------------------------------------------

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== Preparar BLC para o app ===" -ForegroundColor Green

# ---- 1. Localizar o arquivo .xlsx -----------------------------------------
if ([string]::IsNullOrWhiteSpace($XlsxPath)) {
  Write-Step "Nenhum arquivo informado. Procurando o mais recente em: $DefaultFolder"
  $XlsxPath = Find-LatestCdaFiBlc $DefaultFolder
  if (-not $XlsxPath) { throw "Nao achei nenhum 'cda_fi_BLC*.xlsx' em $DefaultFolder. Arraste o arquivo para o .bat ou informe o caminho." }
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

# ---- 2. Ler o xlsx (mesmo travado pelo Excel) ------------------------------
Write-Step "Lendo linhas da planilha (pode levar 1-2 min)..."
$rawRows = Read-CdaFiBlcDebentures $XlsxPath
Write-Step "  $($rawRows.Count) linhas de debentures lidas"

# ---- 3. Mapa fundo->gestor (Fundos_12431/Fundos_CDI locais + Cadastro_Gestores) ---
Write-Step "Lendo Fundos_12431.csv / Fundos_CDI.csv (local) e buscando Cadastro_Gestores no cadastro..."
$fg12431 = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_12431.csv')
$fgCdi   = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
$gestorApelidoMap = Get-GestorApelidoMap $CadastroUrl
# Une os dois segmentos: CNPJ_FUNDO_CLASSE -> CNPJ Gestor
$fundoGestor = @{}
foreach ($k in $fg12431.map.Keys) { $fundoGestor[$k] = $fg12431.map[$k] }
foreach ($k in $fgCdi.map.Keys)   { $fundoGestor[$k] = $fgCdi.map[$k] }
Write-Step "  $($fundoGestor.Count) fundos (12431 + CDI) | $($gestorApelidoMap.Count) gestoras cadastradas"

$bridge = Build-FundoApelidoMap $fundoGestor $gestorApelidoMap
$fundo2gestor = $bridge.map
Write-Step "  $($fundo2gestor.Count) fundos mapeados a um gestor"
if ($bridge.semGestorCadastrado -gt 0) {
  Write-Host "    fundos com CNPJ Gestor sem cadastro em Cadastro_Gestores: $($bridge.semGestorCadastrado)" -ForegroundColor Yellow
  $faltando = @($bridge.gestoresFaltando) | Sort-Object -Unique
  if ($faltando.Count) { Write-Host "      CNPJs de gestor ausentes: $($faltando -join ', ')" -ForegroundColor DarkYellow }
}

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

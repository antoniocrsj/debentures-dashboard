<#
  preparar-blc.ps1
  --------------------------------------------------------------------------
  Gera o arquivo enxuto de alocacao em debentures que o app consome, a partir
  do CDA da CVM.

  O que faz:
    1. Baixa o cda_fi_{AAAAMM}.zip da CVM (mes-alvo pela mesma regra de
       defasagem de selecionar-fundos.ps1: ate dia 15 -> mes atual -5; depois
       -> mes atual -4) e le' o bloco BLC_4 (debentures). Alternativa:
       -XlsxPath pra usar um arquivo local (ex: .xlsx ja' ajustado) em vez de
       baixar da CVM.
    2. Resolve o mapa fundo->gestor (ver lib-cadastro.ps1):
         tools\Fundos_12431.csv / tools\Fundos_CDI.csv (local, CNPJ_FUNDO_CLASSE -> CNPJ Gestor)
         GAS sheet=Cadastro_Gestores                    (CNPJ Gestor -> Apelido Gestor)
    3. Agrega somando VL_MERC_POS_FINAL por (CD_ATIVO, GESTOR)
    4. Grava um CSV de 3 colunas: CD_ATIVO,GESTOR,VL_ALOCADO

  Uso:
    - powershell -File preparar-blc.ps1                          (baixa da CVM)
    - powershell -File preparar-blc.ps1 -MesAno 202603            (mes especifico)
    - powershell -File preparar-blc.ps1 -XlsxPath "C:\...\a.xlsx" (.xlsx local)
    - Duplo-clique em preparar-blc.bat (baixa da CVM), ou arraste um .xlsx
      pra cima do .bat (usa -XlsxPath automaticamente)
#>

param(
  [string]$MesAno = '',
  [string]$XlsxPath = '',
  [string]$OutPath  = '',
  [string]$CdaDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cda"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== Preparar BLC para o app ===" -ForegroundColor Green

# ---- 1. Ler o CDA (debentures por fundo) -----------------------------------
if (-not [string]::IsNullOrWhiteSpace($XlsxPath)) {
  if (-not (Test-Path $XlsxPath)) { throw "Arquivo nao encontrado: $XlsxPath" }
  Write-Step "Lendo $XlsxPath (pode levar 1-2 min)..."
  $rawRows = Read-CdaFiBlcDebentures $XlsxPath
} else {
  if (-not $MesAno) { $MesAno = Get-CdaTargetMonth }
  Write-Step "Mes-alvo do CDA: $MesAno (defasagem: ate dia 15 -> mes atual -5; depois -> -4)"
  Write-Step "Baixando/lendo cda_fi_$MesAno.zip da CVM..."
  $cdaExtractDir = Get-CdaFiDir $CdaDir $MesAno -NoDownload:$NoDownload
  Write-Step "Lendo cda_fi_BLC_4_$MesAno.csv (debentures, pode levar 1-2 min)..."
  $rawRows = Read-CdaFiBlcCsv (Join-Path $cdaExtractDir "cda_fi_BLC_4_$MesAno.csv")
}
Write-Step "  $($rawRows.Count) linhas de debentures lidas"

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  # Salva direto na pasta public/ do app (o script mora em tools/, public/ e' irma)
  $appPublic = Join-Path (Split-Path $PSScriptRoot -Parent) 'public'
  $OutPath = Join-Path $appPublic 'BLC_tratado.csv'
}

$swTotal = [System.Diagnostics.Stopwatch]::StartNew()

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

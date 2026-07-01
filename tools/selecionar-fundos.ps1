<#
  selecionar-fundos.ps1
  --------------------------------------------------------------------------
  Gera uma SUGESTAO de fundos para as abas Fundos_12431 / Fundos_CDI, a partir
  de criterios objetivos. Nao substitui a curadoria manual - so' aponta o que
  revisar (nada e' escrito na planilha automaticamente).

  Criterios:
    - 12431 (Incentivados): nome do fundo contem termos de infraestrutura ou
      incentivado (Lei 12.431). Fundos FI-Infra sao obrigados por lei a manter
      a carteira majoritariamente em debentures incentivadas, entao o nome ja'
      e' um sinal confiavel (validado contra a base atual: cobre 100% dos
      fundos ja conhecidos como 12431, sem nenhum falso positivo no CDI).
    - Tradicional (CDI): NAO bate o criterio de nome acima E tem >= 15% do PL
      em debentures (qualquer tipo).

  Fontes (publicas, baixadas automaticamente):
    - CDA_FI_BLC.xlsx (mesmo arquivo do preparar-blc.ps1) -> posicao em
      debentures por fundo (soma de todos os ativos, nao so' os alocados).
    - registro_fundo_classe.zip da CVM -> universo de classes ATIVAS, PL de
      cada uma, e o gestor (via ID_Registro_Fundo -> registro_fundo.csv).
      Diferente do cad_fi.csv (legado, nivel fundo): estes arquivos sao
      pos-Resolucao CVM 175, no nivel de CLASSE - a mesma granularidade do
      CNPJ_FUNDO_CLASSE usado no Informe Diario/CDA. Validado contra a base
      atual: 97-98% de acerto direto no CNPJ Gestor.

  Saida (para revisao manual):
    tools\Sugestao_Novos.csv    - fundos que batem o criterio e ainda nao
                                   estao em Fundos_12431/Fundos_CDI.
    tools\Sugestao_Remover.csv  - fundos que estao nas abas hoje mas nao
                                   batem mais o criterio (ou sairam do CDA).

  Uso: powershell -File selecionar-fundos.ps1 [-XlsxPath "C:\...\cda_fi_BLC_...xlsx"]
#>

param(
  [string]$XlsxPath = '',
  [string]$RegistroDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cadastro_fundos"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [double]$LimiarPct = 0.15,
  [string]$OutDir = '',
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'
$DefaultFolder = ("C:\Projeto Cr" + [char]233 + "dito\Power BI")
$NOME_12431_REGEX = '(?i)incentiv|infraestr|\binfra\b|infra[- ]'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

if (-not $OutDir) { $OutDir = $PSScriptRoot }

Write-Host ""
Write-Host "=== Selecionar Fundos (sugestao Fundos_12431 / Fundos_CDI) ===" -ForegroundColor Green

# ---- 1. Ler o CDA_FI_BLC.xlsx ----------------------------------------------
if ([string]::IsNullOrWhiteSpace($XlsxPath)) {
  Step "Procurando cda_fi_BLC*.xlsx mais recente em $DefaultFolder..."
  $XlsxPath = Find-LatestCdaFiBlc $DefaultFolder
  if (-not $XlsxPath) { throw "Nao achei nenhum 'cda_fi_BLC*.xlsx' em $DefaultFolder. Informe -XlsxPath." }
}
Step "Lendo $XlsxPath (pode levar 1-2 min)..."
$rawRows = Read-CdaFiBlcDebentures $XlsxPath
Step "  $($rawRows.Count) linhas de debentures lidas"

# Soma o valor em debentures por fundo (todos os ativos, nao so' os alocados)
$debPorFundo = @{}
foreach ($r in $rawRows) {
  if ($debPorFundo.ContainsKey($r.Cnpj)) { $debPorFundo[$r.Cnpj] += $r.Val } else { $debPorFundo[$r.Cnpj] = $r.Val }
}
Step "  $($debPorFundo.Count) fundos distintos com posicao em debentures"

# ---- 2. Cadastro de classes da CVM (registro_classe + registro_fundo) -----
Step "Baixando/lendo cadastro de classes da CVM (registro_fundo_classe.zip)..."
$extractDir = Get-RegistroFundoClasseDir $RegistroDir -NoDownload:$NoDownload
$classeInfo = Read-RegistroClasse (Join-Path $extractDir 'registro_classe.csv')
$fundoGestorCvm = Read-RegistroFundoGestor (Join-Path $extractDir 'registro_fundo.csv')
Step "  $($classeInfo.Count) classes ativas | $($fundoGestorCvm.Count) fundos com gestor no cadastro CVM"

# ---- 3. Cadastro_Gestores (apelidos ja conhecidos) -------------------------
Step "Buscando Cadastro_Gestores no cadastro..."
$gestorApelidoMap = Get-GestorApelidoMap $CadastroUrl
Step "  $($gestorApelidoMap.Count) gestoras cadastradas"

# ---- 4. Classifica cada fundo com posicao em debentures --------------------
Step "Classificando fundos (12431 por nome, Tradicional por >= $($LimiarPct*100)% em debentures)..."
$candidatos = New-Object System.Collections.Generic.List[object]
$semRegistro = 0; $semPL = 0
foreach ($cnpj in $debPorFundo.Keys) {
  if (-not $classeInfo.ContainsKey($cnpj)) { $semRegistro++; continue }
  $info = $classeInfo[$cnpj]
  if ($info.PL -le 0) { $semPL++; continue }
  $pct = $debPorFundo[$cnpj] / $info.PL
  $eh12431 = [regex]::IsMatch($info.Denom, $NOME_12431_REGEX)
  if (-not $eh12431 -and $pct -lt $LimiarPct) { continue }
  $segmento = if ($eh12431) { '12431' } else { 'CDI' }

  $cnpjGestor = if ($fundoGestorCvm.ContainsKey($info.IdFundo)) { $fundoGestorCvm[$info.IdFundo] } else { '' }
  $apelido = if ($cnpjGestor -ne '' -and $gestorApelidoMap.ContainsKey($cnpjGestor)) { $gestorApelidoMap[$cnpjGestor] } else { '' }

  $candidatos.Add([pscustomobject]@{
    Cnpj = $cnpj; Denom = $info.Denom; Segmento = $segmento; PctDeb = $pct
    CnpjGestor = $cnpjGestor; Apelido = $apelido
  })
}
$n12431 = ($candidatos | Where-Object { $_.Segmento -eq '12431' }).Count
$nCdi   = ($candidatos | Where-Object { $_.Segmento -eq 'CDI' }).Count
Step "  $($candidatos.Count) fundos qualificados (12431: $n12431 | Tradicional: $nCdi)"
Step "  sem registro no cadastro CVM: $semRegistro | sem PL valido: $semPL"

$semGestor = @($candidatos | Where-Object { $_.CnpjGestor -eq '' })
$semApelido = @($candidatos | Where-Object { $_.CnpjGestor -ne '' -and $_.Apelido -eq '' })
if ($semGestor.Count -gt 0)  { Write-Host "    $($semGestor.Count) fundo(s) sem CNPJ Gestor no cadastro CVM" -ForegroundColor Yellow }
if ($semApelido.Count -gt 0) {
  Write-Host "    $($semApelido.Count) fundo(s) com gestor ainda sem cadastro em Cadastro_Gestores" -ForegroundColor Yellow
  $cnpjsFaltando = ($semApelido | Select-Object -ExpandProperty CnpjGestor -Unique)
  Write-Host "      CNPJs de gestor ausentes: $($cnpjsFaltando -join ', ')" -ForegroundColor DarkYellow
}

# ---- 5. Compara com Fundos_12431 / Fundos_CDI atuais -----------------------
Step "Comparando com Fundos_12431 / Fundos_CDI atuais..."
$fg12431Atual = Get-FundosGestorMap $CadastroUrl 'Fundos_12431'
$fgCdiAtual   = Get-FundosGestorMap $CadastroUrl 'Fundos_CDI'
$atuais = New-Object System.Collections.Generic.HashSet[string]
$fg12431Atual.map.Keys | ForEach-Object { [void]$atuais.Add($_) }
$fgCdiAtual.map.Keys   | ForEach-Object { [void]$atuais.Add($_) }
Step "  $($atuais.Count) fundos nas abas atuais"

$qualificadosSet = New-Object System.Collections.Generic.HashSet[string]
$candidatos | ForEach-Object { [void]$qualificadosSet.Add($_.Cnpj) }

$novos = @($candidatos | Where-Object { -not $atuais.Contains($_.Cnpj) })
$removerCnpjs = @($atuais | Where-Object { -not $qualificadosSet.Contains($_) })

# ---- 6. Grava as sugestoes --------------------------------------------------
$ci = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding($false)

$outNovos = Join-Path $OutDir 'Sugestao_Novos.csv'
$sbN = New-Object System.Text.StringBuilder
[void]$sbN.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,Segmento,Pct_Debentures,CNPJ Gestor,Apelido Gestor')
foreach ($c in ($novos | Sort-Object Segmento, Denom)) {
  $pct = ([Math]::Round($c.PctDeb * 100, 1)).ToString($ci)
  [void]$sbN.AppendLine(('"{0}","{1}",{2},{3}%,"{4}","{5}"' -f $c.Cnpj, $c.Denom.Replace('"', '""'), $c.Segmento, $pct, $c.CnpjGestor, $c.Apelido.Replace('"', '""')))
}
[System.IO.File]::WriteAllText($outNovos, $sbN.ToString(), $utf8)

$outRemover = Join-Path $OutDir 'Sugestao_Remover.csv'
$sbR = New-Object System.Text.StringBuilder
[void]$sbR.AppendLine('CNPJ_FUNDO_CLASSE,Motivo')
foreach ($cnpj in ($removerCnpjs | Sort-Object)) {
  $motivo =
    if (-not $classeInfo.ContainsKey($cnpj)) { 'nao encontrado como classe ativa no cadastro CVM (cancelado/liquidado?)' }
    elseif (-not $debPorFundo.ContainsKey($cnpj)) { 'sem posicao em debentures no CDA atual' }
    elseif ($classeInfo[$cnpj].PL -le 0) { 'PL invalido/zerado no cadastro CVM' }
    else { "abaixo de $($LimiarPct*100)% em debentures e nome nao bate padrao 12431" }
  [void]$sbR.AppendLine(('"{0}","{1}"' -f $cnpj, $motivo))
}
[System.IO.File]::WriteAllText($outRemover, $sbR.ToString(), $utf8)

# ---- 7. Relatorio -----------------------------------------------------------
Write-Host ""
Write-Host "=== RELATORIO ===" -ForegroundColor Green
Write-Host "  Fundos qualificados no CDA atual  : $($candidatos.Count) (12431: $n12431 | Tradicional: $nCdi)"
Write-Host "  Novos (nao estao nas abas hoje)    : $($novos.Count)"
Write-Host "  Para remover (nao qualificam mais) : $($removerCnpjs.Count)"
Write-Host ""
Write-Host "  Arquivos gerados (revise antes de colar na planilha):" -ForegroundColor White
Write-Host "    $outNovos"   -ForegroundColor Yellow
Write-Host "    $outRemover" -ForegroundColor Yellow
Write-Host ""

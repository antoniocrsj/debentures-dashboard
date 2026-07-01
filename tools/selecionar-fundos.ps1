<#
  selecionar-fundos.ps1
  --------------------------------------------------------------------------
  Gera uma SUGESTAO de fundos para tools\Fundos_12431.csv / tools\Fundos_CDI.csv
  (arquivos locais, ver sincronizar-fundos-planilha.ps1 se precisar trazer uma
  edicao feita na planilha de volta pro arquivo local), a partir de criterios
  objetivos. Nao substitui a curadoria manual - so' aponta o que revisar (nada
  e' sobrescrito automaticamente).

  Criterios:
    - 12431 (Incentivados): nome do fundo contem termos de infraestrutura ou
      incentivado (Lei 12.431). Fundos FI-Infra sao obrigados por lei a manter
      a carteira majoritariamente em debentures incentivadas, entao o nome ja'
      e' um sinal confiavel (validado contra a base atual: cobre 100% dos
      fundos ja conhecidos como 12431, sem nenhum falso positivo no CDI).
    - Tradicional (CDI): NAO bate o criterio de nome acima E tem >= 15% do PL
      em debentures (qualquer tipo).

  Fontes (publicas, baixadas automaticamente):
    - cda_fi_{AAAAMM}.zip da CVM -> posicao em debentures (bloco BLC_4) e PL
      por fundo (arquivo PL, mesma data de referencia) do mes-alvo. O mes-alvo
      respeita a defasagem de publicacao da CVM (fundos podem retificar os
      ultimos meses): ate' o dia 15 do mes corrente usa mes atual -5; depois
      do dia 15, usa mes atual -4. Pode ser sobrescrito com -MesAno AAAAMM.
      Alternativa: -XlsxPath para usar um arquivo local (ex: um .xlsx ja'
      ajustado) em vez de baixar da CVM.
    - registro_fundo_classe.zip da CVM -> universo de classes ATIVAS e o
      gestor (via ID_Registro_Fundo -> registro_fundo.csv). Diferente do
      cad_fi.csv (legado, nivel fundo): estes arquivos sao pos-Resolucao CVM
      175, no nivel de CLASSE - a mesma granularidade do CNPJ_FUNDO_CLASSE
      usado no CDA. Validado contra a base atual: 97-98% de acerto direto no
      CNPJ Gestor.

  Saida (para revisao manual):
    tools\Sugestao_Novos.csv             - fundos que batem o criterio e ainda
                                            nao estao em Fundos_12431/Fundos_CDI.
    tools\Sugestao_Remover.csv           - fundos que estao nas abas hoje mas
                                            nao batem mais o criterio (ou
                                            sairam do CDA).
    tools\Sugestao_Lista_Final_12431.csv - lista COMPLETA (nao so' a diferenca)
    tools\Sugestao_Lista_Final_CDI.csv     de quem deveria estar em cada aba,
                                            mesmo esquema de colunas de
                                            Fundos_12431.csv/Fundos_CDI.csv -
                                            pronta pra comparar/substituir.

  Uso: powershell -File selecionar-fundos.ps1
       powershell -File selecionar-fundos.ps1 -MesAno 202603   # mes especifico
       powershell -File selecionar-fundos.ps1 -XlsxPath "C:\...\cda_fi_BLC_...xlsx"
#>

param(
  [string]$MesAno = '',
  [string]$XlsxPath = '',
  [string]$CdaDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cda"),
  [string]$RegistroDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cadastro_fundos"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [double]$LimiarPct = 0.15,
  [string]$OutDir = '',
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'
$NOME_12431_REGEX = '(?i)incentiv|infraestr|\binfra\b|infra[- ]'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

if (-not $OutDir) { $OutDir = $PSScriptRoot }

Write-Host ""
Write-Host "=== Selecionar Fundos (sugestao Fundos_12431 / Fundos_CDI) ===" -ForegroundColor Green

# ---- 1. Ler o CDA (debentures por fundo + PL na mesma data) ---------------
$plPorFundo = $null
if (-not [string]::IsNullOrWhiteSpace($XlsxPath)) {
  Step "Lendo $XlsxPath (pode levar 1-2 min)..."
  $rawRows = Read-CdaFiBlcDebentures $XlsxPath
} else {
  if (-not $MesAno) { $MesAno = Get-CdaTargetMonth }
  Step "Mes-alvo do CDA: $MesAno (defasagem: ate dia 15 -> mes atual -5; depois -> -4)"
  Step "Baixando/lendo cda_fi_$MesAno.zip da CVM..."
  $cdaExtractDir = Get-CdaFiDir $CdaDir $MesAno -NoDownload:$NoDownload
  Step "Lendo cda_fi_BLC_4_$MesAno.csv (debentures, pode levar 1-2 min)..."
  $rawRows = Read-CdaFiBlcCsv (Join-Path $cdaExtractDir "cda_fi_BLC_4_$MesAno.csv")
  Step "Lendo cda_fi_PL_$MesAno.csv (PL por fundo, mesma data de referencia)..."
  $plPorFundo = Read-CdaFiPL (Join-Path $cdaExtractDir "cda_fi_PL_$MesAno.csv")
  Step "  $($plPorFundo.Count) fundos com PL no CDA"
}
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
  # PL do CDA (mesma data de referencia da posicao em debentures) e' mais preciso;
  # cai pro PL do registro_classe.csv (pode ser de outra data) se nao achar no CDA.
  $pl = if ($plPorFundo -and $plPorFundo.ContainsKey($cnpj)) { $plPorFundo[$cnpj] } else { $info.PL }
  if ($pl -le 0) { $semPL++; continue }
  $pct = $debPorFundo[$cnpj] / $pl
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

# ---- 5. Compara com Fundos_12431 / Fundos_CDI atuais (locais) -------------
Step "Lendo Fundos_12431.csv / Fundos_CDI.csv (local) atuais..."
$fg12431Atual = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_12431.csv')
$fgCdiAtual   = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
Step "  Fundos_12431: $($fg12431Atual.map.Count) | Fundos_CDI: $($fgCdiAtual.map.Count)"

# As duas abas devem ser complementares (mutuamente exclusivas). Um CNPJ nos
# dois arquivos ao mesmo tempo e' um erro de curadoria -- avisa explicitamente,
# pois um HashSet uniao (abaixo) esconderia isso silenciosamente.
$duplicados = @($fg12431Atual.map.Keys | Where-Object { $fgCdiAtual.map.ContainsKey($_) })
if ($duplicados.Count -gt 0) {
  Write-Host "    ERRO: $($duplicados.Count) fundo(s) presente(s) em Fundos_12431 E Fundos_CDI ao mesmo tempo:" -ForegroundColor Red
  Write-Host "      $($duplicados -join ', ')" -ForegroundColor Red
  Write-Host "      Corrija tools\Fundos_12431.csv / tools\Fundos_CDI.csv antes de aplicar as sugestoes abaixo." -ForegroundColor Red
}

$atuais = New-Object System.Collections.Generic.HashSet[string]
$fg12431Atual.map.Keys | ForEach-Object { [void]$atuais.Add($_) }
$fgCdiAtual.map.Keys   | ForEach-Object { [void]$atuais.Add($_) }
Step "  $($atuais.Count) fundos distintos nas abas atuais"

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

# Lista final completa (todos os candidatos qualificados, nao so' a diferenca) -
# mesmo esquema de colunas de Fundos_12431.csv/Fundos_CDI.csv (CNPJ_FUNDO_CLASSE,
# DENOM_SOCIAL, CNPJ Gestor), pronta pra substituir/validar contra a planilha.
function Write-ListaFinal($items, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,CNPJ Gestor')
  foreach ($c in ($items | Sort-Object Denom)) {
    [void]$sb.AppendLine(('"{0}","{1}","{2}"' -f $c.Cnpj, $c.Denom.Replace('"', '""'), $c.CnpjGestor))
  }
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
}
$outFinal12431 = Join-Path $OutDir 'Sugestao_Lista_Final_12431.csv'
$outFinalCdi   = Join-Path $OutDir 'Sugestao_Lista_Final_CDI.csv'
Write-ListaFinal (@($candidatos | Where-Object { $_.Segmento -eq '12431' })) $outFinal12431
Write-ListaFinal (@($candidatos | Where-Object { $_.Segmento -eq 'CDI' }))   $outFinalCdi

# ---- 7. Relatorio -----------------------------------------------------------
Write-Host ""
Write-Host "=== RELATORIO ===" -ForegroundColor Green
if ($duplicados.Count -gt 0) {
  Write-Host "  ATENCAO: $($duplicados.Count) fundo(s) duplicado(s) entre Fundos_12431 e Fundos_CDI (ver acima)" -ForegroundColor Red
}
Write-Host "  Fundos qualificados no CDA atual  : $($candidatos.Count) (12431: $n12431 | Tradicional: $nCdi)"
Write-Host "  Novos (nao estao nas abas hoje)    : $($novos.Count)"
Write-Host "  Para remover (nao qualificam mais) : $($removerCnpjs.Count)"
Write-Host ""
Write-Host "  Arquivos gerados (revise antes de aplicar na planilha):" -ForegroundColor White
Write-Host "    $outNovos"       -ForegroundColor Yellow
Write-Host "    $outRemover"     -ForegroundColor Yellow
Write-Host "    $outFinal12431  ($n12431 fundos - lista completa, nao so' a diferenca)" -ForegroundColor Yellow
Write-Host "    $outFinalCdi  ($nCdi fundos - lista completa, nao so' a diferenca)" -ForegroundColor Yellow
Write-Host ""

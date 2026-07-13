<#
  selecionar-fundos.ps1
  --------------------------------------------------------------------------
  Gera uma SUGESTAO de fundos para tools\Fundos_12431.csv / tools\Fundos_CDI.csv
  (arquivos locais, ver sincronizar-fundos-planilha.ps1 se precisar trazer uma
  edicao feita na planilha de volta pro arquivo local), a partir de criterios
  objetivos. Nao substitui a curadoria manual - so' aponta o que revisar (nada
  e' sobrescrito automaticamente).

  Criterios:
    - Primeiro filtro comum: fundo precisa ter > 15% do PL em debentures.
    - Fundo precisa ser elegivel como credito:
        * elegiveis: FIF de Renda Fixa/Multimercado/sem classificacao clara e FIDC.
        * nao elegiveis: Acoes/FIA, FIP, FII/FIIM, FIAGRO, Funcine, Cambial/FMP.
    - PL do fundo precisa ser > R$ 5 milhoes.
    - 12431 (Incentivados): entre os elegiveis, entra se tiver >= 5% do PL em
      debentures Lei 12.431 E nome com indicio de infraestrutura/incentivado;
      ou, mesmo sem nome, se tiver > 20% do PL em debentures Lei 12.431.
    - Tradicional (CDI): o que sobrar depois dos filtros acima.

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
    tools\Sugestao_Candidatos_Novos_12431.csv - nome infra e SEM carteira no CDA
                                            (novos de verdade, a confirmar quando
                                            o CDA alcanca-los).
    tools\Sugestao_Feeders_12431.csv     - nome infra mas com carteira no CDA sem
                                            debenture (investem em cotas de outros
                                            fundos) - excluidos dos candidatos.

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
  [double]$LimiarLei12431Pct = 0.05,
  [double]$LimiarLei12431FortePct = 0.20,
  [double]$MinPl = 5000000,
  [int]$JanelaFeederMeses = 4,
  [string]$DebenturesPath = '',
  [string]$OutDir = '',
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'
# Padrao de nome de fundo incentivado/infra (12.431). Calibrado contra a lista
# curada atual: cobre 98,5% dos 12.431 sem gerar falso-positivo novo no Trad.
# Alem de INCENTIV/INFRAESTR/INFRA, cobre abreviacoes vistas na base:
# "INFR" (sem A) e "DEBENTURES DE INF..." (Ex.: Santander PB, Sellas, Strix).
$NOME_12431_REGEX = 'INCENTIV|INFRAESTR|\bINFRA?\b|INFRA[- ]|DEB\S* DE INF|12\.?431|12431'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

if (-not $OutDir) { $OutDir = $PSScriptRoot }
if (-not $DebenturesPath) { $DebenturesPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\Debentures.csv' }

function Normalize-Text([string]$s) {
  $txt = ([string]$s).Normalize([System.Text.NormalizationForm]::FormD)
  $chars = $txt.ToCharArray() | Where-Object {
    [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark
  }
  return (-join $chars).ToUpperInvariant()
}

function Normalize-Ativo([string]$s) {
  return ([string]$s).Trim().ToUpperInvariant()
}

function Get-PropValue($row, [string]$name) {
  $p = $row.PSObject.Properties[$name]
  if ($p) { return [string]$p.Value }
  return ''
}

function Read-DebenturesLei12431Map([string]$path) {
  if (-not (Test-Path $path)) { throw "Arquivo de cadastro de debentures nao encontrado: $path" }
  $lines = @(Read-AllLinesShared $path ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -lt 2) { throw "Cadastro de debentures vazio: $path" }

  $hdr = Split-CsvLine $lines[0]
  $iAtivo = Find-ColIndex $hdr '(?i)(codigo|c[oó]digo).*ativo'
  $iLei = Find-ColIndex $hdr '(?i)(12\.?431|incent)'
  if ($iAtivo -lt 0 -or $iLei -lt 0) {
    throw "Cadastro de debentures sem colunas Codigo do Ativo / Lei 12.431."
  }
  $colAtivo = $hdr[$iAtivo]
  $colLei = $hdr[$iLei]

  $map = @{}
  foreach ($r in @($lines | ConvertFrom-Csv)) {
    $ativo = Normalize-Ativo (Get-PropValue $r $colAtivo)
    if ($ativo -eq '') { continue }
    $flag = (Get-PropValue $r $colLei).Trim().ToUpperInvariant()
    $map[$ativo] = ($flag -match '^(S|SIM|TRUE|1)$')
  }
  return $map
}

function Test-FundoCreditoElegivel($info) {
  $tipo = Normalize-Text $info.TipoClasse
  $classificacao = Normalize-Text $info.Classificacao
  $denom = Normalize-Text $info.Denom

  if ($tipo -match '\b(FII|FIIM|FIAGRO|FIP|FUNCINE)\b') { return $false }
  if ($denom -match '\b(FII|FIAGRO|FIP|FUNCINE)\b|IMOBILIARIO|PARTICIPACOES') { return $false }
  if ($classificacao -match 'ACOES|CAMBIAL|FMP') { return $false }
  if ($tipo -match '\bFIDC\b') { return $true }
  if ($tipo -match '\bFIF\b') { return $true }
  return $false
}

# Agrega um mes de BLC_4 (debentures) em mapas por fundo: soma total e a parcela
# Lei 12.431. Ativos fora do cadastro de debentures vao pro HashSet $semLei.
# Grava texto sem deixar um arquivo travado (aberto no Excel) abortar o run: se
# nao conseguir escrever, avisa e segue para os proximos arquivos.
function Save-Text([string]$path, [string]$text, $enc) {
  try {
    [System.IO.File]::WriteAllText($path, $text, $enc)
    return $true
  } catch {
    Write-Host "    NAO consegui gravar $([System.IO.Path]::GetFileName($path)) (aberto em outro programa?). Feche e rode de novo." -ForegroundColor Red
    return $false
  }
}

function Get-DebMesMaps($blcRows, [hashtable]$leiMap, $semLei) {
  $debM = @{}; $debLeiM = @{}
  foreach ($r in $blcRows) {
    if ($r.Val -le 0) { continue }
    if ($debM.ContainsKey($r.Cnpj)) { $debM[$r.Cnpj] += $r.Val } else { $debM[$r.Cnpj] = $r.Val }
    $a = Normalize-Ativo $r.Ativo
    if ($a -eq '') { continue }
    if ($leiMap.ContainsKey($a)) {
      if ($leiMap[$a]) {
        if ($debLeiM.ContainsKey($r.Cnpj)) { $debLeiM[$r.Cnpj] += $r.Val } else { $debLeiM[$r.Cnpj] = $r.Val }
      }
    } else { [void]$semLei.Add($a) }
  }
  return @{ Deb = $debM; DebLei = $debLeiM }
}

Write-Host ""
Write-Host "=== Selecionar Fundos (sugestao Fundos_12431 / Fundos_CDI) ===" -ForegroundColor Green

# ---- 1. Lei 12.431 por ativo (para a parcela Lei por fundo) -----------------
Step "Lendo cadastro de debentures para identificar Lei 12.431..."
$lei12431PorAtivo = Read-DebenturesLei12431Map $DebenturesPath
Step "  $($lei12431PorAtivo.Count) ativos no cadastro de debentures"

# ---- 1b. Carteira do CDA: mes-alvo AUTORITATIVO + resgate de novos ----------
# O mes-alvo (defasagem 4-5 meses) e' o mais CONFIAVEL: ja' saiu do prazo de
# sigilo de 90 dias, entao a carteira esta' completa. Ele manda para os fundos
# existentes. A janela (meses seguintes, mais recentes) serve so' para RESGATAR
# fundos NOVOS que ainda nao aparecem no mes-alvo (nasceram depois) - para esses
# usamos a foto mais recente disponivel (o melhor que ha').
# Assim evitamos os dois erros: "maior %" inflava com pico transitorio; "mes mais
# recente" para todo mundo subestimava (posicoes recentes sob sigilo).
#   - fundo no mes-alvo  -> foto do mes-alvo (completa) decide se qualifica;
#   - fundo NOVO (fora do mes-alvo) -> foto mais recente em que declarou;
#   - $carteira = quem tem debenture na sua foto; $filouCda = quem declarou
#     carteira em algum mes (anti-feeder). Um fundo com pico e 0% no mes-alvo
#     NAO e' resgatado (ja' foi visto no alvo com 0 debenture).
$carteira = @{}                                    # cnpj -> @{ Deb; DebLei; PL; Pct }
$filouCda = New-Object System.Collections.Generic.HashSet[string]
$vistos = New-Object System.Collections.Generic.HashSet[string]
$ativosSemCadastroLei = New-Object System.Collections.Generic.HashSet[string]

if (-not [string]::IsNullOrWhiteSpace($XlsxPath)) {
  Step "Lendo $XlsxPath (pode levar 1-2 min)..."
  $maps = Get-DebMesMaps (Read-CdaFiBlcDebentures $XlsxPath) $lei12431PorAtivo $ativosSemCadastroLei
  foreach ($cnpj in $maps.Deb.Keys) {
    $lei = if ($maps.DebLei.ContainsKey($cnpj)) { $maps.DebLei[$cnpj] } else { 0.0 }
    $carteira[$cnpj] = @{ Deb = $maps.Deb[$cnpj]; DebLei = $lei; PL = 0.0; Pct = -1.0 }  # PL do registro
  }
  Step "  $($carteira.Count) fundos com debenture no arquivo (anti-feeder off no fluxo -XlsxPath)"
} else {
  if (-not $MesAno) { $MesAno = Get-CdaTargetMonth }
  $anchor = [datetime]::ParseExact($MesAno + '01', 'yyyyMMdd', $null)
  $mesesJanela = @(0..([Math]::Max(1, $JanelaFeederMeses) - 1) | ForEach-Object { $anchor.AddMonths($_).ToString('yyyyMM') })
  # mes-alvo primeiro (autoritativo); depois os seguintes do mais recente ao mais
  # antigo (resgate de novos, com a foto mais recente disponivel).
  $ordem = @($MesAno) + @($mesesJanela | Where-Object { $_ -ne $MesAno } | Sort-Object -Descending)
  Step "Mes-alvo $MesAno (autoritativo) + resgate: $($ordem -join ', ')"
  foreach ($m in $ordem) {
    try {
      $dirM = Get-CdaFiDir $CdaDir $m -NoDownload:$NoDownload
      Step "  lendo cda_fi_$m (PL + BLC_4 debentures, pode levar 1-2 min)..."
      $plM = Read-CdaFiPL (Join-Path $dirM "cda_fi_PL_$m.csv")
      $maps = Get-DebMesMaps (Read-CdaFiBlcCsv (Join-Path $dirM "cda_fi_BLC_4_$m.csv")) $lei12431PorAtivo $ativosSemCadastroLei
      # Uniao PL + BLC_4: um fundo pode ter debenture no BLC_4 e ficar fora do PL
      # daquele mes -> sem isso ele era descartado em silencio. Incluimos com PL=0
      # e o PL do registro_classe resolve na classificacao (linha ~266).
      $cnpjsMes = New-Object System.Collections.Generic.HashSet[string]
      foreach ($k in $plM.Keys)      { [void]$cnpjsMes.Add($k) }
      foreach ($k in $maps.Deb.Keys) { [void]$cnpjsMes.Add($k) }
      foreach ($cnpj in $cnpjsMes) {
        [void]$filouCda.Add($cnpj)
        if ($vistos.Contains($cnpj)) { continue }   # ja' fixado (mes-alvo ou mes mais recente)
        [void]$vistos.Add($cnpj)
        if ($maps.Deb.ContainsKey($cnpj)) {          # tem debenture nesta foto
          $pl = if ($plM.ContainsKey($cnpj)) { $plM[$cnpj] } else { 0.0 }
          if ($pl -lt 0) { continue }
          $lei = if ($maps.DebLei.ContainsKey($cnpj)) { $maps.DebLei[$cnpj] } else { 0.0 }
          $pct = if ($pl -gt 0) { $maps.Deb[$cnpj] / $pl } else { -1.0 }  # -1 = sem PL do CDA; registro resolve
          $carteira[$cnpj] = @{ Deb = $maps.Deb[$cnpj]; DebLei = $lei; PL = $pl; Pct = $pct }
        }
      }
    } catch {
      Write-Host "    mes $m indisponivel, ignorado ($($_.Exception.Message))" -ForegroundColor DarkGray
    }
  }
  Step "  alvo+resgate: $($filouCda.Count) declararam carteira | $($carteira.Count) com debenture"
}
if ($ativosSemCadastroLei.Count -gt 0) {
  Write-Host "    AVISO: $($ativosSemCadastroLei.Count) ativo(s) do CDA nao apareceram no cadastro de debentures." -ForegroundColor Yellow
}

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
Step "Classificando fundos (> $($LimiarPct*100)% debentures, PL > R$ 5 mi, tipo elegivel)..."
$candidatos = New-Object System.Collections.Generic.List[object]
$semRegistro = 0; $semPL = 0; $abaixoDeb = 0; $plBaixo = 0; $tipoNaoElegivel = 0
$nome12431SemCarteira = 0; $carteira12431SemNome = 0; $carteiraForteSemNome = 0
foreach ($cnpj in $carteira.Keys) {
  if (-not $classeInfo.ContainsKey($cnpj)) { $semRegistro++; continue }
  $info = $classeInfo[$cnpj]
  $snap = $carteira[$cnpj]
  # PL do CDA (mesma data da posicao, melhor mes da janela) e' mais preciso; cai
  # pro PL do registro_classe.csv (fluxo -XlsxPath, sem PL do CDA) se nao houver.
  $pl = if ($snap.PL -gt 0) { $snap.PL } else { $info.PL }
  if ($pl -le 0) { $semPL++; continue }
  $pct = $snap.Deb / $pl
  if ($pct -le $LimiarPct) { $abaixoDeb++; continue }
  if ($pl -le $MinPl) { $plBaixo++; continue }
  if (-not (Test-FundoCreditoElegivel $info)) { $tipoNaoElegivel++; continue }

  $pctLei = $snap.DebLei / $pl
  $nome12431 = [regex]::IsMatch((Normalize-Text $info.Denom), $NOME_12431_REGEX)
  $carteira12431Minima = ($pctLei -ge $LimiarLei12431Pct)
  $carteira12431Forte = ($pctLei -gt $LimiarLei12431FortePct)
  $eh12431 = (($carteira12431Minima -and $nome12431) -or $carteira12431Forte)
  if ($nome12431 -and -not $carteira12431Minima) { $nome12431SemCarteira++ }
  if ($carteira12431Minima -and -not $nome12431 -and -not $carteira12431Forte) { $carteira12431SemNome++ }
  if ($carteira12431Forte -and -not $nome12431) { $carteiraForteSemNome++ }
  $segmento = if ($eh12431) { '12431' } else { 'CDI' }

  $cnpjGestor = if ($fundoGestorCvm.ContainsKey($info.IdFundo)) { $fundoGestorCvm[$info.IdFundo] } else { '' }
  $apelido = if ($cnpjGestor -ne '' -and $gestorApelidoMap.ContainsKey($cnpjGestor)) { $gestorApelidoMap[$cnpjGestor] } else { '' }

  $candidatos.Add([pscustomobject]@{
    Cnpj = $cnpj; Denom = $info.Denom; Segmento = $segmento; PctDeb = $pct; PctLei12431 = $pctLei
    PL = $pl; TipoClasse = $info.TipoClasse; Classificacao = $info.Classificacao
    CnpjGestor = $cnpjGestor; Apelido = $apelido
  })
}
$n12431 = ($candidatos | Where-Object { $_.Segmento -eq '12431' }).Count
$nCdi   = ($candidatos | Where-Object { $_.Segmento -eq 'CDI' }).Count
Step "  $($candidatos.Count) fundos qualificados (12431: $n12431 | CDI nao-isento: $nCdi)"
Step "  excluidos -> sem registro: $semRegistro | sem PL valido: $semPL | <= $($LimiarPct*100)% deb: $abaixoDeb | PL <= R$ 5 mi: $plBaixo | tipo nao elegivel: $tipoNaoElegivel"
Step "  alertas 12431 -> nome sem >= $($LimiarLei12431Pct*100)% Lei 12.431: $nome12431SemCarteira | >= $($LimiarLei12431Pct*100)% e <= $($LimiarLei12431FortePct*100)% Lei 12.431 sem nome: $carteira12431SemNome | > $($LimiarLei12431FortePct*100)% sem nome incluidos: $carteiraForteSemNome"

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
[void]$sbN.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,Segmento,Pct_Debentures,Pct_Lei_12431,PL,Tipo_Classe,Classificacao,CNPJ Gestor,Apelido Gestor')
foreach ($c in ($novos | Sort-Object Segmento, Denom)) {
  $pct = ([Math]::Round($c.PctDeb * 100, 1)).ToString($ci)
  $pctLei = ([Math]::Round($c.PctLei12431 * 100, 1)).ToString($ci)
  $plFmt = ([Math]::Round($c.PL, 2)).ToString($ci)
  [void]$sbN.AppendLine(('"{0}","{1}",{2},{3}%,{4}%,{5},"{6}","{7}","{8}","{9}"' -f $c.Cnpj, ([string]$c.Denom).Replace('"', '""'), $c.Segmento, $pct, $pctLei, $plFmt, ([string]$c.TipoClasse).Replace('"', '""'), ([string]$c.Classificacao).Replace('"', '""'), $c.CnpjGestor, ([string]$c.Apelido).Replace('"', '""')))
}
[void](Save-Text $outNovos $sbN.ToString() $utf8)

$outRemover = Join-Path $OutDir 'Sugestao_Remover.csv'
$sbR = New-Object System.Text.StringBuilder
[void]$sbR.AppendLine('CNPJ_FUNDO_CLASSE,Motivo')
foreach ($cnpj in ($removerCnpjs | Sort-Object)) {
  $motivo = ''
  if (-not $classeInfo.ContainsKey($cnpj)) {
    $motivo = 'nao encontrado como classe ativa no cadastro CVM (cancelado/liquidado?)'
  } elseif (-not $carteira.ContainsKey($cnpj)) {
    $motivo = 'sem posicao em debentures no CDA (janela atual)'
  } else {
    $info = $classeInfo[$cnpj]
    $snap = $carteira[$cnpj]
    $pl = if ($snap.PL -gt 0) { $snap.PL } else { $info.PL }
    if ($pl -le 0) {
      $motivo = 'PL invalido/zerado'
    } elseif (($snap.Deb / $pl) -le $LimiarPct) {
      $motivo = "debentures <= $($LimiarPct*100)% do PL"
    } elseif ($pl -le $MinPl) {
      $motivo = 'PL <= R$ 5 milhoes'
    } elseif (-not (Test-FundoCreditoElegivel $info)) {
      $motivo = "tipo/classificacao nao elegivel ($($info.TipoClasse) / $($info.Classificacao))"
    } else {
      $motivo = 'nao passou nos filtros atuais'
    }
  }
  [void]$sbR.AppendLine(('"{0}","{1}"' -f $cnpj, $motivo))
}
[void](Save-Text $outRemover $sbR.ToString() $utf8)

# Lista final completa (todos os candidatos qualificados, nao so' a diferenca) -
# mesmo esquema de colunas de Fundos_12431.csv/Fundos_CDI.csv (CNPJ_FUNDO_CLASSE,
# DENOM_SOCIAL, CNPJ Gestor), pronta pra substituir/validar contra a planilha.
function Write-ListaFinal($items, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,CNPJ Gestor')
  foreach ($c in ($items | Sort-Object Denom)) {
    [void]$sb.AppendLine(('"{0}","{1}","{2}"' -f $c.Cnpj, $c.Denom.Replace('"', '""'), $c.CnpjGestor))
  }
  [void](Save-Text $outFile $sb.ToString() $utf8)
}
$outFinal12431 = Join-Path $OutDir 'Sugestao_Lista_Final_12431.csv'
$outFinalCdi   = Join-Path $OutDir 'Sugestao_Lista_Final_CDI.csv'
Write-ListaFinal (@($candidatos | Where-Object { $_.Segmento -eq '12431' })) $outFinal12431
Write-ListaFinal (@($candidatos | Where-Object { $_.Segmento -eq 'CDI' }))   $outFinalCdi

# ---- 6b. Candidatos novos (12.431 que ainda nao aparecem no CDA) ------------
# O loop de classificacao acima so' enxerga fundos que JA tem posicao em
# debentures no CDA. Um fundo novo (nascido depois da carteira de referencia)
# fica invisivel ate' o CDA alcanca-lo (defasagem de 4-5 meses) - e' o buraco
# que faz a gente "perder" captacao de fundos de infra recem-lancados.
# Para cobrir isso, varremos o UNIVERSO de classes ativas por NOME (infra/
# incentivado): ativos, PL > MinPl, tipo elegivel, AINDA sem carteira no CDA e
# AINDA fora das abas atuais. E' uma lista de REVISAO MANUAL: o nome sugere
# 12.431, mas sem a carteira nao da' pra confirmar o %debentures.
#
# FILTRO ANTI-FEEDER: no regime CVM 175 explodiram as classes "em cotas" (CIC/
# feeders) que investem em OUTROS fundos de infra, nao em debentures. Pelo nome
# elas batem o regex, mas nao sao detentoras diretas. Um feeder DECLARA carteira
# (aparece no CDA/PL), so' que em cotas - por isso nunca entra em $carteira (que
# vem do BLC_4, so' debentures). Quem tem debenture na janela ($carteira) ja' foi
# classificado acima e (se passou) entra na Lista_Final. Aqui sobra o resto:
#   - declarou carteira ($filouCda) mas nao esta' em $carteira => carteira SEM
#     debenture => FEEDER -> Sugestao_Feeders_12431.csv (nunca aplicado).
#   - nao declarou carteira nenhuma => novo de verdade -> candidato (revisar).
Step "Procurando candidatos novos de 12.431 (nome infra, sem carteira no CDA)..."
$candidatosNovos = New-Object System.Collections.Generic.List[object]
$feedersExcluidos = New-Object System.Collections.Generic.List[object]
foreach ($cnpj in $classeInfo.Keys) {
  if ($carteira.ContainsKey($cnpj)) { continue }      # tem debenture na janela -> classificado acima
  if ($atuais.Contains($cnpj)) { continue }           # ja esta numa aba curada
  $info = $classeInfo[$cnpj]
  if ($info.PL -le $MinPl) { continue }
  if (-not (Test-FundoCreditoElegivel $info)) { continue }
  if (-not [regex]::IsMatch((Normalize-Text $info.Denom), $NOME_12431_REGEX)) { continue }
  $cnpjGestor = if ($fundoGestorCvm.ContainsKey($info.IdFundo)) { $fundoGestorCvm[$info.IdFundo] } else { '' }
  $apelido = if ($cnpjGestor -ne '' -and $gestorApelidoMap.ContainsKey($cnpjGestor)) { $gestorApelidoMap[$cnpjGestor] } else { '' }
  # Declarou carteira em algum mes da janela mas nao tem debenture (senao estaria
  # em $carteira, ja' pulado acima) => feeder.
  if ($filouCda.Count -gt 0 -and $filouCda.Contains($cnpj)) {
    $feedersExcluidos.Add([pscustomobject]@{
      Cnpj = $cnpj; Denom = $info.Denom; PL = $info.PL; TipoClasse = $info.TipoClasse
      CnpjGestor = $cnpjGestor; Apelido = $apelido
    })
    continue
  }
  $candidatosNovos.Add([pscustomobject]@{
    Cnpj = $cnpj; Denom = $info.Denom; PL = $info.PL; Forma = $info.Forma
    TipoClasse = $info.TipoClasse; DataRegistro = $info.DataRegistro; DataInicio = $info.DataInicio
    CnpjGestor = $cnpjGestor; Apelido = $apelido
  })
}
Step "  $($candidatosNovos.Count) candidato(s) novo(s) de 12.431 para revisar (feeders excluidos: $($feedersExcluidos.Count))"
$outCandNovos = Join-Path $OutDir 'Sugestao_Candidatos_Novos_12431.csv'
$sbC = New-Object System.Text.StringBuilder
[void]$sbC.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,Data_Registro,Data_Inicio,Forma_Condominio,PL,Tipo_Classe,CNPJ Gestor,Apelido Gestor')
foreach ($c in ($candidatosNovos | Sort-Object DataRegistro -Descending)) {
  $plFmt = ([Math]::Round($c.PL, 2)).ToString($ci)
  [void]$sbC.AppendLine(('"{0}","{1}","{2}","{3}","{4}",{5},"{6}","{7}","{8}"' -f $c.Cnpj, ([string]$c.Denom).Replace('"', '""'), $c.DataRegistro, $c.DataInicio, $c.Forma, $plFmt, ([string]$c.TipoClasse).Replace('"', '""'), $c.CnpjGestor, ([string]$c.Apelido).Replace('"', '""')))
}
[void](Save-Text $outCandNovos $sbC.ToString() $utf8)

# Feeders excluidos dos candidatos (nome infra, mas carteira sem debenture) -
# gravados a' parte para transparencia/revisao (nada e' descartado em silencio).
$outFeeders = Join-Path $OutDir 'Sugestao_Feeders_12431.csv'
$sbF = New-Object System.Text.StringBuilder
[void]$sbF.AppendLine('CNPJ_FUNDO_CLASSE,DENOM_SOCIAL,PL,Tipo_Classe,CNPJ Gestor,Apelido Gestor,Motivo')
foreach ($c in ($feedersExcluidos | Sort-Object { -$_.PL })) {
  $plFmt = ([Math]::Round($c.PL, 2)).ToString($ci)
  [void]$sbF.AppendLine(('"{0}","{1}",{2},"{3}","{4}","{5}","carteira atual no CDA sem debenture (feeder de cotas ou posicao zerada)"' -f $c.Cnpj, ([string]$c.Denom).Replace('"', '""'), $plFmt, ([string]$c.TipoClasse).Replace('"', '""'), $c.CnpjGestor, ([string]$c.Apelido).Replace('"', '""')))
}
[void](Save-Text $outFeeders $sbF.ToString() $utf8)

# ---- 7. Relatorio -----------------------------------------------------------
Write-Host ""
Write-Host "=== RELATORIO ===" -ForegroundColor Green
if ($duplicados.Count -gt 0) {
  Write-Host "  ATENCAO: $($duplicados.Count) fundo(s) duplicado(s) entre Fundos_12431 e Fundos_CDI (ver acima)" -ForegroundColor Red
}
Write-Host "  Regra base                         : > $($LimiarPct*100)% do PL em debentures, PL > R$ 5 mi, tipo elegivel"
Write-Host "  Regra 12431                        : >= $($LimiarLei12431Pct*100)% Lei 12.431 + nome infra/incentivado; ou > $($LimiarLei12431FortePct*100)% Lei 12.431 mesmo sem nome"
Write-Host "  Fundos qualificados no CDA atual   : $($candidatos.Count) (12431: $n12431 | CDI nao-isento: $nCdi)"
Write-Host "  Novos (nao estao nas abas hoje)    : $($novos.Count)"
Write-Host "  Candidatos novos 12.431 (fora CDA) : $($candidatosNovos.Count) - nome infra, SEM carteira no CDA (novos de verdade, revisar)"
Write-Host "  Feeders excluidos dos candidatos   : $($feedersExcluidos.Count) - nome infra, mas carteira sem debenture (investem em cotas)"
Write-Host "  Para remover (nao qualificam mais) : $($removerCnpjs.Count)"
Write-Host "  Alertas 12431 para revisar         : nome sem carteira=$nome12431SemCarteira | carteira 5%-20% sem nome=$carteira12431SemNome | >20% sem nome incluidos=$carteiraForteSemNome"
Write-Host ""
Write-Host "  Arquivos gerados (revise antes de aplicar na planilha):" -ForegroundColor White
Write-Host "    $outNovos"       -ForegroundColor Yellow
Write-Host "    $outRemover"     -ForegroundColor Yellow
Write-Host "    $outFinal12431  ($n12431 fundos - lista completa, nao so' a diferenca)" -ForegroundColor Yellow
Write-Host "    $outFinalCdi  ($nCdi fundos - lista completa, nao so' a diferenca)" -ForegroundColor Yellow
Write-Host "    $outCandNovos  ($($candidatosNovos.Count) candidatos novos 12.431 - nome infra, sem carteira no CDA)" -ForegroundColor Yellow
Write-Host "    $outFeeders  ($($feedersExcluidos.Count) feeders excluidos - nome infra, carteira sem debenture)" -ForegroundColor Yellow
Write-Host ""

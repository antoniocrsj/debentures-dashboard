<#
  preparar-caixa-potencial.ps1
  --------------------------------------------------------------------------
  MOTOR DE DADOS do Caixa Potencial dos fundos de credito (etapa 1: calculo,
  rastreabilidade e validacao -- SEM interface no dashboard ainda).

  ================= DEFINICAO (fechada) =====================================
  Caixa Potencial Direto = Disponibilidades + Titulos Publicos + Operacoes
  Compromissadas. NAO entram: depositos a prazo/CDB/LCI/LCA/LF/DPGE (titulos
  bancarios), debentures/credito privado, valores a receber, cotas de fundos
  comuns, nem "ativos so' porque sao negociaveis".

  As tres categorias sao identificadas pela STRING de TP_APLIC (nao pelo numero
  do bloco), varrendo todos os blocos BLC_1..8 -- assim pegamos tambem os poucos
  "Titulos Publicos"/"Operacoes Compromissadas" que aparecem no BLC_8.

  ================= CONFID (posicoes confidenciais) =========================
  Arquivos recentes tem posicoes individuais sob sigilo. A CVM publica essas
  posicoes de forma CONSOLIDADA por TP_APLIC em cda_fi_CONFID_AAAAMM.csv (doc.
  oficial CVM, dataset fi-doc-cda: "As aplicacoes sob restricao de
  confidencialidade serao exibidas de forma consolidada no arquivo CONFID").

  REGRA (registrada e verificada empiricamente em 202605): abertos e CONFID sao
  DISJUNTOS por (fundo, categoria) -- somar aberto + CONFID NAO gera dupla
  contagem. No mercado inteiro so' havia 5 sobreposicoes de (fundo, categoria de
  caixa), todas posicoes distintas (parte do titulo publico divulgada, parte
  ainda sob sigilo -- legitimamente aditivas). DT_CONFID_APLIC preenchido num
  bloco aberto = posicao que SAIU do sigilo (ja' esta' no aberto, conta 1x).
  No CONFID o VL fica na coluna 8 (VL_MERC_POS_FINAL), nao na 14.

  Cotas de Fundos no CONFID NAO identificam o fundo investido -> "cotas nao
  identificadas": registradas, mas NAO viram caixa indireto (nao da' pra saber
  se o investido e' fundo caixa).

  ================= FUNDOS CAIXA (look-through) =============================
  Alguns fundos guardam liquidez via cotas de fundos que investem quase tudo em
  caixa. BLC_2 (col 17 CNPJ_FUNDO_CLASSE_COTA) da' a aresta fundo->fundo investido.
    Caixa indireto de uma posicao = valor aplicado no fundo caixa
                                     x fracao de caixa do fundo caixa.
  Classificacao auditavel (fracao de caixa = (direto+indireto)/PL):
    - Fundo caixa CONFIRMADO : >= 90% do PL nas 3 categorias.
    - CANDIDATO a fundo caixa: 75% a 90%.
    - NAO classificado       : < 75% ou dados insuficientes.
  Estabilidade: exige >= 2 meses validos. Fundo novo com 1 mes so' = provisorio.
  Recursao (fundo caixa que investe em outro fundo caixa) com limite de
  profundidade e deteccao de ciclo; o caixa indireto CONFIRMADO so' soma quando
  o fundo investido e' ele mesmo um fundo caixa confirmado.

  ================= ESTIMATIVA ATUAL =======================================
  CDA e' foto mensal. Aproximacao do caixa hoje:
    Caixa Estimado Atual = (%Caixa da ultima carteira valida) x (PL diario mais
    recente do Informe Diario, public/data/Perf_Diario_*.csv).
  O fluxo liquido posterior a' data-base e' mostrado a' parte como "pressao de
  compra posterior" (o dinheiro pode ja' ter sido investido) -- nunca somado.

  ================= UNIVERSOS =============================================
  Feeder (nome infra mas carteira sem debenture, investe em cotas) pode ficar no
  universo de captacao, mas NAO infla o Caixa Potencial consolidado de compra
  direta. Comprador direto = fundo com historico de debenture no BLC_4. Geramos
  duas visoes: "acessivel por fundo" (direto+indireto, pode sobrepor) e
  "consolidado" (conta o ativo final 1x, deduplicando caixa via cotas).

  ================= SAIDA ==================================================
    public/data/Caixa_Potencial_Fundos.csv     (uma linha por fundo)
    public/data/Caixa_Potencial_Gestores.csv   (agregado por gestor)
    public/data/Caixa_Potencial_Meta.json      (hipoteses, limites, totais)
    public/data/Caixa_Potencial_Auditoria.csv  (confirmados/candidatos/
                                                 insuficientes/cotas nao id/
                                                 excluidos do consolidado)

  Uso:
    powershell -File preparar-caixa-potencial.ps1
    powershell -File preparar-caixa-potencial.ps1 -MesesRecentes 202605,202604,202603 -MesRefMadura 202602
    powershell -File preparar-caixa-potencial.ps1 -SelfTest   (testa look-through/ciclos/etc)

  NAO altera a rotina do BLC atual (preparar-blc.ps1): esta e' independente.
#>

param(
  [string[]]$MesesRecentes = @(),      # M-1,M-2,M-3 (auto se vazio)
  [string]$MesRefMadura = '',          # referencia madura (auto se vazio)
  [string]$HistoricoDesde = '',        # inicio do historico de %PL (yyyyMM). Vazio = so' os meses ja' processados (sem download extra). Ex.: 202501 = backfill desde jan/2025
  [string]$CdaDir = ("C:\Projeto Cr" + [char]233 + "dito\CVM _cda"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [double]$LimiarConfirmado = 0.90,
  [double]$LimiarCandidato  = 0.75,
  [double]$TolReconc = 0.05,           # tolerancia de reconciliacao carteira x PL
  [int]$MaxProfundidade = 8,
  [switch]$NoDownload,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

# ─── Categorias de TP_APLIC ────────────────────────────────────────────────
# Comparadas ja' normalizadas (sem acento, upper) para nao depender do latin-1.
# Memoizada: ha' so' ~30 TP_APLIC distintos, mas a funcao e' chamada milhoes de
# vezes (1x por linha de bloco). O cache tira a normalizacao Unicode do hot path.
$script:_aplicCache = @{}
function Norm-Aplic([string]$s) {
  if ($script:_aplicCache.ContainsKey($s)) { return $script:_aplicCache[$s] }
  $t = ([string]$s).Normalize([System.Text.NormalizationForm]::FormD)
  $c = $t.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark }
  $r = ((-join $c).Trim().ToUpperInvariant())
  $script:_aplicCache[$s] = $r
  return $r
}
$CAT_DISP   = Norm-Aplic 'Disponibilidades'
$CAT_TITPUB = Norm-Aplic 'Titulos Publicos'
$CAT_COMPR  = Norm-Aplic 'Operacoes Compromissadas'
$CAT_COTAS  = Norm-Aplic 'Cotas de Fundos'
$CAT_DEB    = Norm-Aplic 'Debentures'
# Passivos/exigibilidades: entram NEGATIVOS na reconciliacao carteira x PL.
$PASSIVOS = @{}
foreach ($p in @(
  'Valores a pagar','Outras operacoes passivas e exigibilidades',
  'Obrigacoes por acoes e outros TVM recebidos em emprestimo',
  'Obrigacoes por compra a termo a pagar','Obrigacoes por venda a termo a entregar',
  'Opcoes - Posicoes lancadas','DIFERENCIAL DE SWAP A PAGAR')) { $PASSIVOS[(Norm-Aplic $p)] = $true }

# ─── Leitor streaming de um arquivo de bloco/CONFID ────────────────────────
# Uma unica passada por arquivo: acumula, por CNPJ do fundo, as 3 categorias de
# caixa, cotas (total + arestas quando ha' CNPJ do investido), debenture (flag
# comprador direto), e ativos/passivos brutos para a reconciliacao com o PL.
# $acc: hashtable cnpj -> objeto acumulador (ver New-Acc). $edges: cnpj -> List.
function New-Acc {
  return [pscustomobject]@{
    Disp=0.0; TitPub=0.0; Compr=0.0; Cotas=0.0; CotasNaoId=0.0
    Ativos=0.0; Passivos=0.0; Deb=0.0; DtComptc=''; TemCarteira=$false
  }
}
function D0($v) { if ($null -eq $v -or $v -eq '') { return 0.0 } return [double]$v }

# Normaliza CNPJ (so' digitos) sem regex — no hot path (1x por linha) e' bem
# mais rapido que o NormCNPJ (-replace '\D','') da lib. Saida identica.
function Fast-NormCNPJ([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return '' }
  $sb = New-Object System.Text.StringBuilder $s.Length
  foreach ($ch in $s.ToCharArray()) { if ($ch -ge '0' -and $ch -le '9') { [void]$sb.Append($ch) } }
  return $sb.ToString()
}

# Fracao de caixa de um fundo (direto + indireto via fundos-caixa), recursiva,
# memoizada, com deteccao de ciclo e limite de profundidade. Hashtables sao por
# referencia -> as mutacoes (frac/indireto/state) persistem entre as chamadas.
# state: 1 = na pilha (ciclo se revisitado), 2 = pronto. Retorna:
#   $null                         -> fundo desconhecido (sem PL/carteira): nao estima
#   @{ frac=..; parcial=$true }   -> ciclo/profundidade: so' caixa direto (quebra)
#   [double]                      -> fracao final
function Get-CaixaFrac {
  param($cnpj,[int]$depth,$pl,$acc,$edges,$frac,$indireto,$state,[double]$limConf,[double]$limCand,[int]$maxProf)
  if ($state.ContainsKey($cnpj) -and $state[$cnpj] -eq 2) { return $frac[$cnpj] }
  if (-not $pl.ContainsKey($cnpj) -or $pl[$cnpj] -le 0 -or -not $acc.ContainsKey($cnpj)) { return $null }
  if (($state.ContainsKey($cnpj) -and $state[$cnpj] -eq 1) -or $depth -gt $maxProf) {
    $a = $acc[$cnpj]
    return @{ frac = (($a.Disp + $a.TitPub + $a.Compr) / $pl[$cnpj]); parcial = $true }
  }
  $state[$cnpj] = 1
  $a = $acc[$cnpj]
  $direto = $a.Disp + $a.TitPub + $a.Compr
  $confInd = 0.0; $candInd = 0.0; $temCiclo = $false; $temTrunc = $false
  if ($edges.ContainsKey($cnpj)) {
    foreach ($e in $edges[$cnpj]) {
      $r = Get-CaixaFrac $e.Cota ($depth+1) $pl $acc $edges $frac $indireto $state $limConf $limCand $maxProf
      if ($null -eq $r) { continue }
      if ($r -is [hashtable]) {
        $fchild = $r.frac
        if ($r.parcial) { if (($depth+1) -gt $maxProf) { $temTrunc=$true } else { $temCiclo=$true } }
      } else { $fchild = $r }
      if     ($fchild -ge $limConf) { $confInd += $e.Val * $fchild }
      elseif ($fchild -ge $limCand) { $candInd += $e.Val * $fchild }
    }
  }
  $fr = ($direto + $confInd) / $pl[$cnpj]
  $frac[$cnpj] = $fr
  $indireto[$cnpj] = @{ Confirmado=$confInd; Candidato=$candInd; Ciclo=$temCiclo; Truncado=$temTrunc }
  $state[$cnpj] = 2
  return $fr
}
function Get-Acc($acc, [string]$cnpj) {
  if (-not $acc.ContainsKey($cnpj)) { $acc[$cnpj] = New-Acc }
  return $acc[$cnpj]
}

function Read-BlocoStream {
  param([string]$path, [hashtable]$acc, [hashtable]$edges, [bool]$isConfid)
  if (-not (Test-Path $path)) { return }
  $enc = [System.Text.Encoding]::GetEncoding('latin1')
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  $fs = [System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,$share)
  $sr = New-Object System.IO.StreamReader($fs,$enc)
  try {
    $hdrLine = $sr.ReadLine()
    if ($null -eq $hdrLine) { return }
    $hdr = $hdrLine.Split(';')
    $ix = @{}
    for ($i=0; $i -lt $hdr.Count; $i++) { $ix[$hdr[$i].Trim()] = $i }
    # Schema PRE-Resolucao CVM 175 (CDA ate' ~2024): CNPJ_FUNDO / CNPJ_FUNDO_COTA
    # (nivel FUNDO). Pos-175: CNPJ_FUNDO_CLASSE / CNPJ_FUNDO_CLASSE_COTA (nivel
    # CLASSE). Aceita os dois -> da' pra ler o historico antigo. TP_APLIC e
    # VL_MERC_POS_FINAL nao mudaram, e as categorias de caixa tem o mesmo nome.
    $iCnpj = $ix['CNPJ_FUNDO_CLASSE']
    if ($null -eq $iCnpj) { $iCnpj = $ix['CNPJ_FUNDO'] }
    $iApl = $ix['TP_APLIC']
    $iVal = $ix['VL_MERC_POS_FINAL']; $iDt = $ix['DT_COMPTC']
    $iCota = -1
    if ($ix.ContainsKey('CNPJ_FUNDO_CLASSE_COTA')) { $iCota = $ix['CNPJ_FUNDO_CLASSE_COTA'] }
    elseif ($ix.ContainsKey('CNPJ_FUNDO_COTA'))    { $iCota = $ix['CNPJ_FUNDO_COTA'] }
    if ($null -eq $iCnpj -or $null -eq $iApl -or $null -eq $iVal) {
      throw "$([System.IO.Path]::GetFileName($path)): colunas CNPJ_FUNDO_CLASSE|CNPJ_FUNDO / TP_APLIC / VL_MERC_POS_FINAL nao encontradas."
    }
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $line = $null
    while ($null -ne ($line = $sr.ReadLine())) {
      if ($line.Length -eq 0) { continue }
      $c = $line.Split(';')
      if ($c.Count -le $iVal) { continue }
      $cnpj = Fast-NormCNPJ $c[$iCnpj]
      if ($cnpj -eq '') { continue }
      $cat = Norm-Aplic $c[$iApl]
      $val = 0.0
      [double]::TryParse($c[$iVal], [System.Globalization.NumberStyles]::Any, $ci, [ref]$val) | Out-Null
      $a = Get-Acc $acc $cnpj
      $a.TemCarteira = $true
      if ($iDt -ge 0 -and $c.Count -gt $iDt -and $a.DtComptc -eq '') { $a.DtComptc = $c[$iDt].Trim() }

      if     ($cat -eq $CAT_DISP)   { $a.Disp   += $val; $a.Ativos += $val }
      elseif ($cat -eq $CAT_TITPUB) { $a.TitPub += $val; $a.Ativos += $val }
      elseif ($cat -eq $CAT_COMPR)  { $a.Compr  += $val; $a.Ativos += $val }
      elseif ($cat -eq $CAT_COTAS)  {
        $a.Ativos += $val
        $cotaCnpj = if ($iCota -ge 0 -and $c.Count -gt $iCota) { Fast-NormCNPJ $c[$iCota] } else { '' }
        if ($isConfid -or $cotaCnpj -eq '') {
          $a.CotasNaoId += $val
        } else {
          $a.Cotas += $val
          if (-not $edges.ContainsKey($cnpj)) { $edges[$cnpj] = New-Object System.Collections.Generic.List[object] }
          $edges[$cnpj].Add([pscustomobject]@{ Cota=$cotaCnpj; Val=$val })
        }
      }
      elseif ($cat -eq $CAT_DEB)    { $a.Deb += $val; $a.Ativos += $val }
      elseif ($PASSIVOS.ContainsKey($cat)) { $a.Passivos += [math]::Abs($val) }
      else { if ($val -ge 0) { $a.Ativos += $val } else { $a.Passivos += [math]::Abs($val) } }
    }
  } finally { $sr.Dispose(); $fs.Dispose() }
}

# ─── Processa um mes: le' PL + blocos + CONFID e monta o modelo do mes ──────
# Retorna @{ Mes; PL(cnpj->pl); Acc(cnpj->acc); Edges(cnpj->list); Frac(cnpj->
# fracaoCaixa); Classe(cnpj->confirmado/candidato/nao); Indireto(cnpj->@{conf;cand;
# ciclo;truncado}); Denom(cnpj->nome) }
function Process-Mes {
  param([string]$mes, [string]$cdaDir, [switch]$NoDownload)
  $dir = Get-CdaFiDir $cdaDir $mes -NoDownload:$NoDownload
  Step "  [$mes] lendo PL..."
  $pl = Read-CdaFiPL (Join-Path $dir "cda_fi_PL_$mes.csv")

  $acc = @{}; $edges = @{}; $denom = @{}
  # nomes dos fundos (para saida) — pega do PL file rapido
  $plPath = Join-Path $dir "cda_fi_PL_$mes.csv"
  $lines = [System.IO.File]::ReadAllLines($plPath, [System.Text.Encoding]::GetEncoding('latin1'))
  $h = $lines[0].Split(';'); $iC = [array]::IndexOf($h,'CNPJ_FUNDO_CLASSE'); $iD = [array]::IndexOf($h,'DENOM_SOCIAL')
  if ($iC -ge 0 -and $iD -ge 0) {   # se o cabecalho mudar, pula os nomes em vez de ler a coluna errada
    for ($i=1; $i -lt $lines.Count; $i++) {
      $c = $lines[$i].Split(';'); if ($c.Count -le $iD) { continue }
      $k = NormCNPJ $c[$iC]; if ($k -ne '' -and -not $denom.ContainsKey($k)) { $denom[$k] = $c[$iD].Trim() }
    }
  }

  foreach ($b in 1..8) {
    $p = Join-Path $dir "cda_fi_BLC_${b}_$mes.csv"
    Step "  [$mes] BLC_$b..."
    Read-BlocoStream -path $p -acc $acc -edges $edges -isConfid:$false
  }
  Step "  [$mes] CONFID..."
  Read-BlocoStream -path (Join-Path $dir "cda_fi_CONFID_$mes.csv") -acc $acc -edges $edges -isConfid:$true

  # Fracao de caixa com recursao memoizada (ciclo + profundidade).
  $frac = @{}; $indireto = @{}; $state = @{}   # state: 1=na pilha,2=pronto
  foreach ($cnpj in @($acc.Keys)) {
    [void](Get-CaixaFrac $cnpj 0 $pl $acc $edges $frac $indireto $state $LimiarConfirmado $LimiarCandidato $MaxProfundidade)
  }

  # Classificacao por mes (com base na fracao final).
  $classe = @{}
  foreach ($cnpj in $frac.Keys) {
    $f = $frac[$cnpj]
    $classe[$cnpj] = if ($f -ge $LimiarConfirmado) { 'confirmado' }
                     elseif ($f -ge $LimiarCandidato) { 'candidato' }
                     else { 'nao' }
  }
  return @{ Mes=$mes; PL=$pl; Acc=$acc; Edges=$edges; Frac=$frac; Classe=$classe; Indireto=$indireto; Denom=$denom }
}

# ─── Validade de (fundo, mes): recencia/qualidade ──────────────────────────
# Nao usa o selo de maturidade do BLC (que mede cobertura de ENTREGA do PL, nao
# abertura/completude da carteira). Um mes e' valido para um fundo se: PL existe
# e > 0; ha' carteira (aberta + confidencial); a carteira reconcilia com o PL
# dentro da tolerancia; e a competencia (DT_COMPTC) bate com o mes.
function Test-MesValido {
  param($modelo, [string]$cnpj)
  if (-not $modelo.PL.ContainsKey($cnpj)) { return @{ Valido=$false; Motivo='sem PL no mes'; Cobertura=$null } }
  $plv = $modelo.PL[$cnpj]
  if ($plv -le 0) { return @{ Valido=$false; Motivo='PL <= 0'; Cobertura=$null } }
  if (-not $modelo.Acc.ContainsKey($cnpj)) { return @{ Valido=$false; Motivo='sem carteira (nem aberta nem confid)'; Cobertura=0 } }
  $a = $modelo.Acc[$cnpj]
  $carteiraLiq = $a.Ativos - $a.Passivos
  $cob = if ($plv -ne 0) { $carteiraLiq / $plv } else { 0 }
  $dtOk = $true
  if ($a.DtComptc -ne '') { $dtOk = $a.DtComptc.Replace('-','').StartsWith($modelo.Mes) }
  if (-not $dtOk) { return @{ Valido=$false; Motivo="competencia $($a.DtComptc) != mes"; Cobertura=[math]::Round($cob,4) } }
  if ([math]::Abs($cob - 1.0) -gt $TolReconc) {
    return @{ Valido=$false; Motivo=("reconciliacao carteira/PL fora ({0:P1})" -f $cob); Cobertura=[math]::Round($cob,4) }
  }
  return @{ Valido=$true; Motivo='ok'; Cobertura=[math]::Round($cob,4) }
}

# ─── SELF-TEST (item 5: look-through, ciclos, fundo nao encontrado, cotas
# confidenciais sem identificacao) ─────────────────────────────────────────
if ($SelfTest) {
  Write-Host ""
  Write-Host "=== SELF-TEST do motor de Caixa Potencial ===" -ForegroundColor Green
  $falhas = 0
  function Assert($cond,[string]$nome,$got=$null) {
    if ($cond) { Write-Host "  [OK]  $nome" -ForegroundColor Green }
    else { Write-Host "  [X]   $nome  (obtido: $got)" -ForegroundColor Red; $script:falhas++ }
  }
  # Modelo sintetico: A investe em B (fundo caixa 100%); C investe em A (cadeia);
  # D<->E ciclo; F investe em fundo inexistente Z; G tem cotas nao identificadas.
  $pl = @{ A=100.0; B=100.0; C=100.0; D=100.0; E=100.0; F=100.0; G=100.0 }
  $acc = @{}
  $acc['A']=New-Acc; $acc['A'].Ativos=100
  $acc['B']=New-Acc; $acc['B'].Disp=100; $acc['B'].Ativos=100          # 100% caixa direto
  $acc['C']=New-Acc; $acc['C'].Ativos=100
  $acc['D']=New-Acc; $acc['D'].Disp=50; $acc['D'].Ativos=100
  $acc['E']=New-Acc; $acc['E'].Disp=50; $acc['E'].Ativos=100
  $acc['F']=New-Acc; $acc['F'].Ativos=100
  $acc['G']=New-Acc; $acc['G'].CotasNaoId=90; $acc['G'].Disp=10; $acc['G'].Ativos=100
  $edges = @{}
  $edges['A']=[System.Collections.Generic.List[object]]@([pscustomobject]@{Cota='B';Val=100})
  $edges['C']=[System.Collections.Generic.List[object]]@([pscustomobject]@{Cota='A';Val=100})
  $edges['D']=[System.Collections.Generic.List[object]]@([pscustomobject]@{Cota='E';Val=50})
  $edges['E']=[System.Collections.Generic.List[object]]@([pscustomobject]@{Cota='D';Val=50})
  $edges['F']=[System.Collections.Generic.List[object]]@([pscustomobject]@{Cota='Z';Val=100})

  $frac=@{}; $indireto=@{}; $state=@{}
  foreach ($k in @($acc.Keys)) { [void](Get-CaixaFrac $k 0 $pl $acc $edges $frac $indireto $state $LimiarConfirmado $LimiarCandidato $MaxProfundidade) }

  Assert ([math]::Abs($frac['B']-1.0) -lt 1e-9) "B e' 100% caixa direto" $frac['B']
  Assert ([math]::Abs($frac['A']-1.0) -lt 1e-9) "A herda 100% de caixa via cota de B (look-through)" $frac['A']
  Assert ([math]::Abs($frac['C']-1.0) -lt 1e-9) "C herda via A->B (recursao multi-nivel)" $frac['C']
  Assert ($frac['F'] -eq 0.0) "F com cota de fundo inexistente (Z) nao estima caixa indireto" $frac['F']
  Assert ($null -eq (Get-CaixaFrac 'Z' 0 $pl $acc $edges $frac $indireto $state $LimiarConfirmado $LimiarCandidato $MaxProfundidade)) "fundo Z inexistente retorna desconhecido (null)" 'null'
  Assert ($frac['D'] -ge 0.5 -and $frac['D'] -lt 1.0) "ciclo D<->E nao explode; D fica com >=50% (direto), sem loop infinito" $frac['D']
  Assert ([math]::Abs($frac['G']-0.10) -lt 1e-9) "G: cotas nao identificadas NAO viram caixa (so' os 10% de disp.)" $frac['G']

  Write-Host ""
  if ($falhas -eq 0) { Write-Host "=== SELF-TEST PASSOU (todos os casos) ===" -ForegroundColor Green; exit 0 }
  else { Write-Host "=== SELF-TEST FALHOU: $falhas caso(s) ===" -ForegroundColor Red; exit 1 }
}

# ═══════════════════ EXECUCAO PRINCIPAL ════════════════════════════════════
Write-Host ""
Write-Host "=== Preparar Caixa Potencial dos fundos de credito ===" -ForegroundColor Green

# Meses: recentes (M-1,M-2,M-3) + referencia madura. Auto pela defasagem da CVM.
if (-not $MesRefMadura) { $MesRefMadura = Get-CdaTargetMonth }             # ex.: 202602
if ($MesesRecentes.Count -eq 0) {
  $ref = [datetime]::ParseExact($MesRefMadura+'01','yyyyMMdd',$null)
  $MesesRecentes = @(3,2,1 | ForEach-Object { $ref.AddMonths($_).ToString('yyyyMM') })  # 202605,04,03
}
# Ordem de processamento: recentes (mais novo -> mais antigo) + madura.
$mesesOrdem = @($MesesRecentes | Sort-Object -Descending) + @($MesRefMadura) | Select-Object -Unique
Step "Meses recentes: $($MesesRecentes -join ', ') | referencia madura: $MesRefMadura"

$modelos = @{}   # mes -> modelo
foreach ($m in $mesesOrdem) {
  Step "Processando CDA $m (PL + BLC_1..8 + CONFID)..."
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $modelos[$m] = Process-Mes -mes $m -cdaDir $CdaDir -NoDownload:$NoDownload
    $sw.Stop()
    Step "  $m pronto em $($sw.Elapsed.TotalSeconds.ToString('F0'))s ($($modelos[$m].PL.Count) fundos com PL)"
  } catch {
    Warn "  mes $m indisponivel/ignorado: $($_.Exception.Message)"
  }
}
if ($modelos.Count -eq 0) { throw "Nenhum mes de CDA disponivel." }

# ─── Cadastro fundo->gestor (mesmo cruzamento do BLC) ──────────────────────
Step "Resolvendo fundo -> gestor (Fundos_12431/Fundos_CDI + Cadastro_Gestores)..."
$fg12431 = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_12431.csv')
$fgCdi   = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
# Fundos de TESOURARIA (posicao propria dos BANCOS, nao dos gestores): tirados do
# universo curado, mesma lista da captacao (tools\Fundos_Tesouraria.csv). Assim
# somem da analise de caixa igual saem da captacao. NAO afeta a aba Debentures
# (alocacao/BLC vem de outro script; as posicoes reais desses fundos continuam).
$tesPath = Join-Path $PSScriptRoot 'Fundos_Tesouraria.csv'
if (Test-Path $tesPath) {
  $nTes = 0
  foreach ($row in (Import-Csv -LiteralPath $tesPath)) {
    $c = NormCNPJ ([string]$row.CNPJ)
    if ($c) { foreach ($m in @($fg12431.map, $fgCdi.map)) { if ($m.ContainsKey($c)) { [void]$m.Remove($c); $nTes++ } } }
  }
  if ($nTes -gt 0) { Step "  tesouraria: removidos $nTes fundo(s) do universo curado (Fundos_Tesouraria.csv)" }
}
$gestorApelido = Get-GestorApelidoMap $CadastroUrl
$fundoGestor = @{}
foreach ($k in $fg12431.map.Keys) { $fundoGestor[$k] = $fg12431.map[$k] }
foreach ($k in $fgCdi.map.Keys)   { $fundoGestor[$k] = $fgCdi.map[$k] }
$fundo2apelido = (Build-FundoApelidoMap $fundoGestor $gestorApelido).map
# Segmento por fundo (12431 x CDI) e universo curado.
$segmento = @{}
foreach ($k in $fg12431.map.Keys) { $segmento[$k] = '12431' }
foreach ($k in $fgCdi.map.Keys)   { $segmento[$k] = 'CDI' }
$universoCurado = New-Object System.Collections.Generic.HashSet[string]
foreach ($k in $segmento.Keys) { [void]$universoCurado.Add($k) }
Step "  universo curado (12431 + CDI): $($universoCurado.Count) fundos"

# ─── Feeders (nome infra, carteira sem debenture) ──────────────────────────
$feederSet = New-Object System.Collections.Generic.HashSet[string]
$feederPath = Join-Path $PSScriptRoot 'Sugestao_Feeders_12431.csv'
if (Test-Path $feederPath) {
  $fl = @(Read-AllLinesShared $feederPath ([System.Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' })
  for ($i=1; $i -lt $fl.Count; $i++) { $cols = Split-CsvLine $fl[$i]; if ($cols.Count -ge 1) { $c=NormCNPJ $cols[0]; if ($c){[void]$feederSet.Add($c)} } }
}
Step "  feeders conhecidos (Sugestao_Feeders_12431.csv): $($feederSet.Count)"

# ─── Comprador direto: fundo com debenture no BLC_4 em qualquer mes ─────────
$compradorDireto = New-Object System.Collections.Generic.HashSet[string]
foreach ($m in $modelos.Keys) { foreach ($cnpj in $modelos[$m].Acc.Keys) {
  if ($modelos[$m].Acc[$cnpj].Deb -gt 0) { [void]$compradorDireto.Add($cnpj) }
}}
Step "  fundos com historico de debenture direta (BLC_4): $($compradorDireto.Count)"

# ─── PL diario mais recente (Informe Diario) por fundo ─────────────────────
function Read-PerfDiario([string]$path) {
  $res = @{}   # cnpj -> @{ PL; Data }
  if (-not (Test-Path $path)) { return $res }
  $enc=[System.Text.Encoding]::UTF8; $share=[System.IO.FileShare]::ReadWrite
  $fs=[System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,$share)
  $sr=New-Object System.IO.StreamReader($fs,$enc)
  try {
    $first=$sr.ReadLine(); if ($null -eq $first) { return $res }   # arquivo vazio
    $hdr=$first.Split(','); $iDia=[array]::IndexOf($hdr,'Dia'); $iC=[array]::IndexOf($hdr,'CNPJ_Fundo'); $iPL=[array]::IndexOf($hdr,'PL')
    if ($iDia -lt 0 -or $iC -lt 0 -or $iPL -lt 0) { return $res }   # cabecalho inesperado
    $ci=[System.Globalization.CultureInfo]::InvariantCulture; $line=$null
    while ($null -ne ($line=$sr.ReadLine())) {
      if ($line.Length -eq 0) { continue }
      $c=$line.Split(','); if ($c.Count -le [Math]::Max($iC,$iPL)) { continue }
      $cnpj=NormCNPJ $c[$iC]; if ($cnpj -eq '') { continue }
      $dia=$c[$iDia].Trim(); $pl=0.0
      [double]::TryParse($c[$iPL],[System.Globalization.NumberStyles]::Any,$ci,[ref]$pl)|Out-Null
      if (-not $res.ContainsKey($cnpj) -or $dia -gt $res[$cnpj].Data) { $res[$cnpj]=@{ PL=$pl; Data=$dia } }
    }
  } finally { $sr.Dispose(); $fs.Dispose() }
  return $res
}
Step "Lendo PL diario mais recente (Perf_Diario_Trad + Perf_Diario_12431)..."
$dataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\data'
$plDiario = @{}
foreach ($f in @('Perf_Diario_Trad.csv','Perf_Diario_12431.csv')) {
  $r = Read-PerfDiario (Join-Path $dataDir $f)
  foreach ($k in $r.Keys) { if (-not $plDiario.ContainsKey($k) -or $r[$k].Data -gt $plDiario[$k].Data) { $plDiario[$k]=$r[$k] } }
}
Step "  $($plDiario.Count) fundos com PL diario"

# ─── Fluxo liquido posterior a' data-base, por fundo (pressao de compra) ────
# flux_t = PL_t - PL_{t-1} x (1 + retorno_t). Acumula de (fim do mes-base) ate' hoje.
function Read-FluxoPorFundo([string]$path, [hashtable]$acumula, [hashtable]$corteData) {
  if (-not (Test-Path $path)) { return }
  $enc=[System.Text.Encoding]::UTF8; $share=[System.IO.FileShare]::ReadWrite
  $fs=[System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,$share)
  $sr=New-Object System.IO.StreamReader($fs,$enc)
  try {
    $first=$sr.ReadLine(); if ($null -eq $first) { return }   # arquivo vazio
    $hdr=$first.Split(','); $iDia=[array]::IndexOf($hdr,'Dia'); $iC=[array]::IndexOf($hdr,'CNPJ_Fundo')
    $iR=[array]::IndexOf($hdr,'RetornoCota'); $iPL=[array]::IndexOf($hdr,'PL')
    if ($iDia -lt 0 -or $iC -lt 0 -or $iR -lt 0 -or $iPL -lt 0) { return }   # cabecalho inesperado
    $ci=[System.Globalization.CultureInfo]::InvariantCulture
    $prevPL=@{}; $line=$null
    while ($null -ne ($line=$sr.ReadLine())) {
      if ($line.Length -eq 0) { continue }
      $c=$line.Split(','); if ($c.Count -le [Math]::Max($iR,$iPL)) { continue }
      $cnpj=NormCNPJ $c[$iC]; if ($cnpj -eq '') { continue }
      $dia=$c[$iDia].Trim()
      $pl=0.0; [double]::TryParse($c[$iPL],[System.Globalization.NumberStyles]::Any,$ci,[ref]$pl)|Out-Null
      $ret=0.0; [double]::TryParse($c[$iR],[System.Globalization.NumberStyles]::Any,$ci,[ref]$ret)|Out-Null
      if ($prevPL.ContainsKey($cnpj)) {
        $corte = if ($corteData.ContainsKey($cnpj)) { $corteData[$cnpj] } else { '' }
        if ($corte -eq '' -or $dia -gt $corte) {
          $fluxo = $pl - ($prevPL[$cnpj] * (1.0 + $ret/100.0))
          if ($acumula.ContainsKey($cnpj)) { $acumula[$cnpj] += $fluxo } else { $acumula[$cnpj] = $fluxo }
        }
      }
      $prevPL[$cnpj]=$pl
    }
  } finally { $sr.Dispose(); $fs.Dispose() }
}

# ─── Escolhe o mes-base valido por fundo (mais recente valido; recua se preciso)
# e monta a tabela por fundo ────────────────────────────────────────────────
$mesesRecentesOrd = @($MesesRecentes | Sort-Object -Descending)
$todosFundos = New-Object System.Collections.Generic.HashSet[string]
foreach ($m in $modelos.Keys) { foreach ($k in $modelos[$m].PL.Keys) { [void]$todosFundos.Add($k) } }
# Foca no universo relevante: curado + qualquer fundo caixa (candidato) que
# apareca como cota de um fundo curado. Para nao explodir a saida com ~20k
# fundos do mercado, a tabela por fundo cobre o universo curado; o motor calcula
# fracao de TODO o mercado (necessario para o look-through), mas so' exportamos
# os relevantes + os fundos-caixa usados como cota.
$fundosSaida = New-Object System.Collections.Generic.HashSet[string]
foreach ($k in $universoCurado) { [void]$fundosSaida.Add($k) }
# adiciona fundos-caixa (confirmado/candidato) que sao cota de algum curado
foreach ($m in $mesesRecentesOrd) { if ($modelos.ContainsKey($m)) {
  foreach ($cnpj in $universoCurado) {
    if ($modelos[$m].Edges.ContainsKey($cnpj)) { foreach ($e in $modelos[$m].Edges[$cnpj]) {
      if ($modelos[$m].Classe.ContainsKey($e.Cota) -and $modelos[$m].Classe[$e.Cota] -ne 'nao') { [void]$fundosSaida.Add($e.Cota) }
    }}
  }
}}
Step "Montando tabela por fundo ($($fundosSaida.Count) fundos: universo curado + fundos-caixa usados como cota)..."

# corte para fluxo posterior = fim do mes-base de cada fundo (definido abaixo).
# Primeiro decidimos o mes-base por fundo, depois computamos o fluxo posterior.
$mesBase = @{}; $validPorFundo = @{}
foreach ($cnpj in $fundosSaida) {
  $escolhido = $null; $val = $null; $vlist=@()
  foreach ($m in ($mesesRecentesOrd + @($MesRefMadura))) {
    if (-not $modelos.ContainsKey($m)) { continue }
    $t = Test-MesValido $modelos[$m] $cnpj
    $vlist += [pscustomobject]@{ Mes=$m; Valido=$t.Valido; Motivo=$t.Motivo; Cobertura=$t.Cobertura }
    if ($t.Valido -and $null -eq $escolhido) { $escolhido=$m; $val=$t }
  }
  $mesBase[$cnpj]=$escolhido; $validPorFundo[$cnpj]=$vlist
}

# Fluxo posterior por fundo: corte = ultimo dia do mes-base.
$corteData=@{}
foreach ($cnpj in $fundosSaida) {
  if ($mesBase[$cnpj]) {
    $mb=$mesBase[$cnpj]; $ano=[int]$mb.Substring(0,4); $mesN=[int]$mb.Substring(4,2)
    $ult=[datetime]::new($ano,$mesN,[datetime]::DaysInMonth($ano,$mesN))
    $corteData[$cnpj]=$ult.ToString('yyyy-MM-dd')
  }
}
Step "Calculando fluxo liquido posterior a' data-base (pressao de compra)..."
$fluxoPosterior=@{}
foreach ($f in @('Perf_Diario_Trad.csv','Perf_Diario_12431.csv')) { Read-FluxoPorFundo (Join-Path $dataDir $f) $fluxoPosterior $corteData }

# Estabilidade: fracao >= candidato em >= 2 meses validos.
function Get-Estabilidade([string]$cnpj) {
  $mesesValidosCaixa = 0; $mesesValidos = 0
  foreach ($v in $validPorFundo[$cnpj]) {
    if (-not $v.Valido) { continue }
    $mesesValidos++
    $mo=$modelos[$v.Mes]
    if ($mo.Frac.ContainsKey($cnpj) -and $mo.Frac[$cnpj] -ge $LimiarCandidato) { $mesesValidosCaixa++ }
  }
  return @{ MesesValidos=$mesesValidos; MesesCaixa=$mesesValidosCaixa }
}

# Monta linhas.
$linhas = New-Object System.Collections.Generic.List[object]
foreach ($cnpj in $fundosSaida) {
  $mb = $mesBase[$cnpj]
  $seg = if ($segmento.ContainsKey($cnpj)) { $segmento[$cnpj] } else { '(fora das listas)' }
  $apelido = if ($fundo2apelido.ContainsKey($cnpj)) { $fundo2apelido[$cnpj] } else { '' }
  $ehFeeder = $feederSet.Contains($cnpj)
  $ehDireto = $compradorDireto.Contains($cnpj)
  $estab = Get-Estabilidade $cnpj
  $plDia = if ($plDiario.ContainsKey($cnpj)) { $plDiario[$cnpj].PL } else { $null }
  $plDiaData = if ($plDiario.ContainsKey($cnpj)) { $plDiario[$cnpj].Data } else { '' }
  $fluxPost = if ($fluxoPosterior.ContainsKey($cnpj)) { [math]::Round($fluxoPosterior[$cnpj],2) } else { $null }

  if (-not $mb) {
    # dados insuficientes em todos os meses
    $motivos = ($validPorFundo[$cnpj] | ForEach-Object { "$($_.Mes):$($_.Motivo)" }) -join '; '
    $nome = ''
    foreach ($m in $mesesOrdem) { if ($modelos.ContainsKey($m) -and $modelos[$m].Denom.ContainsKey($cnpj)) { $nome=$modelos[$m].Denom[$cnpj]; break } }
    $linhas.Add([pscustomobject]@{
      CNPJ=$cnpj; Nome=$nome; Gestor=$apelido; Segmento=$seg; MesBase=''; PL_Carteira=$null
      Disponibilidades=$null; TitulosPublicos=$null; Compromissadas=$null; ParcelaAberta=$null; ParcelaConfid=$null
      CotasNaoIdentificadas=$null; CaixaDireto=$null; CaixaIndiretoConfirmado=$null; CaixaIndiretoCandidato=$null
      CaixaPotencialTotal=$null; PctPL=$null; ClasseFundoCaixa='dados insuficientes'
      PLDiario=$plDia; DataPLDiario=$plDiaData; CaixaEstimadoAtual=$null; FluxoLiquidoPosterior=$fluxPost
      Cobertura=$null; NivelConfianca='baixo'; Feeder=$ehFeeder; CompradorDireto=$ehDireto
      NoConsolidado=$false; Justificativa="sem mes valido -> $motivos"
    })
    continue
  }

  $mo=$modelos[$mb]; $a=$mo.Acc[$cnpj]; $plc=$mo.PL[$cnpj]
  $ind = if ($mo.Indireto.ContainsKey($cnpj)) { $mo.Indireto[$cnpj] } else { @{Confirmado=0.0;Candidato=0.0;Ciclo=$false;Truncado=$false} }
  $caixaDireto = $a.Disp + $a.TitPub + $a.Compr
  $caixaTotal = $caixaDireto + $ind.Confirmado
  $pct = if ($plc -gt 0) { $caixaTotal / $plc } else { 0 }
  $classe = $mo.Classe[$cnpj]
  # Fundo de credito e fundo caixa sao coisas DIFERENTES. Um fundo do universo
  # curado (12.431/CDI) NUNCA e' fundo caixa, mesmo com caixa% alto -- varios sao
  # master/infra com muita compromissada (caixa% ate' >100%). So' os fundos de
  # liquidez FORA das listas (money market/soberano) sao classificados como caixa.
  $ehCurado = $universoCurado.Contains($cnpj)
  if ($ehCurado) {
    $classeTxt = 'nao classificado'
  } else {
    $classeTxt = switch ($classe) { 'confirmado' {'fundo caixa confirmado'} 'candidato' {'candidato a fundo caixa'} default {'nao classificado'} }
    # Estabilidade: so' 1 mes valido -> provisorio; >= 2 meses validos mas caixa
    # em < 2 -> instavel. Marca o rotulo (prefixo 'fundo caixa confirmado'/'candidato'
    # preservado pra contagem).
    if ($classe -ne 'nao') {
      if ($estab.MesesValidos -lt 2) { $classeTxt += ' (provisorio: 1 mes)' }
      elseif ($estab.MesesCaixa -lt 2) { $classeTxt += " (instavel: caixa em $($estab.MesesCaixa) de $($estab.MesesValidos) meses)" }
    }
  }
  $cob = ($a.Ativos - $a.Passivos); $cobR = if ($plc -ne 0) { [math]::Round($cob/$plc,4) } else { $null }
  $caixaEstimado = if ($null -ne $plDia) { [math]::Round($pct * $plDia,2) } else { $null }

  # Nivel de confianca.
  $conf = 'alto'
  if ($estab.MesesValidos -lt 2) { $conf='medio' }
  if (-not $ehCurado -and $classe -ne 'nao' -and $estab.MesesValidos -ge 2 -and $estab.MesesCaixa -lt 2) { $conf='medio' }  # fundo caixa (fora das listas) classificado mas instavel
  if ($a.CotasNaoId -gt 0.10*$plc) { $conf='medio' }
  if ($mb -eq $MesRefMadura -and $mesesRecentesOrd.Count -gt 0) { if ($conf -eq 'alto') { $conf='medio' } }  # so' a madura valida
  if ($ind.Ciclo -or $ind.Truncado) { $conf='medio' }

  # Consolidado (conta 1x): universo curado, exclui feeders. Caixa consolidado =
  # direto + indireto SO' via fundos-caixa FORA do universo (senao a linha do
  # proprio fundo-caixa ja' conta esse caixa -> dupla contagem).
  $noConsol = ($universoCurado.Contains($cnpj) -and -not $ehFeeder)
  $indiretoConsolidavel = 0.0
  if ($mo.Edges.ContainsKey($cnpj)) { foreach ($e in $mo.Edges[$cnpj]) {
    if ($mo.Frac.ContainsKey($e.Cota) -and $mo.Frac[$e.Cota] -ge $LimiarConfirmado -and -not $universoCurado.Contains($e.Cota)) {
      $indiretoConsolidavel += $e.Val * $mo.Frac[$e.Cota]
    }
  }}
  $caixaConsol = if ($noConsol) { $caixaDireto + $indiretoConsolidavel } else { 0.0 }

  $just = @()
  if ($mb -ne $mesesRecentesOrd[0]) { $just += "fallback: mes-base $mb (mes mais recente invalido/indisponivel)" }
  if ($ehFeeder) { $just += 'feeder: no universo de captacao, fora do consolidado de compra direta' }
  if (-not $universoCurado.Contains($cnpj)) { $just += 'fundo-caixa fora das listas: incluido so como cota de fundo curado' }
  if ($ind.Ciclo) { $just += 'ciclo de cotas detectado no look-through (quebrado)' }
  if ($ind.Truncado) { $just += "profundidade de look-through > $MaxProfundidade (truncado)" }
  if ($a.CotasNaoId -gt 0) { $just += ("cotas confidenciais nao identificadas: R$ {0:N0} (nao viram caixa)" -f $a.CotasNaoId) }
  if ($indiretoConsolidavel -gt 0) { $just += 'caixa indireto via fundo-caixa externo somado ao consolidado' }

  $linhas.Add([pscustomobject]@{
    CNPJ=$cnpj; Nome=$mo.Denom[$cnpj]; Gestor=$apelido; Segmento=$seg; MesBase=$mb; PL_Carteira=[math]::Round($plc,2)
    Disponibilidades=[math]::Round($a.Disp,2); TitulosPublicos=[math]::Round($a.TitPub,2); Compromissadas=[math]::Round($a.Compr,2)
    ParcelaAberta=[math]::Round(($a.Disp+$a.TitPub+$a.Compr - 0),2)  # sera' recomputado abaixo por aberto/confid
    ParcelaConfid=$null
    CotasNaoIdentificadas=[math]::Round($a.CotasNaoId,2)
    CaixaDireto=[math]::Round($caixaDireto,2); CaixaIndiretoConfirmado=[math]::Round($ind.Confirmado,2); CaixaIndiretoCandidato=[math]::Round($ind.Candidato,2)
    CaixaPotencialTotal=[math]::Round($caixaTotal,2); PctPL=[math]::Round($pct,4); ClasseFundoCaixa=$classeTxt
    PLDiario=$(if($null -ne $plDia){[math]::Round($plDia,2)}else{$null}); DataPLDiario=$plDiaData
    CaixaEstimadoAtual=$caixaEstimado; FluxoLiquidoPosterior=$fluxPost
    Cobertura=$cobR; NivelConfianca=$conf; Feeder=$ehFeeder; CompradorDireto=$ehDireto
    NoConsolidado=$noConsol; CaixaConsolidado=[math]::Round($caixaConsol,2); Justificativa=($just -join ' | ')
  })
}

# ParcelaAberta/ParcelaConfid: precisamos separar aberto vs confid. Re-le' so' o
# CONFID do mes-base para obter a parcela confidencial de caixa por fundo.
Step "Separando parcela aberta x confidencial (caixa) por fundo..."
$confidCaixa=@{}   # mes -> (cnpj -> caixa confid)
foreach ($mb in ($mesBase.Values | Where-Object { $_ } | Select-Object -Unique)) {
  # best-effort: uma falha aqui (roda depois de todo o calculo pesado, antes de
  # gravar) nao pode matar o run -> degrada com parcela confidencial = 0 no mes.
  try {
    $dir = Get-CdaFiDir $CdaDir $mb -NoDownload:$NoDownload
    $accC=@{}; $edgC=@{}
    Read-BlocoStream -path (Join-Path $dir "cda_fi_CONFID_$mb.csv") -acc $accC -edges $edgC -isConfid:$true
    $mp=@{}; foreach ($k in $accC.Keys) { $mp[$k] = ($accC[$k].Disp+$accC[$k].TitPub+$accC[$k].Compr) }
    $confidCaixa[$mb]=$mp
  } catch {
    Step "  [AVISO] falha ao reler CONFID de ${mb} (parcela confidencial=0 nesse mes): $($_.Exception.Message)"
    $confidCaixa[$mb]=@{}
  }
}
foreach ($ln in $linhas) {
  if ($ln.MesBase -eq '' -or $null -eq $ln.CaixaDireto) { continue }
  $confid = 0.0
  if ($confidCaixa.ContainsKey($ln.MesBase) -and $confidCaixa[$ln.MesBase].ContainsKey($ln.CNPJ)) { $confid = $confidCaixa[$ln.MesBase][$ln.CNPJ] }
  $ln.ParcelaConfid = [math]::Round($confid,2)
  $ln.ParcelaAberta = [math]::Round($ln.CaixaDireto - $confid,2)
}

# ─── Grava Caixa_Potencial_Fundos.csv ──────────────────────────────────────
$ci=[System.Globalization.CultureInfo]::InvariantCulture
$utf8=New-Object System.Text.UTF8Encoding($false)
function Num($v){ if ($null -eq $v) { return '' } return ([double]$v).ToString($ci) }
function Bool($v){ if ($v) { return 'sim' } return 'nao' }
function Q($s){ return '"' + (([string]$s).Replace('"','""')) + '"' }

$sb=New-Object System.Text.StringBuilder
[void]$sb.AppendLine('CNPJ,Nome,Gestor,Segmento,MesBase,PL_Carteira,Disponibilidades,TitulosPublicos,Compromissadas,ParcelaAberta,ParcelaConfid,CotasNaoIdentificadas,CaixaDireto,CaixaIndiretoConfirmado,CaixaIndiretoCandidato,CaixaPotencialTotal,PctPL,ClasseFundoCaixa,PLDiario,DataPLDiario,CaixaEstimadoAtual,FluxoLiquidoPosterior,Cobertura,NivelConfianca,Feeder,CompradorDireto,NoConsolidado,CaixaConsolidado,Justificativa')
foreach ($l in ($linhas | Sort-Object @{e={$_.Segmento}}, @{e={ -(D0 $_.CaixaPotencialTotal) }})) {
  $consol = if ($l.PSObject.Properties['CaixaConsolidado']) { $l.CaixaConsolidado } else { '' }
  [void]$sb.AppendLine( (@(
    (Q $l.CNPJ),(Q $l.Nome),(Q $l.Gestor),(Q $l.Segmento),$l.MesBase,(Num $l.PL_Carteira),
    (Num $l.Disponibilidades),(Num $l.TitulosPublicos),(Num $l.Compromissadas),(Num $l.ParcelaAberta),(Num $l.ParcelaConfid),
    (Num $l.CotasNaoIdentificadas),(Num $l.CaixaDireto),(Num $l.CaixaIndiretoConfirmado),(Num $l.CaixaIndiretoCandidato),
    (Num $l.CaixaPotencialTotal),(Num $l.PctPL),(Q $l.ClasseFundoCaixa),(Num $l.PLDiario),$l.DataPLDiario,
    (Num $l.CaixaEstimadoAtual),(Num $l.FluxoLiquidoPosterior),(Num $l.Cobertura),$l.NivelConfianca,(Bool $l.Feeder),(Bool $l.CompradorDireto),
    (Bool $l.NoConsolidado),(Num $consol),(Q $l.Justificativa)
  ) -join ',') )
}
$outFundos=Join-Path $dataDir 'Caixa_Potencial_Fundos.csv'
[System.IO.File]::WriteAllText($outFundos,$sb.ToString(),$utf8)
Step "Gravado: $outFundos"

# ─── Agregado por gestor ───────────────────────────────────────────────────
$porGestor=@{}
foreach ($l in $linhas) {
  if (-not $l.NoConsolidado) { continue }
  $g = if ($l.Gestor) { $l.Gestor } else { '(sem gestor)' }
  if (-not $porGestor.ContainsKey($g)) { $porGestor[$g]=[pscustomobject]@{ Gestor=$g; NumFundos=0; CaixaConsolidado=0.0; CaixaEstimadoAtual=0.0; PLCarteira=0.0; FluxoPosterior=0.0 } }
  $o=$porGestor[$g]; $o.NumFundos++
  $o.CaixaConsolidado += D0 $l.CaixaConsolidado
  if ($null -ne $l.CaixaEstimadoAtual) { $o.CaixaEstimadoAtual += [double]$l.CaixaEstimadoAtual }
  if ($null -ne $l.PL_Carteira) { $o.PLCarteira += [double]$l.PL_Carteira }
  if ($null -ne $l.FluxoLiquidoPosterior) { $o.FluxoPosterior += [double]$l.FluxoLiquidoPosterior }
}
$sbG=New-Object System.Text.StringBuilder
[void]$sbG.AppendLine('Gestor,NumFundos,PL_Carteira,CaixaConsolidado,PctPL,CaixaEstimadoAtual,FluxoLiquidoPosterior')
foreach ($o in ($porGestor.Values | Sort-Object @{e={ -$_.CaixaConsolidado }})) {
  $pct = if ($o.PLCarteira -gt 0) { $o.CaixaConsolidado/$o.PLCarteira } else { 0 }
  [void]$sbG.AppendLine( (@((Q $o.Gestor),$o.NumFundos,(Num ([math]::Round($o.PLCarteira,2))),(Num ([math]::Round($o.CaixaConsolidado,2))),(Num ([math]::Round($pct,4))),(Num ([math]::Round($o.CaixaEstimadoAtual,2))),(Num ([math]::Round($o.FluxoPosterior,2)))) -join ',') )
}
$outGest=Join-Path $dataDir 'Caixa_Potencial_Gestores.csv'
[System.IO.File]::WriteAllText($outGest,$sbG.ToString(),$utf8)
Step "Gravado: $outGest"

# ─── Auditoria ─────────────────────────────────────────────────────────────
$confirmados = @($linhas | Where-Object { $_.ClasseFundoCaixa -like 'fundo caixa confirmado*' })
$candidatos  = @($linhas | Where-Object { $_.ClasseFundoCaixa -like 'candidato*' })
$insuf       = @($linhas | Where-Object { $_.ClasseFundoCaixa -eq 'dados insuficientes' })
$comCotasNaoId = @($linhas | Where-Object { $null -ne $_.CotasNaoIdentificadas -and [double]$_.CotasNaoIdentificadas -gt 0 })
$excluidosConsol = @($linhas | Where-Object { -not $_.NoConsolidado })
$sbA=New-Object System.Text.StringBuilder
[void]$sbA.AppendLine('Categoria,CNPJ,Nome,Gestor,Segmento,MesBase,PctPL,CaixaPotencialTotal,CotasNaoIdentificadas,NivelConfianca,Justificativa')
function AudRow([string]$cat,$l){ return (@((Q $cat),(Q $l.CNPJ),(Q $l.Nome),(Q $l.Gestor),(Q $l.Segmento),$l.MesBase,(Num $l.PctPL),(Num $l.CaixaPotencialTotal),(Num $l.CotasNaoIdentificadas),$l.NivelConfianca,(Q $l.Justificativa)) -join ',') }
foreach ($l in $confirmados) { [void]$sbA.AppendLine((AudRow 'fundo caixa confirmado' $l)) }
foreach ($l in $candidatos)  { [void]$sbA.AppendLine((AudRow 'candidato a fundo caixa' $l)) }
foreach ($l in $insuf)       { [void]$sbA.AppendLine((AudRow 'dados insuficientes' $l)) }
foreach ($l in $comCotasNaoId) { [void]$sbA.AppendLine((AudRow 'cotas confidenciais nao identificadas' $l)) }
foreach ($l in $excluidosConsol) { [void]$sbA.AppendLine((AudRow 'excluido do consolidado' $l)) }
$outAud=Join-Path $dataDir 'Caixa_Potencial_Auditoria.csv'
[System.IO.File]::WriteAllText($outAud,$sbA.ToString(),$utf8)
Step "Gravado: $outAud"

# ─── Reconciliacao por mes (comparacao mar/abr/mai/madura) ─────────────────
$compMeses = New-Object System.Collections.Generic.List[object]
foreach ($m in ($mesesOrdem | Sort-Object)) {
  if (-not $modelos.ContainsKey($m)) { continue }
  $mo=$modelos[$m]
  $totDisp=0.0;$totTit=0.0;$totComp=0.0;$nConf=0;$nCand=0
  foreach ($cnpj in $universoCurado) {
    if ($mo.Acc.ContainsKey($cnpj)) { $a=$mo.Acc[$cnpj]; $totDisp+=$a.Disp; $totTit+=$a.TitPub; $totComp+=$a.Compr }
    if ($mo.Classe.ContainsKey($cnpj)) { if ($mo.Classe[$cnpj] -eq 'confirmado') { $nConf++ } elseif ($mo.Classe[$cnpj] -eq 'candidato') { $nCand++ } }
  }
  $compMeses.Add([pscustomobject]@{ Mes=$m; Disp=$totDisp; TitPub=$totTit; Compr=$totComp; CaixaDireto=($totDisp+$totTit+$totComp); FundosCaixaConfirmados=$nConf; Candidatos=$nCand })
}

# ─── Historico mensal de %PL (caixa direto / PL) por gestor x segmento ──────
# Passada LEVE (sem look-through): por mes, le PL + 8 blocos + CONFID, soma caixa
# direto (disp+titpub+compr, incl. confid) e PL por fundo do universo curado,
# agrega por (gestor, segmento) e CACHEIA por mes (reprocessa so' o que falta).
# Default (HistoricoDesde vazio) = so' os meses ja' processados, sem download
# extra; -HistoricoDesde 202501 faz o backfill (baixa os meses que faltarem).
# Alimenta o grafico de linha do app (Caixa_Potencial_Historico.json).
try {
  $mesFimHist = (@($modelos.Keys | Sort-Object -Descending))[0]
  $iniHist = if ($HistoricoDesde -ne '') { $HistoricoDesde } else { (@($modelos.Keys | Sort-Object))[0] }
  $ciInv = [System.Globalization.CultureInfo]::InvariantCulture
  $mesesHist = @()
  if ($iniHist -and $mesFimHist) {
    $cur = [datetime]::ParseExact($iniHist,'yyyyMM',$ciInv)
    $fim = [datetime]::ParseExact($mesFimHist,'yyyyMM',$ciInv)
    while ($cur -le $fim) { $mesesHist += $cur.ToString('yyyyMM'); $cur = $cur.AddMonths(1) }
  }
  $histCacheDir = Join-Path $CdaDir 'historico-caixa-cache'
  New-Item -ItemType Directory -Force -Path $histCacheDir | Out-Null
  Step "Historico de %PL: $($mesesHist.Count) mes(es) ($iniHist..$mesFimHist); cache em $histCacheDir"

  $histSeries = New-Object System.Collections.Generic.List[object]
  foreach ($hm in $mesesHist) {
    $cachePath = Join-Path $histCacheDir "$hm.json"
    $rows = $null
    if (Test-Path $cachePath) {
      # Atencao (PS 5.1): ConvertFrom-Json emite o array como UM objeto no pipe,
      # entao `@(... | ConvertFrom-Json)` viraria 1 elemento (o array inteiro) e
      # colapsaria o mes cacheado numa unica linha. Atribui a uma variavel antes
      # de desenrolar com @() -- ai sim vem as N linhas do cache.
      try {
        $parsedCache = Get-Content $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $rows = @($parsedCache | Where-Object { $null -ne $_ })
      } catch { $rows = $null }
    }
    if ($null -eq $rows) {
      $accH = $null; $plH = $null
      if ($modelos.ContainsKey($hm)) {
        $accH = $modelos[$hm].Acc; $plH = $modelos[$hm].PL           # reusa os meses recentes ja' lidos
      } else {
        $dirH = $null
        try { $dirH = Get-CdaFiDir $CdaDir $hm -NoDownload:$NoDownload } catch { $dirH = $null }
        if (-not $dirH) { Warn "  [$hm] CDA indisponivel -- pulado no historico."; continue }
        $plH = Read-CdaFiPL (Join-Path $dirH "cda_fi_PL_$hm.csv")
        $accH = @{}; $edgesH = @{}
        foreach ($b in 1..8) { Read-BlocoStream -path (Join-Path $dirH "cda_fi_BLC_${b}_$hm.csv") -acc $accH -edges $edgesH -isConfid:$false }
        Read-BlocoStream -path (Join-Path $dirH "cda_fi_CONFID_$hm.csv") -acc $accH -edges $edgesH -isConfid:$true
        Step "  [$hm] historico: lido do CDA."
      }
      $buck = @{}
      foreach ($cnpj in $accH.Keys) {
        if (-not $segmento.ContainsKey($cnpj)) { continue }          # so' universo curado (12431 + CDI)
        $plv = if ($plH.ContainsKey($cnpj)) { [double]$plH[$cnpj] } else { 0.0 }
        if ($plv -le 0) { continue }
        $seg = $segmento[$cnpj]
        $g = if ($fundo2apelido.ContainsKey($cnpj) -and $fundo2apelido[$cnpj] -ne '') { $fundo2apelido[$cnpj] } else { '(sem gestor)' }
        $a = $accH[$cnpj]
        $cx = $a.Disp + $a.TitPub + $a.Compr
        $key = "$g|$seg"
        if (-not $buck.ContainsKey($key)) { $buck[$key] = @{ gestor=$g; segmento=$seg; caixa=0.0; pl=0.0 } }
        $buck[$key].caixa += $cx; $buck[$key].pl += $plv
      }
      $rows = @($buck.Values | ForEach-Object { [pscustomobject]@{ gestor=$_.gestor; segmento=$_.segmento; caixa=[math]::Round($_.caixa,2); pl=[math]::Round($_.pl,2) } })
      $json = if ($rows.Count -gt 0) { $rows | ConvertTo-Json -Depth 5 -Compress } else { '[]' }
      [System.IO.File]::WriteAllText($cachePath, $json, $utf8)
    }
    foreach ($r in $rows) {
      $histSeries.Add([pscustomobject]@{ mes=$hm; gestor=$r.gestor; segmento=$r.segmento; caixa=$r.caixa; pl=$r.pl })
    }
  }

  $histObj = [ordered]@{ updatedAt=(Get-Date).ToString('s'); meses=@($mesesHist); series=$histSeries }
  $outHist = Join-Path $dataDir 'Caixa_Potencial_Historico.json'
  [System.IO.File]::WriteAllText($outHist, ($histObj | ConvertTo-Json -Depth 5 -Compress), $utf8)
  Step "Gravado: $outHist ($($histSeries.Count) linhas, $($mesesHist.Count) meses)"
}
catch {
  Warn "Historico de %PL falhou (nao-fatal): $($_.Exception.Message)"
}

# ─── Meta.json ─────────────────────────────────────────────────────────────
$totConsol = ($linhas | Where-Object { $_.NoConsolidado } | ForEach-Object { D0 $_.CaixaConsolidado } | Measure-Object -Sum).Sum
$totEstimado = ($linhas | Where-Object { $_.NoConsolidado -and $null -ne $_.CaixaEstimadoAtual } | ForEach-Object { [double]$_.CaixaEstimadoAtual } | Measure-Object -Sum).Sum
$missingDiario = @($universoCurado | Where-Object { -not $plDiario.ContainsKey($_) })
$meta=[ordered]@{
  updatedAt=(Get-Date).ToString('s')
  definicao='Caixa Potencial Direto = Disponibilidades + Titulos Publicos + Operacoes Compromissadas (por TP_APLIC, todos os blocos). Nao inclui titulos bancarios/CDB/LCI/LCA/LF/DPGE, credito privado/debentures, valores a receber nem cotas comuns.'
  mesesRecentes=$MesesRecentes
  mesRefMadura=$MesRefMadura
  mesesProcessados=@($modelos.Keys | Sort-Object)
  limiares=@{ confirmado=$LimiarConfirmado; candidato=$LimiarCandidato; tolReconciliacao=$TolReconc; maxProfundidadeLookThrough=$MaxProfundidade }
  regras=@(
    'CONFID somado aos blocos abertos sem dupla contagem (disjuntos por fundo+categoria; doc. oficial CVM fi-doc-cda). VL no CONFID esta na coluna 8.',
    'Look-through via BLC_2 (CNPJ_FUNDO_CLASSE_COTA). Cotas no CONFID nao identificam o investido -> cotas nao identificadas, sem estimativa de caixa indireto.',
    'Caixa indireto confirmado soma so quando o fundo investido e fundo caixa confirmado (>=90%). Recursao memoizada com deteccao de ciclo e limite de profundidade.',
    'Mes-base por fundo = mes recente mais novo VALIDO (PL>0, carteira reconcilia com PL, competencia bate). Recuo individual para o mes anterior quando invalido.',
    'Caixa Estimado Atual = %Caixa da carteira valida x PL diario mais recente (Informe Diario). Fluxo liquido posterior mostrado a parte (pressao de compra), nunca somado ao caixa.',
    'Consolidado conta o ativo final 1x: universo curado sem feeders; caixa indireto so via fundo-caixa FORA do universo (evita dupla contagem com a linha do proprio fundo-caixa).'
  )
  totais=@{
    fundosNaTabela=$linhas.Count
    fundosCaixaConfirmados=$confirmados.Count
    candidatos=$candidatos.Count
    dadosInsuficientes=$insuf.Count
    comCotasNaoIdentificadas=$comCotasNaoId.Count
    excluidosDoConsolidado=$excluidosConsol.Count
    caixaConsolidadoDataBase=[math]::Round(($totConsol),2)
    caixaEstimadoAtualConsolidado=[math]::Round(($totEstimado),2)
  }
  comparacaoMeses=$compMeses
  discrepancia_839_835=@{
    descricao='Fundos_CDI.csv tem 839 fundos; Fluxo_Atualizacao.json (trad) processou 835 no Informe Diario. Gap = 4 fundos sem serie diaria.'
    fundosSemSerieDiaria=@($missingDiario)
  }
  limitacoes=@(
    'CDA e foto mensal com defasagem de 4-5 meses; o mes recente pode ainda estar enchendo (posicoes recentes sob sigilo entram consolidadas no CONFID).',
    'Cotas confidenciais nao sao atribuidas a fundo investido -> possivel subestimacao do caixa indireto de fundos que usam fundos-caixa e reportaram sob sigilo.',
    'Reconciliacao carteira x PL trata passivos por lista de TP_APLIC; opcoes lancadas e derivativos sao aproximados -> cobertura e um indicador de qualidade, nao um balanco exato.',
    'Comprador direto = teve debenture no BLC_4 na janela processada; um fundo novo ainda invisivel no CDA pode nao estar marcado.',
    'Fluxo liquido posterior derivado de dPL e retorno da cota (Perf_Diario); dividendos/coticoes atipicas podem gerar ruido diario.'
  )
  fontes=@{ cda='C:\Projeto Credito\CVM _cda (cda_fi_AAAAMM.zip)'; plDiario='public/data/Perf_Diario_{Trad,12431}.csv'; cadastro='Fundos_12431.csv/Fundos_CDI.csv + Cadastro_Gestores' }
}
$outMeta=Join-Path $dataDir 'Caixa_Potencial_Meta.json'
[System.IO.File]::WriteAllText($outMeta,($meta|ConvertTo-Json -Depth 6),$utf8)
Step "Gravado: $outMeta"

# ─── Relatorio de console ──────────────────────────────────────────────────
Write-Host ""
Write-Host "=== RESUMO ===" -ForegroundColor Green
Write-Host ("  Fundos na tabela            : {0}" -f $linhas.Count)
Write-Host ("  Fundos caixa confirmados    : {0}" -f $confirmados.Count)
Write-Host ("  Candidatos a fundo caixa    : {0}" -f $candidatos.Count)
Write-Host ("  Dados insuficientes         : {0}" -f $insuf.Count)
Write-Host ("  Com cotas nao identificadas : {0}" -f $comCotasNaoId.Count)
Write-Host ("  Excluidos do consolidado    : {0}" -f $excluidosConsol.Count)
Write-Host ("  Caixa consolidado (data-base): R$ {0:N1} bi" -f ($totConsol/1e9))
Write-Host ("  Caixa estimado atual        : R$ {0:N1} bi" -f ($totEstimado/1e9))
Write-Host ""
Write-Host "  Comparacao por mes (universo curado):" -ForegroundColor White
foreach ($c in $compMeses) { Write-Host ("    {0}: caixa direto R$ {1,7:N1} bi | confirmados {2} | candidatos {3}" -f $c.Mes, ($c.CaixaDireto/1e9), $c.FundosCaixaConfirmados, $c.Candidatos) }
Write-Host ""
Write-Host "  Discrepancia 839 vs 835: 4 fundos da lista CDI sem serie no Informe Diario:" -ForegroundColor White
foreach ($m in $missingDiario) { Write-Host "    - $m" -ForegroundColor DarkGray }
Write-Host ""
Write-Host "=== PRONTO ===" -ForegroundColor Green

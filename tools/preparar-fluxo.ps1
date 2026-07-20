<#
  preparar-fluxo.ps1
  --------------------------------------------------------------------------
  Gera as bases SEMANAIS de captacao/resgate da aba "Captacao" a partir do
  Informe Diario de Fundos da CVM.

  Fonte CVM: https://dados.cvm.gov.br/dataset/fi-doc-inf_diario
  Arquivos:  inf_diario_fi_AAAAMM.zip  (CSV ; latin-1)
  Colunas usadas: CNPJ_FUNDO_CLASSE (ou CNPJ_FUNDO), DT_COMPTC,
                  VL_PATRIM_LIQ, CAPTC_DIA, RESG_DIA, VL_QUOTA

  O que faz:
    1. Resolve CNPJ_FUNDO_CLASSE -> Gestor_Apelido (ver lib-cadastro.ps1):
         tools\Fundos_12431.csv / tools\Fundos_CDI.csv (local, CNPJ_FUNDO_CLASSE -> CNPJ Gestor)
         GAS sheet=Cadastro_Gestores                    (CNPJ Gestor -> Apelido Gestor)
    2. Baixa os meses do Informe Diario (cache local, nao rebaixa).
    3. Calcula o fluxo SEMANAL (segunda a domingo) por gestor.
    4. Calcula a rentabilidade por gestor (retorno da cota ponderado pelo PL de
       cada fundo, comparado ao CDI do mesmo periodo) nas janelas moveis
       1 semana / 1 / 3 / 6 / 12 meses, contadas a partir do dado mais recente.
    5. Grava em public\data\:
         Fluxo_Semanal_12431.csv / Fluxo_Semanal_Trad.csv
           Colunas: Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos,DataBase
         Fluxo_Rentabilidade_12431.csv / Fluxo_Rentabilidade_Trad.csv
           Colunas: Gestor_Apelido,Retorno_1s,Retorno_1m,Retorno_3m,Retorno_6m,Retorno_12m,
                    PctCDI_1s,PctCDI_1m,PctCDI_3m,PctCDI_6m,PctCDI_12m,DataBase
           (Retorno e PctCDI ja' em pontos percentuais, ex 1.23 = 1,23%. Celula
            vazia = sem historico suficiente para aquela janela ainda.)
         Fluxo_Semanal_Fundos_12431.csv / Fluxo_Semanal_Trad.csv (por fundo)
           Colunas: Semana,CNPJ_Fundo,Gestor_Apelido,Captacao,Resgate,PL_Medio,DataBase
         Fluxo_Fundos_12431.csv / Fluxo_Fundos_Trad.csv (um registro por fundo)
           Colunas: CNPJ_Fundo,Nome_Fundo,Gestor_Apelido,PctCDI_1s..PctCDI_12m
           (%CDI do PROPRIO fundo - cota do fundo vs CDI, nao ponderado.)
       Os dois arquivos por fundo alimentam a tabela de fundos que abre ao
       clicar numa gestora na Captacao (mesmas colunas do ranking de gestores).
         Fluxo_Diario_12431.csv / Fluxo_Diario_Trad.csv (por dia|gestor)
           Colunas: Dia,Gestor_Apelido,Captacao,Resgate,Liquido,PL,Num_Fundos
         Perf_Diario_12431.csv / Perf_Diario_Trad.csv (retorno da cota por dia)
           Colunas: Dia,CNPJ_Fundo,Gestor_Apelido,RetornoCota,PL (janela ~40 dias)
       Essas bases diarias alimentam o "Resumo do Dia" (relatorio diario).
       Tambem grava public\PL_Gestores.csv (PL mais recente por gestor, consumido
       pela aba Gestores do app) e public\data\Fluxo_Atualizacao.json (resumo
       estruturado desta rodada, usado pelo painel de controle web).

       Com -IncluirCandidatos: ALEM da curadoria oficial, tambem busca a
       captacao diaria do UNIVERSO CANDIDATO mais largo (tools\Universo_Candidatos.csv,
       gerado por selecionar-fundos.ps1 -LimiarCandidatosPct, default piso 10%).
       Grava public\data\Fluxo_Diario_Candidatos.csv (Dia,CNPJ_Fundo,Captacao,
       Resgate,Liquido,PL - um registro por fundo por dia, sem agregar por
       gestor). E' consumido por tools\gerar-sensibilidade-corte.mjs para varrer
       o corte de %Deb (10%-80%) e mostrar como a captacao responderia a cada
       corte, sem afetar a curadoria oficial (Fundos_12431/CDI.csv) nem os
       arquivos Fluxo_Diario_12431/Trad.csv que o app usa hoje. Opt-in: baixa
       mais fundos do Informe Diario (mais tempo/disco); off por padrao.

  Uso: clique 2x em preparar-fluxo.bat, ou:
       powershell -File preparar-fluxo.ps1 -Meses 202504,202505
       powershell -File preparar-fluxo.ps1 -Incremental   # rapido: so mes atual + anterior
       powershell -File preparar-fluxo.ps1 -IncluirCandidatos   # + universo p/ sensibilidade de corte
#>

param(
  [string[]]$Meses,                                   # ex: 202504,202505 (default: ultimos 12 meses)
  # "C:\Projeto Credito\CVM _informe_diario" - [char]233 = e-acento (mantem o .ps1 em ASCII)
  [string]$CvmDir    = ("C:\Projeto Cr" + [char]233 + "dito\CVM _informe_diario"),
  [string]$CadastroUrl = 'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec',
  [string]$OutDir,
  [switch]$NoDownload,                                # usa apenas os zips ja baixados (nao baixa nada)
  [switch]$Incremental,                                # so processa mes atual + anterior; mescla com CSV existente
  [switch]$IncluirCandidatos                          # + captacao diaria do universo candidato (sensibilidade de corte)
)

$ErrorActionPreference = 'Stop'
$CVM_BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS'

. (Join-Path $PSScriptRoot 'lib-cadastro.ps1')

# Defaults relativos ao script
if (-not $OutDir) { $OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\data' }
$PublicDir = Split-Path $OutDir -Parent
if (-not $Meses) {
  if ($Incremental) {
    # Modo rapido: apenas os 2 meses mais recentes
    $Meses = @((Get-Date).ToString('yyyyMM'), (Get-Date).AddMonths(-1).ToString('yyyyMM'))
  } else {
    $Meses = 0..11 | ForEach-Object { (Get-Date).AddMonths(-$_).ToString('yyyyMM') }
  }
}

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

# Meses que PODEM ter dias novos: o corrente e, nos primeiros dias, o anterior.
# No modo Incremental forcamos sempre os 2 meses processados.
if ($Incremental) {
  $script:ForceMonths = $Meses
} else {
  $script:ForceMonths = @((Get-Date).ToString('yyyyMM'))
  if ((Get-Date).Day -le 5) { $script:ForceMonths += (Get-Date).AddMonths(-1).ToString('yyyyMM') }
}

function Ensure-Month($yyyymm) {
  $zip = Join-Path $CvmDir "inf_diario_fi_$yyyymm.zip"
  $mustRefresh = $script:ForceMonths -contains $yyyymm
  if (Test-Path $zip) {
    if (-not $mustRefresh) { return $zip }
    if ($NoDownload) { return $zip }
    # Modo incremental: sempre re-baixa os meses forcados (CVM atualiza o zip do mes corrente ao longo do dia).
    # Modo normal: evita re-baixar o mesmo zip mais de uma vez no dia.
    if (-not $Incremental -and (Get-Item $zip).LastWriteTime.Date -eq (Get-Date).Date) { return $zip }
  }
  if ($NoDownload) {
    Write-Host "    $yyyymm sem cache e -NoDownload ativo (pulando)." -ForegroundColor Yellow
    return $null
  }
  $url = "$CVM_BASE/inf_diario_fi_$yyyymm.zip"
  $tmp = "$zip.tmp"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 180 -UseBasicParsing
    Move-Item $tmp $zip -Force
    return $zip
  } catch {
    Write-Host "    $yyyymm indisponivel (pulando): $($_.Exception.Message)" -ForegroundColor Yellow
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    if (Test-Path $zip) { return $zip }
    return $null
  }
}

function WeekStart([datetime]$date) {
  $off = ([int]$date.DayOfWeek + 6) % 7
  return $date.AddDays(-$off)
}

# ─── Merge incremental ────────────────────────────────────────────────────────
# Mescla historico do CSV antigo (fora do periodo reprocessado) com o CSV novo.
#
# Regra: mantem uma linha antiga SE E SOMENTE SE a sua chave (semana ou mes) nao
# foi recalculada nesta rodada (nao esta em $newKeys). Isso evita 2 problemas de
# uma versao anterior baseada em corte de data:
#   1. Nao duplica linhas (uma chave nunca vem de "antigo" E "novo" ao mesmo tempo).
#   2. A semana que atravessa a fronteira do mes mais antigo reprocessado (quando
#      esse mes nao comeca numa segunda-feira) e' removida do calculo novo ANTES
#      de chegar aqui (ver bloco logo abaixo) - como ela nao esta em $newKeys,
#      o valor antigo (completo, de um run anterior) e' preservado automaticamente
#      em vez de ser sobrescrito por um recalculo incompleto.

function Merge-Semanal($oldLines, $outFile, $newKeys) {
  if ($oldLines.Count -lt 2) { return }
  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $weekStr = $line.Split(',')[0].Trim('"')
    if (-not $newKeys.Contains($weekStr)) { $kept.Add($line) }
  }
  if ($kept.Count -eq 0) { return }

  $newLines = [System.IO.File]::ReadAllLines($outFile)
  $merged = [System.Collections.Generic.List[string]]::new()
  $merged.Add($newLines[0])
  $merged.AddRange($kept)
  for ($i = 1; $i -lt $newLines.Count; $i++) {
    if ($newLines[$i].Trim() -ne '') { $merged.Add($newLines[$i]) }
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($outFile, $merged.ToArray(), $utf8)
  Write-Host "    +$($kept.Count) linhas historicas mescladas." -ForegroundColor DarkGray
}

function Merge-Mensal($oldLines, $outFile, $newKeys) {
  if ($oldLines.Count -lt 2) { return }
  $kept = [System.Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $oldLines.Count; $i++) {
    $line = $oldLines[$i]; if ($line.Trim() -eq '') { continue }
    $mesStr = $line.Split(',')[0].Trim('"')
    if (-not $newKeys.Contains($mesStr)) { $kept.Add($line) }
  }
  if ($kept.Count -eq 0) { return }

  $newLines = [System.IO.File]::ReadAllLines($outFile)
  $merged = [System.Collections.Generic.List[string]]::new()
  $merged.Add($newLines[0])
  $merged.AddRange($kept)
  for ($i = 1; $i -lt $newLines.Count; $i++) {
    if ($newLines[$i].Trim() -ne '') { $merged.Add($newLines[$i]) }
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($outFile, $merged.ToArray(), $utf8)
  Write-Host "    +$($kept.Count) linhas historicas mescladas (mensal)." -ForegroundColor DarkGray
}
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Preparar bases de Captacao (Fluxo Semanal) ===" -ForegroundColor Green
if ($Incremental) { Write-Host "  Modo: INCREMENTAL (apenas $($Meses -join ', '))" -ForegroundColor Cyan }
New-Item -ItemType Directory -Force -Path $CvmDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1. Resolve CNPJ_FUNDO_CLASSE -> Apelido_Gestor (Fundos_12431/Fundos_CDI locais + Cadastro_Gestores)
Step "Lendo Fundos_12431.csv / Fundos_CDI.csv (local) e buscando Cadastro_Gestores no cadastro..."
$fg12431 = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_12431.csv')
$fgCdi   = Read-FundosGestorCsv (Join-Path $PSScriptRoot 'Fundos_CDI.csv')
$gestorApelidoMap = Get-GestorApelidoMap $CadastroUrl
Write-Host "    Fundos_12431: $($fg12431.map.Count) | Fundos_CDI: $($fgCdi.map.Count) | Cadastro_Gestores: $($gestorApelidoMap.Count) gestoras"

$bridge12431 = Build-FundoApelidoMap $fg12431.map $gestorApelidoMap
$bridgeCdi   = Build-FundoApelidoMap $fgCdi.map   $gestorApelidoMap
Write-Host "    12431: $($bridge12431.map.Count) fundos resolvidos | Tradicional: $($bridgeCdi.map.Count) fundos resolvidos"
if ($bridge12431.semGestorCadastrado -gt 0 -or $bridgeCdi.semGestorCadastrado -gt 0) {
  Write-Host "      fundos com CNPJ Gestor sem cadastro em Cadastro_Gestores -> 12431: $($bridge12431.semGestorCadastrado) | Trad: $($bridgeCdi.semGestorCadastrado)" -ForegroundColor Yellow
  $faltando = @($bridge12431.gestoresFaltando) + @($bridgeCdi.gestoresFaltando) | Sort-Object -Unique
  if ($faltando.Count) { Write-Host "        CNPJs de gestor ausentes: $($faltando -join ', ')" -ForegroundColor DarkYellow }
}
if ($bridge12431.map.Count -eq 0 -and $bridgeCdi.map.Count -eq 0) {
  throw "Nenhum fundo resolvido. Verifique tools\Fundos_12431.csv / tools\Fundos_CDI.csv (coluna CNPJ Gestor) e Cadastro_Gestores."
}

# Exclusao de fundos de TESOURARIA (posicao propria dos BANCOS, nao dos gestores):
# os fluxos deles NAO sao captacao de cliente e distorcem a analise. Lista curada em
# tools\Fundos_Tesouraria.csv (colunas CNPJ,Apelido,Nome). Removidos do universo
# AQUI (antes da meta e dos agregados) -> saem do semanal/mensal/fundos/diario e
# da rentabilidade. So' afeta a Captacao (caixa/vencimentos usam outra base).
$excluirTes = New-Object System.Collections.Generic.HashSet[string]
$tesPath = Join-Path $PSScriptRoot 'Fundos_Tesouraria.csv'
if (Test-Path $tesPath) {
  foreach ($row in (Import-Csv -LiteralPath $tesPath)) {
    $c = NormCNPJ ([string]$row.CNPJ)
    if ($c) { [void]$excluirTes.Add($c) }
  }
}
if ($excluirTes.Count -gt 0) {
  $nRem = 0
  foreach ($m in @($fg12431.map, $fgCdi.map, $bridge12431.map, $bridgeCdi.map)) {
    if ($null -eq $m) { continue }
    foreach ($c in @($excluirTes)) { if ($m.ContainsKey($c)) { [void]$m.Remove($c); $nRem++ } }
  }
  Step "Tesouraria: $($excluirTes.Count) CNPJ(s) na lista de exclusao; removidos $nRem registro(s) do universo de captacao."
}

# Universo candidato (sensibilidade de corte de %Deb): opt-in, le
# tools\Universo_Candidatos.csv (gerado por selecionar-fundos.ps1) e monta o
# HashSet de CNPJs cuja captacao diaria tambem sera' buscada no Informe Diario,
# ALEM da curadoria oficial. Uniao com os ja' curados (nao so' o arquivo) para
# garantir que a curadoria oficial nunca perde cobertura mesmo se um fundo ja
# curado tiver ficado abaixo do piso do universo desde a ultima classificacao.
$candCnpjs = New-Object System.Collections.Generic.HashSet[string]
if ($IncluirCandidatos) {
  $universoPath = Join-Path $PSScriptRoot 'Universo_Candidatos.csv'
  if (Test-Path $universoPath) {
    foreach ($row in (Import-Csv -LiteralPath $universoPath)) {
      $c = NormCNPJ ([string]$row.CNPJ_FUNDO_CLASSE)
      if ($c) { [void]$candCnpjs.Add($c) }
    }
    Step "Sensibilidade de corte: $($candCnpjs.Count) fundo(s) em Universo_Candidatos.csv"
  } else {
    Write-Host "    -IncluirCandidatos ativo mas tools\Universo_Candidatos.csv nao existe (rode selecionar-fundos.ps1 primeiro). Pulando sensibilidade de corte." -ForegroundColor Yellow
  }
  foreach ($m in @($bridge12431.map, $bridgeCdi.map)) { foreach ($c in $m.Keys) { [void]$candCnpjs.Add($c) } }
  # MESMA exclusao de tesouraria da curadoria oficial (bloco acima). Sem isto o
  # universo candidato ficava com os fundos de posicao propria dos bancos que a
  # captacao oficial remove, e o sweep inflava: no corte 15% dava R$ 194 bi de
  # captacao no 12.431 contra R$ 166 bi registrados -- +16,6%, sendo que 6
  # fundos de tesouraria respondiam por R$ 28,67 bi disso. Descontados, o corte
  # 15% reproduz o historico com -0,6% de diferenca (o resto e' vintage de
  # curadoria). O sweep TEM que medir o mesmo universo que a aba Captacao,
  # senao os dois numeros nao sao comparaveis.
  if ($excluirTes.Count -gt 0) {
    $nRemCand = 0
    foreach ($c in @($excluirTes)) { if ($candCnpjs.Remove($c)) { $nRemCand++ } }
    Step "Tesouraria (universo candidato): removidos $nRemCand fundo(s) -- mesma lista da curadoria oficial."
  }
}

function Get-FundosMeta($fundoGestorMap, $fundoApelidoMap) {
  $porGestor = @{}
  foreach ($cnpj in $fundoApelidoMap.Keys) {
    $g = $fundoApelidoMap[$cnpj]
    if ($porGestor.ContainsKey($g)) { $porGestor[$g] += 1 } else { $porGestor[$g] = 1 }
  }
  $orderedGestores = [ordered]@{}
  foreach ($g in ($porGestor.Keys | Sort-Object)) { $orderedGestores[$g] = $porGestor[$g] }
  return [ordered]@{
    fundos = $fundoGestorMap.Count
    gestores = $porGestor.Count
    semGestor = [Math]::Max(0, $fundoGestorMap.Count - $fundoApelidoMap.Count)
    porGestor = $orderedGestores
  }
}

$fluxoMeta = [ordered]@{
  updatedAt = (Get-Date).ToString('s')
  rule = 'Contagem estatica da lista atual de fundos; nao varia por periodo.'
  '12431' = Get-FundosMeta $fg12431.map $bridge12431.map
  trad = Get-FundosMeta $fgCdi.map $bridgeCdi.map
}
$utf8Meta = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'Fluxo_Meta.json'), (($fluxoMeta | ConvertTo-Json -Depth 6) + "`r`n"), $utf8Meta)

$agg      = @{ '12431' = @{}; 'trad' = @{} }
$aggFundo = @{ '12431' = @{}; 'trad' = @{} }   # mesmo que $agg, mas por (semana|cnpj)
$aggDia   = @{ '12431' = @{}; 'trad' = @{} }   # captacao/resgate/PL por (dia|gestor) - Resumo do Dia
$aggDiaCand = @{}   # captacao/resgate/PL por (dia|cnpj) do universo candidato - sensibilidade de corte
$seen     = @{ '12431' = @{}; 'trad' = @{} }
$weekMax  = @{ '12431' = @{}; 'trad' = @{} }
$aggMonth = @{ '12431' = @{}; 'trad' = @{} }
$tipos    = @{ '12431' = $bridge12431.map; 'trad' = $bridgeCdi.map }
# Serie diaria de cota+PL por fundo (necessaria pra rentabilidade - retorno nao
# e' soma, precisa da cota dia a dia). $quotaSeries[$tipo][$cnpj][dataYyyyMmDd] = @{quota=;pl=}
$quotaSeries = @{ '12431' = @{}; 'trad' = @{} }

# Mapa CNPJ_FUNDO_CLASSE -> DENOM_SOCIAL (nome do fundo), lido das listas locais.
$nomeFundo = @{ '12431' = @{}; 'trad' = @{} }
foreach ($r in (Read-FundosRows (Join-Path $PSScriptRoot 'Fundos_12431.csv') '12431')) { $nomeFundo['12431'][$r.Cnpj] = $r.Denom }
foreach ($r in (Read-FundosRows (Join-Path $PSScriptRoot 'Fundos_CDI.csv')   'trad'))  { $nomeFundo['trad'][$r.Cnpj]  = $r.Denom }

$mesesOk = @(); $mesesFalha = @(); $invalidas = 0; $minDate = $null; $maxDate = $null

# Datas (pregoes) distintas de um mes do Informe Diario -- so' a coluna DT_COMPTC.
# Usado pra achar o corte D-3 dos agregados da aba Captacao sem calendario de
# feriados (as datas que EXISTEM ja' sao os pregoes; feriado/fim de semana nao
# aparecem). Leitura leve, so' pros meses mais recentes.
function Get-DiasDoMes([string]$mes) {
  $dias = New-Object System.Collections.Generic.HashSet[string]
  $zip = Ensure-Month $mes
  if (-not $zip) { return $dias }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
    $entry = $z.Entries | Where-Object { $_.FullName -like '*.csv' } | Select-Object -First 1
    if ($entry) {
      $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::GetEncoding('latin1'))
      $hdr = $sr.ReadLine().Split(';'); $iDt = -1
      for ($i = 0; $i -lt $hdr.Count; $i++) { if ($hdr[$i].Trim() -eq 'DT_COMPTC') { $iDt = $i; break } }
      $ci = [System.Globalization.CultureInfo]::InvariantCulture
      if ($iDt -ge 0) {
        while ($null -ne ($ln = $sr.ReadLine())) {
          $c = $ln.Split(';'); if ($c.Count -le $iDt) { continue }
          [datetime]$d = [datetime]::MinValue
          if ([datetime]::TryParse($c[$iDt].Trim(), $ci, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { [void]$dias.Add($d.ToString('yyyy-MM-dd')) }
        }
      }
      $sr.Close()
    }
    $z.Dispose()
  } catch {}
  return $dias
}

# Corte D-3 dos agregados da aba Captacao (semanal/mensal/fundos): os 2 pregoes
# mais recentes podem ter cobertura parcial de fundos e subestimam a ponta.
# ANCORA = data de referencia da ANBIMA (= D-1, a fonte mais atual/confiavel),
# NAO o maximo da propria captacao (que costuma vir 1 pregao atras -> daria D-4).
# Assim a data de referencia da aba fica IDENTICA a do Resumo do Dia: ambas sao
# D-3 = ANBIMA - 2 pregoes. Calendario de pregoes = uniao das datas do Informe
# (que ja' sao pregoes) + a data ANBIMA -- sem calendario de feriados da B3.
# O Fluxo_Diario NAO e' cortado (o Resumo aplica o seu proprio D-3).
$corteD3 = $null
try {
  # Data de referencia da ANBIMA (todas as linhas compartilham; pega a maior).
  $anbimaRef = $null
  $anbimaCsv = Join-Path $PublicDir 'Anbima_Tx.csv'
  if (Test-Path $anbimaCsv) {
    foreach ($row in (Import-Csv -LiteralPath $anbimaCsv)) {
      $v = ('' + $row.dataReferenciaAnbima).Trim()
      if ($v -and ($null -eq $anbimaRef -or $v -gt $anbimaRef)) { $anbimaRef = $v }
    }
  }

  $diasTopo = New-Object System.Collections.Generic.HashSet[string]
  foreach ($m in (@($Meses | Sort-Object -Unique) | Select-Object -Last 2)) {
    foreach ($d in (Get-DiasDoMes $m)) { [void]$diasTopo.Add($d) }
  }
  if ($anbimaRef) { [void]$diasTopo.Add($anbimaRef) }   # garante a ancora no calendario
  $ordenados = @($diasTopo | Sort-Object -Descending)

  if ($anbimaRef) {
    $iAnb = [array]::IndexOf($ordenados, $anbimaRef)
    if ($iAnb -ge 0 -and $ordenados.Count -gt ($iAnb + 2)) { $corteD3 = $ordenados[$iAnb + 2] }
    if ($corteD3) { Step "Corte D-3 da aba ancorado na ANBIMA ($anbimaRef): agregados <= $corteD3 (= ANBIMA - 2 pregoes; identico ao Resumo do Dia)" }
    else { Step "Poucos pregoes antes da ANBIMA ($anbimaRef) -- sem corte D-3 nesta rodada." }
  }
  else {
    # Sem ANBIMA disponivel: fallback ao comportamento antigo (3o pregao mais recente da captacao).
    if ($ordenados.Count -ge 3) { $corteD3 = $ordenados[2] }
    if ($corteD3) { Step "Corte D-3 da aba (sem ANBIMA; usa max da captacao): agregados <= $corteD3" }
    else { Step "Poucos pregoes na janela recente -- sem corte D-3 nesta rodada." }
  }
} catch { $corteD3 = $null }

# 2-3. Processa cada mes
foreach ($mes in $Meses) {
  Step "Mes $mes ..."
  $zipPath = Ensure-Month $mes
  if (-not $zipPath) { $mesesFalha += $mes; continue }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $entry = $z.Entries | Where-Object { $_.FullName -like '*.csv' } | Select-Object -First 1
    if (-not $entry) { throw "sem CSV no zip" }
    $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::GetEncoding('latin1'))

    $header = $sr.ReadLine().Split(';')
    $idx = @{}; for ($i = 0; $i -lt $header.Count; $i++) { $idx[$header[$i].Trim()] = $i }
    $iCnpj = if ($idx.ContainsKey('CNPJ_FUNDO_CLASSE')) { $idx['CNPJ_FUNDO_CLASSE'] } elseif ($idx.ContainsKey('CNPJ_FUNDO')) { $idx['CNPJ_FUNDO'] } else { -1 }
    $iDt = $idx['DT_COMPTC']; $iPl = $idx['VL_PATRIM_LIQ']; $iCap = $idx['CAPTC_DIA']; $iRes = $idx['RESG_DIA']
    $iCota = if ($idx.ContainsKey('VL_QUOTA')) { $idx['VL_QUOTA'] } else { -1 }
    if ($iCnpj -lt 0 -or $null -eq $iDt -or $null -eq $iCap) { throw "colunas esperadas nao encontradas" }

    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    while ($null -ne ($line = $sr.ReadLine())) {
      $c = $line.Split(';')
      if ($c.Count -le $iRes) { $invalidas++; continue }
      $cnpj = NormCNPJ $c[$iCnpj]

      # Sensibilidade de corte (opt-in, -IncluirCandidatos): acumula ESTE fundo
      # no universo candidato ANTES do filtro de curadoria logo abaixo - um
      # fundo pode estar no universo (piso $LimiarCandidatosPct) sem estar
      # curado ainda (-> $tipo seria nulo e a linha seria pulada pelo `continue`
      # a seguir). Parse proprio (nao reaproveita as variaveis $dt/$cap/$res/$pl
      # de baixo) para nao alterar em nada o fluxo existente da curadoria oficial.
      if ($IncluirCandidatos -and $candCnpjs.Contains($cnpj)) {
        $dtC = [datetime]::MinValue
        if ([datetime]::TryParse($c[$iDt].Trim(), $ci, [System.Globalization.DateTimeStyles]::None, [ref]$dtC)) {
          $capC = 0.0; $resC = 0.0; $plC = 0.0
          [double]::TryParse($c[$iCap], [System.Globalization.NumberStyles]::Any, $ci, [ref]$capC) | Out-Null
          [double]::TryParse($c[$iRes], [System.Globalization.NumberStyles]::Any, $ci, [ref]$resC) | Out-Null
          [double]::TryParse($c[$iPl],  [System.Globalization.NumberStyles]::Any, $ci, [ref]$plC)  | Out-Null
          $dkC = $dtC.ToString('yyyy-MM-dd') + '|' + $cnpj
          $dbC = $aggDiaCand[$dkC]
          if (-not $dbC) { $dbC = @{ cap = 0.0; resg = 0.0; pl = 0.0 }; $aggDiaCand[$dkC] = $dbC }
          $dbC.cap += $capC; $dbC.resg += [Math]::Abs($resC); $dbC.pl = $plC   # PL = estoque do dia, nao soma
        }
      }

      $tipo = if ($tipos['12431'].ContainsKey($cnpj)) { '12431' } elseif ($tipos['trad'].ContainsKey($cnpj)) { 'trad' } else { $null }
      if (-not $tipo) { continue }
      $gestor = $tipos[$tipo][$cnpj]

      $dtRaw = $c[$iDt].Trim()
      [datetime]$dt = [datetime]::MinValue
      if (-not [datetime]::TryParse($dtRaw, $ci, [System.Globalization.DateTimeStyles]::None, [ref]$dt)) { $invalidas++; continue }
      # Dia "fresco" (mais recente que o corte D-3): fica FORA dos agregados da
      # aba (semanal/mensal/fundos + weekMax/DataBase), mas segue no $aggDia -- o
      # Resumo do Dia le o diario cru e aplica o proprio D-3.
      $fresh = ($null -ne $corteD3 -and $dt.ToString('yyyy-MM-dd') -gt $corteD3)
      $wkKey = (WeekStart $dt).ToString('yyyy-MM-dd')
      if (-not $fresh -and (-not $weekMax[$tipo].ContainsKey($wkKey) -or $dt -gt $weekMax[$tipo][$wkKey])) { $weekMax[$tipo][$wkKey] = $dt }

      $cap = 0.0; $res = 0.0; $pl = 0.0
      [double]::TryParse($c[$iCap], [System.Globalization.NumberStyles]::Any, $ci, [ref]$cap) | Out-Null
      [double]::TryParse($c[$iRes], [System.Globalization.NumberStyles]::Any, $ci, [ref]$res) | Out-Null
      [double]::TryParse($c[$iPl],  [System.Globalization.NumberStyles]::Any, $ci, [ref]$pl)  | Out-Null

      if ($iCota -ge 0 -and $c.Count -gt $iCota) {
        $cota = 0.0
        [double]::TryParse($c[$iCota], [System.Globalization.NumberStyles]::Any, $ci, [ref]$cota) | Out-Null
        if ($cota -gt 0 -and $pl -gt 0) {
          $serieFundo = $quotaSeries[$tipo][$cnpj]
          if (-not $serieFundo) { $serieFundo = @{}; $quotaSeries[$tipo][$cnpj] = $serieFundo }
          $serieFundo[$dt.ToString('yyyy-MM-dd')] = @{ quota = $cota; pl = $pl }
        }
      }

      # Agregados da ABA Captacao (semanal / por fundo / mensal): so' dias que
      # ja' assentaram (<= corte D-3). Dias frescos entram so' no $aggDia abaixo.
      if (-not $fresh) {
      $key = "$wkKey|$gestor"
      $b = $agg[$tipo][$key]
      if (-not $b) { $b = @{ cap = 0.0; resg = 0.0; plSum = 0.0; dates = @{}; cnpjs = @{} }; $agg[$tipo][$key] = $b }
      $b.cap += $cap; $b.resg += [Math]::Abs($res); $b.plSum += $pl
      $b.dates[$dtRaw] = $true; $b.cnpjs[$cnpj] = $true
      $seen[$tipo][$cnpj] = $true

      # Mesma agregacao semanal, mas por fundo (chave semana|cnpj) - alimenta a
      # tabela de fundos que abre ao clicar numa gestora na Captacao.
      $keyF = "$wkKey|$cnpj"
      $bf = $aggFundo[$tipo][$keyF]
      if (-not $bf) { $bf = @{ cap = 0.0; resg = 0.0; plSum = 0.0; dates = @{}; gestor = $gestor }; $aggFundo[$tipo][$keyF] = $bf }
      $bf.cap += $cap; $bf.resg += [Math]::Abs($res); $bf.plSum += $pl
      $bf.dates[$dtRaw] = $true

      $mk = ($dt.ToString('yyyy-MM')) + '|' + $gestor
      $mb = $aggMonth[$tipo][$mk]
      if (-not $mb) { $mb = @{ cap = 0.0; resg = 0.0 }; $aggMonth[$tipo][$mk] = $mb }
      $mb.cap += $cap; $mb.resg += [Math]::Abs($res)
      }

      # Captacao DIARIA por gestor (chave dia|gestor) - alimenta o Resumo do Dia.
      $dk = $dt.ToString('yyyy-MM-dd') + '|' + $gestor
      $db = $aggDia[$tipo][$dk]
      if (-not $db) { $db = @{ cap = 0.0; resg = 0.0; plSum = 0.0; cnpjs = @{} }; $aggDia[$tipo][$dk] = $db }
      $db.cap += $cap; $db.resg += [Math]::Abs($res); $db.plSum += $pl; $db.cnpjs[$cnpj] = $true

      if ($null -eq $minDate -or $dt -lt $minDate) { $minDate = $dt }
      if ($null -eq $maxDate -or $dt -gt $maxDate) { $maxDate = $dt }
    }
    $sr.Close(); $z.Dispose()
    $mesesOk += $mes
  } catch {
    Write-Host "    ERRO no mes $mes (pulando): $($_.Exception.Message)" -ForegroundColor Yellow
    $mesesFalha += $mes
  }
}

# TRAVA DE SEGURANCA (jul/2026): se NENHUM mes foi processado, nao ha' nada p/
# escrever -- e seguir adiante sobrescreveria todas as series com arquivo so' de
# cabecalho. Foi exatamente o que aconteceu quando um bug de splat fez o script
# procurar um "mes" inexistente: 404 em tudo, zero meses OK, e as 14 series de
# Fluxo_/Perf_ foram zeradas com o run reportando sucesso. Abortar aqui deixa os
# dados anteriores intactos: perder a atualizacao e' recuperavel, perder a serie
# historica nao. Rodada legitima SEMPRE processa pelo menos um mes.
if (-not $mesesOk -or $mesesOk.Count -eq 0) {
  $det = if ($mesesFalha.Count) { " Meses que falharam: $($mesesFalha -join ', ')." } else { '' }
  throw "ABORTADO: nenhum mes foi processado com sucesso.$det Nada foi escrito -- as series existentes ficaram intactas. Verifique a conectividade com a CVM e os meses pedidos."
}

# Uma semana pode ficar parcial quando um dos seus dias cai num mes ainda nao
# disponivel (ex: mes atual, antes da CVM publicar) ou nao reprocessado neste
# run. Isso e' esperado e mostrado normalmente (nao escondemos a semana) -- a
# coluna DataBase ja indica ate' que dia ela esta' atualizada, entao fica
# visivel que e' uma semana "em andamento". Ela se completa sozinha no proximo
# run, quando os dias que faltam ja tiverem sido publicados/reprocessados.
$mesesOkSet = New-Object System.Collections.Generic.HashSet[string]
$mesesOk | ForEach-Object { [void]$mesesOkSet.Add($_) }
$semanasParciais = New-Object System.Collections.Generic.List[string]
foreach ($tipo in @('12431', 'trad')) {
  foreach ($k in $agg[$tipo].Keys) {
    $wkStr = ($k -split '\|', 2)[0]
    $wkStart = [datetime]::ParseExact($wkStr, 'yyyy-MM-dd', $null)
    for ($d = 0; $d -lt 7; $d++) {
      if (-not $mesesOkSet.Contains($wkStart.AddDays($d).ToString('yyyyMM'))) { $semanasParciais.Add($wkStr); break }
    }
  }
}
if ($semanasParciais.Count -gt 0) {
  $lista = $semanasParciais | Sort-Object -Unique
  Write-Host "    Semana(s) parcial(is) (ainda em andamento, dado disponivel ate' o momento): $($lista -join ', ')" -ForegroundColor DarkGray
}

# 3b. Rentabilidade por gestor -----------------------------------------------
# Retorno da cota (nao e' soma - precisa encadear dia a dia), ponderado pelo
# PL de cada fundo no dia anterior, comparado ao CDI da mesma janela.

# Retorno acumulado no intervalo inicio-exclusivo, fim-inclusivo, a partir de
# uma serie ($dates/$rets paralelas, ja' em ordem cronologica). $null se nao
# houver nenhum dia dentro do intervalo (historico insuficiente pra' janela).
function Get-RetornoJanela($dates, $rets, [datetime]$inicio, [datetime]$fim) {
  $prod = 1.0; $achou = $false
  for ($i = 0; $i -lt $dates.Count; $i++) {
    $d = [datetime]::ParseExact($dates[$i], 'yyyy-MM-dd', $null)
    if ($d -gt $inicio -and $d -le $fim) { $prod *= (1.0 + $rets[$i]); $achou = $true }
  }
  if (-not $achou) { return $null }
  return $prod - 1.0
}

# Serie diaria de retorno por gestor: em cada dia com pelo menos 2 fundos com
# cota valida (dia atual + anterior), o retorno do gestor e' a media dos
# retornos dos fundos ponderada pelo PL de cada um no dia anterior.
function Compute-RetornoDiarioGestor($tipoQuotaSeries, $cnpjsByGestor) {
  $result = @{}
  foreach ($gestor in $cnpjsByGestor.Keys) {
    $cnpjs = $cnpjsByGestor[$gestor]
    $allDates = New-Object System.Collections.Generic.SortedSet[string]
    foreach ($cnpj in $cnpjs) {
      if ($tipoQuotaSeries.ContainsKey($cnpj)) {
        foreach ($d in $tipoQuotaSeries[$cnpj].Keys) { [void]$allDates.Add($d) }
      }
    }
    if ($allDates.Count -lt 2) { continue }
    $sortedDates = @($allDates)
    $dailyDates = New-Object System.Collections.Generic.List[string]
    $dailyRets  = New-Object System.Collections.Generic.List[double]
    for ($i = 1; $i -lt $sortedDates.Count; $i++) {
      $dPrev = $sortedDates[$i - 1]; $dCur = $sortedDates[$i]
      $sumW = 0.0; $sumWR = 0.0
      foreach ($cnpj in $cnpjs) {
        $serie = $tipoQuotaSeries[$cnpj]
        if ($serie -and $serie.ContainsKey($dPrev) -and $serie.ContainsKey($dCur)) {
          $qPrev = $serie[$dPrev].quota; $qCur = $serie[$dCur].quota; $plPrev = $serie[$dPrev].pl
          if ($qPrev -gt 0 -and $plPrev -gt 0) {
            $ret = ($qCur / $qPrev) - 1.0
            $sumW += $plPrev; $sumWR += $plPrev * $ret
          }
        }
      }
      if ($sumW -gt 0) { $dailyDates.Add($dCur); $dailyRets.Add($sumWR / $sumW) }
    }
    if ($dailyDates.Count -gt 0) { $result[$gestor] = @{ dates = $dailyDates; rets = $dailyRets } }
  }
  return $result
}

function Fmt-PctOuVazio($v, $ci) {
  if ($null -eq $v) { return '' }
  return ([Math]::Round($v, 4)).ToString($ci)
}

Step "Buscando serie do CDI (Banco Central, SGS 12) e calculando rentabilidade por gestor..."
$cdiMap = Get-CdiDiario $CvmDir ((Get-Date).AddMonths(-13)) -NoDownload:$NoDownload
Write-Host "    CDI: $($cdiMap.Count) dias carregados"

$JANELAS_DIAS   = @{ '1s' = 7 }
$JANELAS_MESES  = @{ '1m' = 1; '3m' = 3; '6m' = 6; '12m' = 12 }
$ORDEM_JANELAS  = @('1s', '1m', '3m', '6m', '12m')

$rentPorTipo = @{}
foreach ($tipo in @('12431', 'trad')) {
  $cnpjsByGestor = @{}
  foreach ($cnpj in $tipos[$tipo].Keys) {
    $g = $tipos[$tipo][$cnpj]
    if (-not $cnpjsByGestor.ContainsKey($g)) { $cnpjsByGestor[$g] = New-Object System.Collections.Generic.List[string] }
    $cnpjsByGestor[$g].Add($cnpj)
  }
  $retornoGestor = Compute-RetornoDiarioGestor $quotaSeries[$tipo] $cnpjsByGestor
  $linhas = @{}
  foreach ($gestor in $retornoGestor.Keys) {
    $serie = $retornoGestor[$gestor]
    $fimRef = [datetime]::ParseExact($serie.dates[$serie.dates.Count - 1], 'yyyy-MM-dd', $null)
    $linha = @{}
    foreach ($jk in $ORDEM_JANELAS) {
      $inicio = if ($JANELAS_DIAS.ContainsKey($jk)) { $fimRef.AddDays(-$JANELAS_DIAS[$jk]) } else { $fimRef.AddMonths(-$JANELAS_MESES[$jk]) }
      $retGestor = Get-RetornoJanela $serie.dates $serie.rets $inicio $fimRef
      $retCdi = Get-CdiRetornoJanela $cdiMap $inicio $fimRef
      $linha["ret_$jk"] = if ($null -ne $retGestor) { $retGestor * 100.0 } else { $null }
      $linha["pctcdi_$jk"] = if ($null -ne $retGestor -and $null -ne $retCdi -and $retCdi -ne 0) { ($retGestor / $retCdi) * 100.0 } else { $null }
    }
    $linha['dataBase'] = $fimRef.ToString('yyyy-MM-dd')
    $linhas[$gestor] = $linha
  }
  $rentPorTipo[$tipo] = $linhas
}

# Rentabilidade %CDI POR FUNDO (retorno da cota do proprio fundo, sem ponderar
# pelo PL - diferente do gestor). Alimenta a tabela de fundos da Captacao.
$rentFundoPorTipo = @{}
foreach ($tipo in @('12431', 'trad')) {
  $linhasF = @{}
  foreach ($cnpj in $quotaSeries[$tipo].Keys) {
    $serieFundo = $quotaSeries[$tipo][$cnpj]
    if ($serieFundo.Count -lt 2) { continue }
    $datasOrd = @($serieFundo.Keys | Sort-Object)
    $retDatas = New-Object System.Collections.Generic.List[string]
    $retVals  = New-Object System.Collections.Generic.List[double]
    for ($i = 1; $i -lt $datasOrd.Count; $i++) {
      $qPrev = $serieFundo[$datasOrd[$i - 1]].quota; $qCur = $serieFundo[$datasOrd[$i]].quota
      if ($qPrev -gt 0) { $retDatas.Add($datasOrd[$i]); $retVals.Add(($qCur / $qPrev) - 1.0) }
    }
    if ($retDatas.Count -lt 1) { continue }
    $fimRef = [datetime]::ParseExact($retDatas[$retDatas.Count - 1], 'yyyy-MM-dd', $null)
    $linha = @{}
    foreach ($jk in $ORDEM_JANELAS) {
      $inicio = if ($JANELAS_DIAS.ContainsKey($jk)) { $fimRef.AddDays(-$JANELAS_DIAS[$jk]) } else { $fimRef.AddMonths(-$JANELAS_MESES[$jk]) }
      $retFundo = Get-RetornoJanela $retDatas $retVals $inicio $fimRef
      $retCdi = Get-CdiRetornoJanela $cdiMap $inicio $fimRef
      $linha["pctcdi_$jk"] = if ($null -ne $retFundo -and $null -ne $retCdi -and $retCdi -ne 0) { ($retFundo / $retCdi) * 100.0 } else { $null }
    }
    $linhasF[$cnpj] = $linha
  }
  $rentFundoPorTipo[$tipo] = $linhasF
}

# Fluxo_Fundos_{tipo}.csv: um registro por fundo (nome + gestor + %CDI proprio).
# Inclui todo fundo da curadoria que apareceu no Informe Diario ($seen), mesmo
# sem %CDI (janelas vazias = sem historico suficiente na rodada).
function Write-BaseFundosRentabilidade($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CNPJ_Fundo,Nome_Fundo,Gestor_Apelido,PctCDI_1s,PctCDI_1m,PctCDI_3m,PctCDI_6m,PctCDI_12m')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $rent = $rentFundoPorTipo[$tipo]
  $n = 0
  foreach ($cnpj in ($seen[$tipo].Keys | Sort-Object)) {
    $nome = if ($nomeFundo[$tipo].ContainsKey($cnpj)) { $nomeFundo[$tipo][$cnpj] } else { '' }
    $gestor = if ($tipos[$tipo].ContainsKey($cnpj)) { $tipos[$tipo][$cnpj] } else { '' }
    $cols = New-Object System.Collections.Generic.List[string]
    $cols.Add($cnpj)
    $cols.Add('"' + $nome.Replace('"', '""') + '"')
    $cols.Add('"' + $gestor.Replace('"', '""') + '"')
    $l = if ($rent.ContainsKey($cnpj)) { $rent[$cnpj] } else { @{} }
    foreach ($jk in $ORDEM_JANELAS) { $cols.Add((Fmt-PctOuVazio $l["pctcdi_$jk"] $ci)) }
    [void]$sb.AppendLine(($cols -join ','))
    $n++
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $n
}

function Write-BaseRentabilidade($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Gestor_Apelido,Retorno_1s,Retorno_1m,Retorno_3m,Retorno_6m,Retorno_12m,PctCDI_1s,PctCDI_1m,PctCDI_3m,PctCDI_6m,PctCDI_12m,DataBase')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $linhas = $rentPorTipo[$tipo]
  foreach ($gestor in ($linhas.Keys | Sort-Object)) {
    $l = $linhas[$gestor]
    $cols = New-Object System.Collections.Generic.List[string]
    $cols.Add('"' + $gestor.Replace('"', '""') + '"')
    foreach ($jk in $ORDEM_JANELAS) { $cols.Add((Fmt-PctOuVazio $l["ret_$jk"] $ci)) }
    foreach ($jk in $ORDEM_JANELAS) { $cols.Add((Fmt-PctOuVazio $l["pctcdi_$jk"] $ci)) }
    $cols.Add($l['dataBase'])
    [void]$sb.AppendLine(($cols -join ','))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $linhas.Count
}

# ─── Bases DIARIAS (Resumo do Dia) ─────────────────────────────────────────
# Captacao/resgate/PL por (dia, gestor). PL do dia = soma dos PLs dos fundos
# naquele dia (estoque, nao media). Mesclada pela Merge-Semanal (1a coluna=Dia).
function Write-BaseDiaria($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Dia,Gestor_Apelido,Captacao,Resgate,Liquido,PL,Num_Fundos')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $aggDia[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $aggDia[$tipo][$k]
    $parts = $k -split '\|', 2
    $dia = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4},{5},{6}' -f $dia, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $liq.ToString($ci), ([Math]::Round($b.plSum,2)).ToString($ci), $b.cnpjs.Count))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

# Captacao/resgate/PL do UNIVERSO CANDIDATO por (dia, fundo) - sem agregar por
# gestor (o fundo pode nem estar curado ainda). So' escrito com -IncluirCandidatos.
# Alimenta gerar-sensibilidade-corte.mjs (varredura do corte de %Deb 10%-80%).
function Write-BaseDiariaCand($outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Dia,CNPJ_Fundo,Captacao,Resgate,Liquido,PL')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $aggDiaCand.Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $aggDiaCand[$k]
    $parts = $k -split '\|', 2
    $dia = $parts[0]; $cnpj = $parts[1]
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},{1},{2},{3},{4},{5}' -f $dia, $cnpj,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $liq.ToString($ci), ([Math]::Round($b.pl,2)).ToString($ci)))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

# Performance DIARIA por fundo: retorno da cota (quota[d]/quota[d-1]-1) por dia.
# Janela movel dos ~$JanelaDias dias mais recentes (historico completo e' grande
# e o Resumo do Dia so' le os 5 ultimos dias). Mesclada pela Merge-Semanal.
function Write-PerfDiaria($tipo, $outFile, [int]$JanelaDias = 40) {
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  # Dias mais recentes (uniao entre fundos), limitados a $JanelaDias.
  $todosDias = New-Object System.Collections.Generic.SortedSet[string]
  foreach ($cnpj in $quotaSeries[$tipo].Keys) {
    foreach ($d in $quotaSeries[$tipo][$cnpj].Keys) { [void]$todosDias.Add($d) }
  }
  $diasOrd = @($todosDias)
  $diasJanela = @{}
  $ini = [Math]::Max(0, $diasOrd.Count - $JanelaDias)
  for ($i = $ini; $i -lt $diasOrd.Count; $i++) { $diasJanela[$diasOrd[$i]] = $true }

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Dia,CNPJ_Fundo,Gestor_Apelido,RetornoCota,PL')
  $n = 0
  foreach ($cnpj in ($quotaSeries[$tipo].Keys | Sort-Object)) {
    $serie = $quotaSeries[$tipo][$cnpj]
    if ($serie.Count -lt 2) { continue }
    $gestor = if ($tipos[$tipo].ContainsKey($cnpj)) { $tipos[$tipo][$cnpj].Replace('"', '""') } else { '' }
    $ds = @($serie.Keys | Sort-Object)
    for ($i = 1; $i -lt $ds.Count; $i++) {
      $dia = $ds[$i]
      if (-not $diasJanela.ContainsKey($dia)) { continue }
      $qPrev = $serie[$ds[$i - 1]].quota; $qCur = $serie[$dia].quota
      if ($qPrev -le 0) { continue }
      $ret = ($qCur / $qPrev) - 1.0
      $pl = $serie[$dia].pl
      [void]$sb.AppendLine(('{0},{1},"{2}",{3},{4}' -f $dia, $cnpj, $gestor,
        ([Math]::Round($ret * 100.0, 4)).ToString($ci), ([Math]::Round($pl, 2)).ToString($ci)))
      $n++
    }
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $n
}

# 4. Escreve as bases
function Write-Base($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos,DataBase')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $agg[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $agg[$tipo][$k]
    $parts = $k -split '\|', 2
    $semana = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $dataBase = if ($weekMax[$tipo].ContainsKey($semana)) { $weekMax[$tipo][$semana].ToString('yyyy-MM-dd') } else { $semana }
    $nDates = [Math]::Max(1, $b.dates.Count)
    $plMedio = [Math]::Round($b.plSum / $nDates, 2)
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4},{5},{6},{7}' -f $semana, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $liq.ToString($ci), $plMedio.ToString($ci), $b.cnpjs.Count, $dataBase))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

function Write-BaseFundos($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Semana,CNPJ_Fundo,Gestor_Apelido,Captacao,Resgate,PL_Medio,DataBase')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $aggFundo[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $aggFundo[$tipo][$k]
    $parts = $k -split '\|', 2
    $semana = $parts[0]; $cnpj = $parts[1]
    $gestor = $b.gestor.Replace('"', '""')
    $dataBase = if ($weekMax[$tipo].ContainsKey($semana)) { $weekMax[$tipo][$semana].ToString('yyyy-MM-dd') } else { $semana }
    $nDates = [Math]::Max(1, $b.dates.Count)
    $plMedio = [Math]::Round($b.plSum / $nDates, 2)
    [void]$sb.AppendLine(('{0},{1},"{2}",{3},{4},{5},{6}' -f $semana, $cnpj, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci),
      $plMedio.ToString($ci), $dataBase))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

function Write-BaseMensal($tipo, $outFile) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('Mes,Gestor_Apelido,Captacao,Resgate,Liquido')
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  $keys = $aggMonth[$tipo].Keys | Sort-Object
  foreach ($k in $keys) {
    $b = $aggMonth[$tipo][$k]
    $parts = $k -split '\|', 2
    $mes = $parts[0]; $gestor = $parts[1].Replace('"', '""')
    $liq = [Math]::Round($b.cap - $b.resg, 2)
    [void]$sb.AppendLine(('{0},"{1}",{2},{3},{4}' -f $mes, $gestor,
      ([Math]::Round($b.cap,2)).ToString($ci), ([Math]::Round($b.resg,2)).ToString($ci), $liq.ToString($ci)))
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8)
  return $keys.Count
}

$out12431    = Join-Path $OutDir 'Fluxo_Semanal_12431.csv'
$outTrad     = Join-Path $OutDir 'Fluxo_Semanal_Trad.csv'
$outMes12431 = Join-Path $OutDir 'Fluxo_Mensal_12431.csv'
$outMesTrad  = Join-Path $OutDir 'Fluxo_Mensal_Trad.csv'
$outFun12431 = Join-Path $OutDir 'Fluxo_Semanal_Fundos_12431.csv'
$outFunTrad  = Join-Path $OutDir 'Fluxo_Semanal_Fundos_Trad.csv'
$outDia12431 = Join-Path $OutDir 'Fluxo_Diario_12431.csv'
$outDiaTrad  = Join-Path $OutDir 'Fluxo_Diario_Trad.csv'
$outPerf12431 = Join-Path $OutDir 'Perf_Diario_12431.csv'
$outPerfTrad  = Join-Path $OutDir 'Perf_Diario_Trad.csv'
$outDiaCand   = Join-Path $OutDir 'Fluxo_Diario_Candidatos.csv'

# Salva conteudo antigo ANTES de sobrescrever (necessario para o merge incremental)
$oldSem12431 = @(); $oldSemTrad = @(); $oldMes12431Lines = @(); $oldMesTradLines = @()
$oldFun12431 = @(); $oldFunTrad = @(); $oldDia12431 = @(); $oldDiaTrad = @(); $oldDiaCand = @()
if ($Incremental) {
  if (Test-Path $out12431)    { $oldSem12431      = [System.IO.File]::ReadAllLines($out12431) }
  if (Test-Path $outTrad)     { $oldSemTrad       = [System.IO.File]::ReadAllLines($outTrad) }
  if (Test-Path $outMes12431) { $oldMes12431Lines = [System.IO.File]::ReadAllLines($outMes12431) }
  if (Test-Path $outMesTrad)  { $oldMesTradLines  = [System.IO.File]::ReadAllLines($outMesTrad) }
  if (Test-Path $outFun12431) { $oldFun12431      = [System.IO.File]::ReadAllLines($outFun12431) }
  if (Test-Path $outFunTrad)  { $oldFunTrad       = [System.IO.File]::ReadAllLines($outFunTrad) }
  if (Test-Path $outDia12431) { $oldDia12431      = [System.IO.File]::ReadAllLines($outDia12431) }
  if (Test-Path $outDiaTrad)  { $oldDiaTrad       = [System.IO.File]::ReadAllLines($outDiaTrad) }
  if (Test-Path $outDiaCand)  { $oldDiaCand       = [System.IO.File]::ReadAllLines($outDiaCand) }
}

$n12431    = Write-Base       '12431' $out12431
$nTrad     = Write-Base       'trad'  $outTrad
$nMes12431 = Write-BaseMensal '12431' $outMes12431
$nMesTrad  = Write-BaseMensal 'trad'  $outMesTrad
$nFun12431 = Write-BaseFundos '12431' $outFun12431
$nFunTrad  = Write-BaseFundos 'trad'  $outFunTrad
$nDia12431 = Write-BaseDiaria '12431' $outDia12431
$nDiaTrad  = Write-BaseDiaria 'trad'  $outDiaTrad
# Perf diaria NAO e' mesclada (janela movel recalculada a cada rodada, como a rentabilidade).
$nPerf12431 = Write-PerfDiaria '12431' $outPerf12431
$nPerfTrad  = Write-PerfDiaria 'trad'  $outPerfTrad
$nDiaCand = if ($IncluirCandidatos) { Write-BaseDiariaCand $outDiaCand } else { 0 }

# Rentabilidade nao e' mesclada com o historico (diferente de Semanal/Mensal):
# cada janela (1s..12m) precisa da serie de cota do periodo INTEIRO presente
# em $quotaSeries NESTA rodada. Rodando com -Incremental (so' 2 meses), as
# janelas maiores (3m/6m/12m) ficam vazias por falta de historico - pra' elas
# sairem preenchidas e' preciso rodar sem -Incremental cobrindo os 12 meses.
$outRent12431 = Join-Path $OutDir 'Fluxo_Rentabilidade_12431.csv'
$outRentTrad  = Join-Path $OutDir 'Fluxo_Rentabilidade_Trad.csv'
$nRent12431 = Write-BaseRentabilidade '12431' $outRent12431
$nRentTrad  = Write-BaseRentabilidade 'trad'  $outRentTrad

# Fluxo_Fundos (nome + gestor + %CDI proprio por fundo). Igual a rentabilidade
# do gestor, NAO e' mesclado: so' lista os fundos vistos nesta rodada.
$outFundos12431 = Join-Path $OutDir 'Fluxo_Fundos_12431.csv'
$outFundosTrad  = Join-Path $OutDir 'Fluxo_Fundos_Trad.csv'
$nFundos12431 = Write-BaseFundosRentabilidade '12431' $outFundos12431
$nFundosTrad  = Write-BaseFundosRentabilidade 'trad'  $outFundosTrad

if ($Incremental) {
  Step "Mesclando com historico existente..."
  $newWeek12431 = New-Object System.Collections.Generic.HashSet[string]
  $agg['12431'].Keys | ForEach-Object { [void]$newWeek12431.Add(($_ -split '\|', 2)[0]) }
  $newWeekTrad = New-Object System.Collections.Generic.HashSet[string]
  $agg['trad'].Keys | ForEach-Object { [void]$newWeekTrad.Add(($_ -split '\|', 2)[0]) }
  $newMonth12431 = New-Object System.Collections.Generic.HashSet[string]
  $aggMonth['12431'].Keys | ForEach-Object { [void]$newMonth12431.Add(($_ -split '\|', 2)[0]) }
  $newMonthTrad = New-Object System.Collections.Generic.HashSet[string]
  $aggMonth['trad'].Keys | ForEach-Object { [void]$newMonthTrad.Add(($_ -split '\|', 2)[0]) }

  Merge-Semanal $oldSem12431      $out12431    $newWeek12431
  Merge-Semanal $oldSemTrad       $outTrad     $newWeekTrad
  Merge-Mensal  $oldMes12431Lines $outMes12431 $newMonth12431
  Merge-Mensal  $oldMesTradLines  $outMesTrad  $newMonthTrad
  # Base por fundo: mesma chave de semana (Merge-Semanal filtra pela 1a coluna).
  Merge-Semanal $oldFun12431      $outFun12431 $newWeek12431
  Merge-Semanal $oldFunTrad       $outFunTrad  $newWeekTrad
  # Base diaria: chave = dia (1a coluna). Mescla os dias fora desta rodada.
  $newDia12431 = New-Object System.Collections.Generic.HashSet[string]
  $aggDia['12431'].Keys | ForEach-Object { [void]$newDia12431.Add(($_ -split '\|', 2)[0]) }
  $newDiaTrad = New-Object System.Collections.Generic.HashSet[string]
  $aggDia['trad'].Keys | ForEach-Object { [void]$newDiaTrad.Add(($_ -split '\|', 2)[0]) }
  Merge-Semanal $oldDia12431      $outDia12431 $newDia12431
  Merge-Semanal $oldDiaTrad       $outDiaTrad  $newDiaTrad
  if ($IncluirCandidatos) {
    $newDiaCand = New-Object System.Collections.Generic.HashSet[string]
    $aggDiaCand.Keys | ForEach-Object { [void]$newDiaCand.Add(($_ -split '\|', 2)[0]) }
    Merge-Semanal $oldDiaCand $outDiaCand $newDiaCand
  }
}

# 5. PL_Gestores.csv - PL mais recente por gestor (12431 + Trad somados), consumido pela aba Gestores do app.
function Get-LatestPlByGestor($tipo) {
  $latestWk = @{}
  foreach ($k in $agg[$tipo].Keys) {
    $parts = $k -split '\|', 2; $wk = $parts[0]; $g = $parts[1]
    if (-not $latestWk.ContainsKey($g) -or $wk -gt $latestWk[$g]) { $latestWk[$g] = $wk }
  }
  $result = @{}
  foreach ($g in $latestWk.Keys) {
    $b = $agg[$tipo][$latestWk[$g] + '|' + $g]
    $nDates = [Math]::Max(1, $b.dates.Count)
    $result[$g] = $b.plSum / $nDates
  }
  return $result
}

$plByGestor = @{}
foreach ($tipo in @('12431', 'trad')) {
  $plTipo = Get-LatestPlByGestor $tipo
  foreach ($g in $plTipo.Keys) {
    if ($plByGestor.ContainsKey($g)) { $plByGestor[$g] += $plTipo[$g] } else { $plByGestor[$g] = $plTipo[$g] }
  }
}

$outPlGestores = Join-Path $PublicDir 'PL_Gestores.csv'
$sbPl = New-Object System.Text.StringBuilder
[void]$sbPl.AppendLine('Gestor_Apelido,PL')
$ciPl = [System.Globalization.CultureInfo]::InvariantCulture
foreach ($g in ($plByGestor.Keys | Sort-Object)) {
  [void]$sbPl.AppendLine(('"{0}",{1}' -f $g.Replace('"', '""'), ([Math]::Round($plByGestor[$g], 2)).ToString($ciPl)))
}
$utf8Pl = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPlGestores, $sbPl.ToString(), $utf8Pl)

# 6. Relatorio
$nf12431 = ($bridge12431.map.Keys | Where-Object { -not $seen['12431'].ContainsKey($_) }).Count
$nfTrad  = ($bridgeCdi.map.Keys   | Where-Object { -not $seen['trad'].ContainsKey($_) }).Count

Write-Host ""
Write-Host "=== RELATORIO ===" -ForegroundColor Green
Write-Host "  Meses processados : $($mesesOk -join ', ')"
if ($mesesFalha.Count) { Write-Host "  Meses com falha   : $($mesesFalha -join ', ')" -ForegroundColor Yellow }
$f1 = $seen['12431'].Count; $f2 = $seen['trad'].Count
Write-Host ("  12431  -> encontrados: {0} | nao encontrados: {1} | linhas: {2}" -f $f1, $nf12431, $n12431)
Write-Host ("  Trad   -> encontrados: {0} | nao encontrados: {1} | linhas: {2}" -f $f2, $nfTrad, $nTrad)
Write-Host "  Linhas invalidas  : $invalidas"
if ($minDate -and $maxDate) { Write-Host ("  Periodo coberto   : {0} a {1}" -f $minDate.ToString('yyyy-MM-dd'), $maxDate.ToString('yyyy-MM-dd')) }
Write-Host "  Arquivos gerados  :"
Write-Host "    $out12431" -ForegroundColor Yellow
Write-Host "    $outTrad"  -ForegroundColor Yellow
Write-Host ("    $outMes12431  (mensal: $nMes12431 linhas)") -ForegroundColor Yellow
Write-Host ("    $outMesTrad  (mensal: $nMesTrad linhas)")  -ForegroundColor Yellow
Write-Host ("    $outRent12431  (rentabilidade: $nRent12431 gestoras)") -ForegroundColor Yellow
Write-Host ("    $outRentTrad  (rentabilidade: $nRentTrad gestoras)")  -ForegroundColor Yellow
Write-Host ("    $outFun12431  (semanal por fundo: $nFun12431 linhas)") -ForegroundColor Yellow
Write-Host ("    $outFunTrad  (semanal por fundo: $nFunTrad linhas)")  -ForegroundColor Yellow
Write-Host ("    $outFundos12431  (fundos: $nFundos12431)") -ForegroundColor Yellow
Write-Host ("    $outFundosTrad  (fundos: $nFundosTrad)")  -ForegroundColor Yellow
Write-Host ("    $outDia12431  (diario: $nDia12431 linhas)") -ForegroundColor Yellow
Write-Host ("    $outDiaTrad  (diario: $nDiaTrad linhas)")  -ForegroundColor Yellow
Write-Host ("    $outPerf12431  (perf diaria: $nPerf12431 linhas)") -ForegroundColor Yellow
Write-Host ("    $outPerfTrad  (perf diaria: $nPerfTrad linhas)")  -ForegroundColor Yellow
Write-Host ("    $outPlGestores  ($($plByGestor.Count) gestoras)") -ForegroundColor Yellow
if ($IncluirCandidatos) {
  Write-Host ("    $outDiaCand  (universo candidato: $nDiaCand linhas, $($candCnpjs.Count) fundos - sensibilidade de corte)") -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Proximo: revise os CSVs, troque FLUXO_IS_MOCK para false em src/hooks/useFluxo.js e publique." -ForegroundColor White
Write-Host ""

# Resumo estruturado desta rodada (usado pelo painel de controle web para
# mostrar o resultado sem precisar reler o log de texto).
$resumoCaptacao = [ordered]@{
  timestamp = (Get-Date).ToString('s')
  modo = $(if ($Incremental) { 'incremental' } else { 'completa' })
  mesesProcessados = @($mesesOk)
  mesesFalha = @($mesesFalha)
  periodoCoberto = $(if ($minDate -and $maxDate) {
    [ordered]@{ inicio = $minDate.ToString('yyyy-MM-dd'); fim = $maxDate.ToString('yyyy-MM-dd') }
  } else { $null })
  linhasInvalidas = $invalidas
  '12431' = [ordered]@{
    gestoras = $f1
    naoEncontrados = $nf12431
    linhasSemanais = $n12431
    linhasMensais = $nMes12431
    gestorasRentabilidade = $nRent12431
  }
  trad = [ordered]@{
    gestoras = $f2
    naoEncontrados = $nfTrad
    linhasSemanais = $nTrad
    linhasMensais = $nMesTrad
    gestorasRentabilidade = $nRentTrad
  }
  gestoresPl = $plByGestor.Count
}
$utf8Resumo = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'Fluxo_Atualizacao.json'), (($resumoCaptacao | ConvertTo-Json -Depth 6) + "`r`n"), $utf8Resumo)

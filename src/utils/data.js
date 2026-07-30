import { parseNum, normCNPJ, dateKey } from './format.js'
import { converterSpreadSec } from './spreadRef.js'

// Chave de hoje (yyyymmdd) para invalidar datas de registro vindas com erro da
// fonte (o Debentures.com.br traz 1-2 registros com data no futuro, ex.: 2028).
const HOJE_KEY = dateKey(new Date().toISOString().slice(0, 10))

const FIELDS = {
  codigoAtivo:    ['Codigo do Ativo', 'Código do Ativo', 'Codigo Ativo', 'CODIGO_ATIVO'],
  cnpjEmissor:    ['CNPJ Emissor', 'CNPJ do Emissor', 'CNPJ_EMISSOR', 'CNPJ'],
  qtdMercado:     ['Quantidade em Mercado', 'Qtd em Mercado', 'Quantidade Mercado'],
  vna:            ['Valor Nominal Atual', 'VNA'],
  taxa:           ['Juros Criterio Novo - Taxa', 'Taxa', 'Juros - Taxa', 'Taxa de Juros'],
  vencimento:     ['Data de Vencimento', 'Vencimento', 'Dt Vencimento', 'DT_VENC'],
  emissao:        ['Data de Emissao', 'Data de Emissão', 'Emissao', 'Dt Emissao'],
  // Data de REGISTRO CVM da emissao (nao confundir com [7] "Registro CVM da
  // Emissao", que e' o NUMERO). Reflete quando a debenture foi publicada/registrada.
  registroCvm:    ['Data de Registro CVM da Emissao', 'Data de Registro CVM da Emissão'],
  indexador:      ['Indexador', 'Indice', 'Índice', 'indice'],
  coordenador:    ['Coordenador Lider', 'Coordenador Líder', 'Coordenador', 'Lead Manager'],
  garantia:       ['Garantia', 'Tipo de Garantia', 'Garantia/Especie'],
  lei12431:       ['Deb. Incent. (Lei 12.431)', 'Lei 12.431', 'Lei 12431', 'Debentures Incentivadas', 'Incentivada', 'DEB_INCENT'],
  descricao:      ['Descricao', 'Descrição', 'Observacoes', 'Obs'],
  // emissores
  empresaNome:    ['Emissor', 'Empresa', 'Nome Empresa', 'Razao Social', 'Razão Social', 'Nome'],
  grupo:          ['Grupo', 'Grupo Economico', 'Grupo Econômico'],
  setor:          ['Setor', 'Segmento', 'Setor Economico'],
  // PL por gestor (PL_Gestores.csv)
  gestorPl:       ['Gestor_Apelido', 'Gestor Apelido', 'Gestor'],
  pl:             ['PL', 'Patrimonio Liquido', 'Patrimônio Líquido'],
  // BLC
  cdAtivo:        ['CD_ATIVO', 'Codigo do Ativo', 'Codigo Ativo'],
  cnpjFundoBlc:   ['CNPJ_FUNDO_CLASSE', 'CNPJ_FUNDO', 'CNPJ Fundo'],
  vlMerc:         ['VL_MERC_POS_FINAL', 'VL_MERC', 'Valor Mercado'],
  // BLC tratado (ja agregado por gestor)
  gestorBlc:      ['GESTOR', 'Gestor Apelido'],
  vlAloc:         ['VL_ALOCADO', 'VL_MERC_POS_FINAL', 'VL_MERC', 'Valor Mercado'],
}

function pick(row, keys) {
  for (const k of keys) if (k in row) return row[k]
  return ''
}

export function buildIndexes({ emissores }) {
  const emissorMap = {}
  emissores.forEach(e => {
    const key = normCNPJ(pick(e, FIELDS.cnpjEmissor))
    if (key) emissorMap[key] = e
  })

  return { emissorMap }
}

// PL por gestor, a partir do PL_Gestores.csv (gerado por preparar-fluxo.ps1)
export function buildPlByGestor(plGestores) {
  const map = {}
  ;(plGestores || []).forEach(row => {
    const g = (pick(row, FIELDS.gestorPl) || '').trim()
    if (!g) return
    map[g] = (map[g] || 0) + parseNum(pick(row, FIELDS.pl))
  })
  return map
}

// Indexa o BLC tratado por ativo: { CD_ATIVO: [{ gestor, valor }, ...] }
export function buildBlcIndex(blc) {
  const map = {}
  ;(blc || []).forEach(row => {
    const cd = (pick(row, FIELDS.cdAtivo) || '').trim()
    if (!cd) return
    if (!map[cd]) map[cd] = []
    map[cd].push({
      gestor: (pick(row, FIELDS.gestorBlc) || '').trim(),
      valor: parseNum(pick(row, FIELDS.vlAloc)),
    })
  })
  return map
}

// Indexa as taxas ANBIMA por ticker (normalizado em maiusculas).
export function buildAnbimaIndex(anbima) {
  const map = {}
  ;(anbima || []).forEach(row => {
    const t = (row['ticker'] || '').trim().toUpperCase()
    if (t) map[t] = row
  })
  return map
}

// Indexa a base de recompra antecipada / breakeven (Anbima_BE.csv, gerado por
// preparar-anbima-be.mjs) por ticker. Converte os campos numericos para numero
// (mantendo taxa negativa) e vazio -> null. Conceito separado de Taxa/Tx Anbima.
export function buildAnbimaBEIndex(anbimaBE) {
  const map = {}
  const num = (row, k) => { const v = (row[k] ?? '').trim(); return v === '' ? null : parseNum(v) }
  ;(anbimaBE || []).forEach(row => {
    const t = (row['ticker'] || '').trim().toUpperCase()
    if (!t) return
    map[t] = {
      ticker: t,
      statusExercicio: row['statusExercicio'] || '',
      dataEvento: (row['dataEvento'] || '').trim(),
      diasUteisAteEvento: num(row, 'diasUteisAteEvento'),
      pctPuPar: num(row, 'pctPuPar'),
      taxaEvento: num(row, 'taxaEvento'),
      tipoTaxa: row['tipoTaxa'] || '',
      remuneracao: row['remuneracao'] || '',
      dataReferencia: (row['dataReferencia'] || '').trim(),
      origemAba: row['origemAba'] || '',
    }
  })
  return map
}

export function enrichDebenture(deb, { emissorMap, blcByAtivo, anbimaByTicker, anbimaBEByTicker }) {
  const codigoAtivo = (pick(deb, FIELDS.codigoAtivo) || '').trim()
  const cnpjKey = normCNPJ(pick(deb, FIELDS.cnpjEmissor))
  const emissor = emissorMap[cnpjKey] || {}
  const anbima = (anbimaByTicker || {})[codigoAtivo.toUpperCase()] || null
  // Recompra antecipada / breakeven (fonte opcional; null quando o ticker nao consta).
  const recompra = (anbimaBEByTicker || {})[codigoAtivo.toUpperCase()] || null

  const blcRows = (blcByAtivo || {})[codigoAtivo] || []
  const alocacao = blcRows.reduce((s, r) => s + r.valor, 0)

  // Gestores que alocam nesse ativo (BLC ja vem agregado por gestor)
  const gestores = [...new Set(
    blcRows.filter(r => r.valor > 0 && r.gestor).map(r => r.gestor)
  )]

  const qtd = parseNum(pick(deb, FIELDS.qtdMercado))
  const vna = parseNum(pick(deb, FIELDS.vna))

  // Data de registro CVM: guarda contra erro da fonte (data futura -> invalida).
  // 'emissao' e' mantido intacto: alimenta o cronograma de fluxo (parseAgenda) e
  // o casamento dos books de primario -- nao pode virar a data de registro.
  const regRaw = pick(deb, FIELDS.registroCvm)
  const registroCvm = regRaw && dateKey(regRaw) > HOJE_KEY ? '' : regRaw

  return {
    ...deb,
    codigoAtivo,
    taxa:          pick(deb, FIELDS.taxa),
    vencimento:    pick(deb, FIELDS.vencimento),
    emissao:       pick(deb, FIELDS.emissao),
    registroCvm,
    indexador:     pick(deb, FIELDS.indexador),
    coordenador:   pick(deb, FIELDS.coordenador),
    garantia:      pick(deb, FIELDS.garantia),
    lei12431Str:   pick(deb, FIELDS.lei12431),
    descricao:     pick(deb, FIELDS.descricao),
    emissorNome:   pick(emissor, FIELDS.empresaNome) || cnpjKey || '—',
    grupo:         pick(emissor, FIELDS.grupo) || '',
    setor:         pick(emissor, FIELDS.setor) || '',
    gestores,
    alocacao,
    volumeEmitido: qtd * vna,
    // ANBIMA (ja calculado na etapa de preparacao). '—' quando o ticker nao consta.
    txAnbima: (anbima && anbima['txAnbimaFormatada']) ? anbima['txAnbimaFormatada'] : '—',
    // Duration em anos (dias uteis / 252, ja convertido na preparacao).
    durationAnbima: (anbima && anbima['durationAnbimaAnos']) ? anbima['durationAnbimaAnos'] : '—',
    anbimaInfo: anbima,
    // Recompra antecipada / breakeven (objeto ou null). Conceito separado de Taxa/Tx Anbima.
    recompra,
  }
}

// Ordena as faixas de volume do REUNE por liquidez (para ordenacao/realce).
const REUNE_VOL_RANK = { 'Até 1MM': 1, 'Entre 1MM e 5MM': 2, 'Superior a 5MM': 3 }

// Enriquece as previas de negociacao do REUNE (mercado secundario) com o
// emissor/grupo/setor que o app ja' conhece por ticker, marcando se o papel
// esta' na carteira acompanhada (alocacao > 0). Uma linha = uma debenture
// negociada no dia. tickerToAsset: Map(codigoAtivo MAIUSCULO -> asset enriquecido).
export function enrichReune(reuneRows, tickerToAsset, curvasPorData) {
  const map = tickerToAsset || new Map()
  return (reuneRows || []).map(r => {
    const ticker = (r['Ativo'] || '').trim()
    const asset = map.get(ticker.toUpperCase()) || {}
    const faixa = (r['Faixa de Volume'] || '').trim()
    const data = (r['Data'] || '').trim()
    // Spread sobre a referencia (metodologia do Tx Anbima), com a curva TPF da
    // PROPRIA data do trade. null quando falta curva do dia ou indexador nao coberto.
    const spreadRef = converterSpreadSec({
      taxa: r['Taxa Media'],
      indexador: asset.indexador,
      tipoTaxaAnbima: asset.anbimaInfo && asset.anbimaInfo.tipoTaxaAnbima,
      vencimento: asset.vencimento,
      data,
    }, curvasPorData)
    return {
      codigoAtivo: ticker,
      data,   // yyyy-MM-dd (formato long: uma linha por ativo x dia)
      taxaMin: r['Taxa Minima'], taxaMed: r['Taxa Media'], taxaMax: r['Taxa Maxima'],
      puMed: r['PU Medio'],
      faixaVolume: faixa,
      volRank: REUNE_VOL_RANK[faixa] || 0,
      taxaMedNum: parseNum(r['Taxa Media']),
      puMedNum: parseNum(r['PU Medio']),
      emissorNome: asset.emissorNome || '—',
      grupo: asset.grupo || '',
      setor: asset.setor || '',
      alocacao: asset.alocacao || 0,
      // Caracteristicas da emissao (do cadastro que o app ja' conhece por ticker).
      vencimento: asset.vencimento || '',
      duration: asset.durationAnbima || '',
      txEmissao: asset.taxa || '',
      indexador: asset.indexador || '',
      lei12431: asset.lei12431Str || '',
      spreadRef,   // { tipo, formatada, spreadNum, ref } ou null
    }
  })
}

// Mapeia o tipoTaxaAnbima (Indexador da base) -> tipo do spreadRef que o
// SecondaryTable/Chart entendem (dirige a familia bps/pct do grafico).
const TIPO_SPREAD_MERCADO = { DI_SPREAD: 'DI+', IPCA_SPREAD: 'IPCA', DI_PERCENTUAL: '%DI', PREFIXADO: 'PRE' }
// Faixa de volume derivada do R$ REAL de mercado (mantem o filtro/ordenacao/
// liquidez que a aba ja' usa; a celula exibe o R$ puro).
function faixaDeVolMercado(v) {
  if (v == null) return { faixa: '', rank: 0 }
  if (v > 5e6) return { faixa: 'Superior a 5MM', rank: 3 }
  if (v > 1e6) return { faixa: 'Entre 1MM e 5MM', rank: 2 }
  return { faixa: 'Até 1MM', rank: 1 }
}

// Enriquece a base MERCADO VERDADEIRO (public/Mercado_Verdadeiro.csv) com o
// cadastro que o app conhece por ticker. Uma linha = uma debenture com negocio
// DE MERCADO no dia (direta/orfao ja' foi removido pela varredura). Substitui o
// enrichReune como fonte da aba Secundario: volume = R$ real; taxa/PU/spread = os
// valores LIMPOS (meio das pontas, sem fee do broker). Spread ja' vem calculado
// na base (com a NTN-B de referencia da ANBIMA) -> nao reusa converterSpreadSec.
export function enrichMercado(mercadoRows, tickerToAsset) {
  const map = tickerToAsset || new Map()
  const out = []
  for (const r of mercadoRows || []) {
    const vol = parseNum(r['VolMercado'])
    if (vol == null || vol <= 0) continue   // so' negocio de mercado
    const ticker = (r['Ativo'] || '').trim()
    const asset = map.get(ticker.toUpperCase()) || {}
    const data = (r['Data'] || '').trim()
    // Taxa_mid vem com ponto/4 casas na base; exibe em pt-BR com 2 casas (padrao do app).
    const taxaRaw = (r['Taxa_mid'] || '').trim()
    const taxaNum = taxaRaw ? parseNum(taxaRaw) : null
    const taxaMed = taxaNum != null ? taxaNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
    const spreadFmt = (r['SpreadFmt'] || '').trim()
    const spreadRef = spreadFmt ? {
      tipo: TIPO_SPREAD_MERCADO[(r['Indexador'] || '').trim()] || null,
      formatada: spreadFmt,
      spreadNum: parseNum(r['Spread']),
      ref: (r['RefSpread'] || '').trim(),
    } : null
    const { faixa, rank } = faixaDeVolMercado(vol)
    out.push({
      codigoAtivo: ticker,
      data,
      taxaMin: taxaMed, taxaMed, taxaMax: taxaMed,
      puMed: r['PU_mid'],
      volumeRs: vol,
      faixaVolume: faixa,
      volRank: rank,
      taxaMedNum: taxaNum,
      puMedNum: parseNum(r['PU_mid']),
      emissorNome: asset.emissorNome || '—',
      grupo: asset.grupo || '',
      setor: asset.setor || '',
      alocacao: asset.alocacao || 0,
      vencimento: asset.vencimento || '',
      duration: asset.durationAnbima || (r['DurationAnos'] || ''),
      txEmissao: asset.taxa || '',
      indexador: asset.indexador || '',
      lei12431: asset.lei12431Str || '',
      spreadRef,
    })
  }
  return out
}

// Indexa as curvas de TPF (REUNE_Curvas.csv) por data:
//   dataISO -> { ntnb: [{venc, taxa}], ltn: [{venc, taxa}] }
// Consumido por converterSpreadSec (via enrichReune) p/ o "Spread ref." do
// secundario. Curva por dia -> conversao precisa em cada data historica.
export function buildCurvasPorData(rows) {
  const map = new Map()
  ;(rows || []).forEach(r => {
    const data = (r['data'] || '').trim()
    const tipo = (r['tipo'] || '').trim().toUpperCase()
    const venc = (r['vencimento'] || '').trim()
    const taxa = parseNum(r['taxa'])
    if (!data || !venc || taxa == null || isNaN(taxa)) return
    if (!map.has(data)) map.set(data, { ntnb: [], ltn: [] })
    const c = map.get(data)
    if (tipo === 'NTN-B') c.ntnb.push({ venc, taxa })
    else if (tipo === 'LTN') c.ltn.push({ venc, taxa })
  })
  return map
}

export function computeManagers(blcRows, plByGestor) {
  // PL por gestor é passado pronto (vem do PL_Gestores.csv). Fixo, nao varia com filtro.

  // Alocacao por gestor — do BLC tratado (ja agregado por gestor)
  const alocByGestor = {}
  ;(blcRows || []).forEach(row => {
    const g = (pick(row, FIELDS.gestorBlc) || '').trim()
    if (!g) return
    alocByGestor[g] = (alocByGestor[g] || 0) + parseNum(pick(row, FIELDS.vlAloc))
  })

  return Object.keys(alocByGestor)
    .map(g => ({ gestor: g, alocacao: alocByGestor[g], pl: plByGestor[g] || 0 }))
    .filter(m => m.alocacao > 0)
    .sort((a, b) => b.alocacao - a.alocacao)
}

/** Recompute alocacao for each asset counting only the selected gestor's BLC rows */
export function recomputeAlocByGestor(assets, blcByAtivo, gestor) {
  return assets.map(a => {
    const rows = blcByAtivo[a.codigoAtivo] || []
    const alocacao = rows
      .filter(r => r.gestor === gestor)
      .reduce((s, r) => s + r.valor, 0)
    return { ...a, alocacao }
  })
}

export function computeGroups(assets) {
  const grp = {}
  assets.forEach(a => {
    if (!a.grupo) return
    if (!grp[a.grupo]) grp[a.grupo] = { grupo: a.grupo, alocacao: 0 }
    grp[a.grupo].alocacao += a.alocacao
  })
  return Object.values(grp).filter(g => g.alocacao > 0).sort((a, b) => b.alocacao - a.alocacao)
}

import { parseNum, normCNPJ } from './format.js'

const FIELDS = {
  codigoAtivo:    ['Codigo do Ativo', 'Código do Ativo', 'Codigo Ativo', 'CODIGO_ATIVO'],
  cnpjEmissor:    ['CNPJ Emissor', 'CNPJ do Emissor', 'CNPJ_EMISSOR'],
  qtdMercado:     ['Quantidade em Mercado', 'Qtd em Mercado', 'Quantidade Mercado'],
  vna:            ['Valor Nominal Atual', 'VNA'],
  taxa:           ['Juros Criterio Novo - Taxa', 'Taxa', 'Juros - Taxa', 'Taxa de Juros'],
  vencimento:     ['Data de Vencimento', 'Vencimento', 'Dt Vencimento', 'DT_VENC'],
  emissao:        ['Data de Emissao', 'Data de Emissão', 'Emissao', 'Dt Emissao'],
  indexador:      ['Indexador', 'Indice', 'Índice'],
  coordenador:    ['Coordenador Lider', 'Coordenador Líder', 'Coordenador', 'Lead Manager'],
  garantia:       ['Garantia', 'Tipo de Garantia'],
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

export function enrichDebenture(deb, { emissorMap, blcByAtivo, anbimaByTicker }) {
  const codigoAtivo = (pick(deb, FIELDS.codigoAtivo) || '').trim()
  const cnpjKey = normCNPJ(pick(deb, FIELDS.cnpjEmissor))
  const emissor = emissorMap[cnpjKey] || {}
  const anbima = (anbimaByTicker || {})[codigoAtivo.toUpperCase()] || null

  const blcRows = (blcByAtivo || {})[codigoAtivo] || []
  const alocacao = blcRows.reduce((s, r) => s + r.valor, 0)

  // Gestores que alocam nesse ativo (BLC ja vem agregado por gestor)
  const gestores = [...new Set(
    blcRows.filter(r => r.valor > 0 && r.gestor).map(r => r.gestor)
  )]

  const qtd = parseNum(pick(deb, FIELDS.qtdMercado))
  const vna = parseNum(pick(deb, FIELDS.vna))

  return {
    ...deb,
    codigoAtivo,
    taxa:          pick(deb, FIELDS.taxa),
    vencimento:    pick(deb, FIELDS.vencimento),
    emissao:       pick(deb, FIELDS.emissao),
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
  }
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

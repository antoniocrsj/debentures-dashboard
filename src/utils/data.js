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
  // fundos
  cnpjFundo:      ['CNPJ Fundo', 'CNPJ do Fundo', 'CNPJ_FUNDO'],
  gestorApelido:  ['Gestor Apelido', 'Gestor', 'NM_GESTOR'],
  pl:             ['PL', 'Patrimonio Liquido', 'Patrimônio Líquido', 'Patrimônio Líquido (R$)', 'VL_PATRIM_LIQ'],
  // BLC
  cdAtivo:        ['CD_ATIVO', 'Codigo do Ativo', 'Codigo Ativo'],
  cnpjFundoBlc:   ['CNPJ_FUNDO_CLASSE', 'CNPJ_FUNDO', 'CNPJ Fundo'],
  vlMerc:         ['VL_MERC_POS_FINAL', 'VL_MERC', 'Valor Mercado'],
}

function pick(row, keys) {
  for (const k of keys) if (k in row) return row[k]
  return ''
}

export function buildIndexes({ emissores, fundos }) {
  const emissorMap = {}
  emissores.forEach(e => {
    const key = normCNPJ(pick(e, FIELDS.cnpjEmissor))
    if (key) emissorMap[key] = e
  })

  const fundoMap = {}
  fundos.forEach(f => {
    const key = normCNPJ(pick(f, FIELDS.cnpjFundo))
    if (key) fundoMap[key] = f
  })

  return { emissorMap, fundoMap }
}

export function buildBlcIndex(blc) {
  const map = {}
  blc.forEach(row => {
    const cd = (pick(row, FIELDS.cdAtivo) || '').trim()
    if (!map[cd]) map[cd] = []
    map[cd].push(row)
  })
  return map
}

export function enrichDebenture(deb, { emissorMap, blcByAtivo, fundoMap }) {
  const codigoAtivo = (pick(deb, FIELDS.codigoAtivo) || '').trim()
  const cnpjKey = normCNPJ(pick(deb, FIELDS.cnpjEmissor))
  const emissor = emissorMap[cnpjKey] || {}

  const blcRows = (blcByAtivo || {})[codigoAtivo] || []
  const alocacao = blcRows.reduce((s, r) => s + parseNum(pick(r, FIELDS.vlMerc)), 0)

  // Gestores que alocam nesse ativo
  const gestores = []
  if (fundoMap) {
    const seen = new Set()
    blcRows.forEach(r => {
      const cnpj = normCNPJ(pick(r, FIELDS.cnpjFundoBlc))
      const fundo = fundoMap[cnpj]
      if (!fundo) return
      const g = (pick(fundo, FIELDS.gestorApelido) || '').trim()
      if (g && !seen.has(g)) { seen.add(g); gestores.push(g) }
    })
  }

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
  }
}

export function computeManagers(blcRows, fundoMap) {
  const mgr = {}
  const counted = {}

  blcRows.forEach(row => {
    const cnpjKey = normCNPJ(pick(row, FIELDS.cnpjFundoBlc))
    const fundo = fundoMap[cnpjKey]
    if (!fundo) return
    const gestor = (pick(fundo, FIELDS.gestorApelido) || 'N/A').trim()
    if (!mgr[gestor]) { mgr[gestor] = { gestor, alocacao: 0, pl: 0 }; counted[gestor] = new Set() }
    mgr[gestor].alocacao += parseNum(pick(row, FIELDS.vlMerc))
    if (!counted[gestor].has(cnpjKey)) {
      counted[gestor].add(cnpjKey)
      mgr[gestor].pl += parseNum(pick(fundo, FIELDS.pl))
    }
  })

  return Object.values(mgr).filter(m => m.alocacao > 0).sort((a, b) => b.alocacao - a.alocacao)
}

/** Recompute alocacao for each asset counting only the selected gestor's BLC rows */
export function recomputeAlocByGestor(assets, blcByAtivo, fundoMap, gestor) {
  const gestorCNPJs = new Set()
  Object.entries(fundoMap).forEach(([cnpj, fundo]) => {
    if ((pick(fundo, FIELDS.gestorApelido) || '').trim() === gestor) gestorCNPJs.add(cnpj)
  })
  return assets.map(a => {
    const rows = blcByAtivo[a.codigoAtivo] || []
    const alocacao = rows.reduce((s, r) => {
      const cnpj = normCNPJ(pick(r, FIELDS.cnpjFundoBlc))
      return gestorCNPJs.has(cnpj) ? s + parseNum(pick(r, FIELDS.vlMerc)) : s
    }, 0)
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

// Funções puras (sem React, testáveis) para a aba de Captação / Fluxo dos fundos.
// Contrato do CSV: Semana, Gestor_Apelido, Captacao, Resgate, Liquido, PL_Medio, Num_Fundos
//
// IMPORTANTE sobre PL: a coluna PL_Medio já é o PL TOTAL do gestor naquela semana
// (soma dos fundos do gestor, suavizada nos dias). PL é ESTOQUE, não fluxo:
//   - PL total da semana   = soma de PL_Medio entre gestores do recorte
//   - PL total médio        = média dos PLs totais semanais no período
//   - PL mais recente       = PL total da semana mais recente
import { parseNum } from './format.js'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const NBSP = ' '

// ───────────────────────── Parsing ─────────────────────────

/** Converte a célula "Semana" em { key, date, label } ou null. Datas locais (sem UTC). */
export function parseSemana(str) {
  if (!str) return null
  const s = String(str).trim()
  let y, m, d
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] }
  else {
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (!br) return null
    d = +br[1]; m = +br[2]; y = +br[3]
  }
  const date = new Date(y, m - 1, d)   // construtor local — não desloca por fuso
  if (isNaN(date.getTime())) return null
  const p = n => String(n).padStart(2, '0')
  return { key: `${y}-${p(m)}-${p(d)}`, date, label: `${p(d)}/${p(m)}` }
}

/** Normaliza uma linha do CSV. Resgate sempre absoluto; Líquido = Captação − Resgate. */
export function normalizeRow(row) {
  const wk = parseSemana(row.Semana ?? row.semana)
  const gestor = String(row.Gestor_Apelido ?? row.gestor ?? '').trim()
  if (!wk || !gestor) return null
  const captacao = Math.abs(parseNum(row.Captacao))
  const resgate  = Math.abs(parseNum(row.Resgate))
  // DataBase = ultimo dia com dado naquela semana (DT_COMPTC max). Cai p/ a semana se ausente.
  const base = parseSemana(row.DataBase ?? row.dataBase)
  return {
    weekKey: wk.key,
    weekDate: wk.date,
    weekLabel: wk.label,
    dataBase: base ? base.key : wk.key,
    gestor,
    captacao,
    resgate,
    liquido: captacao - resgate,   // sempre calculado; ignora a coluna Liquido do CSV
    plSemana: parseNum(row.PL_Medio), // PL TOTAL do gestor naquela semana
    numFundos: Math.round(parseNum(row.Num_Fundos)),
  }
}

/** Data do dado mais recente da base (max DataBase). É o "atualizada até" real. */
export function latestBaseDate(rows) {
  if (!rows || !rows.length) return null
  let max = ''
  for (const r of rows) { const d = r.dataBase || r.weekKey; if (d > max) max = d }
  return max || null
}

/** Normaliza a base inteira. Retorna { rows (ordenadas por semana asc), invalid }. */
export function normalizeFluxo(rawRows) {
  const rows = []
  let invalid = 0
  for (const r of rawRows || []) {
    const n = normalizeRow(r)
    if (n) rows.push(n)
    else invalid++
  }
  rows.sort((a, b) => a.weekDate - b.weekDate)
  return { rows, invalid }
}

// ───────────────────────── Período ─────────────────────────

/** Menor e maior semana da base (assume rows ordenadas asc). */
export function periodBounds(rows) {
  if (!rows || !rows.length) return { min: null, max: null }
  return { min: rows[0].weekDate, max: rows[rows.length - 1].weekDate }
}

/** Data inicial para um atalho de N meses, relativa à semana mais RECENTE da base. */
export function startForMonths(rows, months) {
  if (!rows || !rows.length || months == null) return null
  const max = rows[rows.length - 1].weekDate
  if (months === '1w') return new Date(max)
  const d = new Date(max)
  d.setMonth(d.getMonth() - months)
  return d
}

/** Filtra por gestor (vazio = todos) e por intervalo [start, end]. */
export function filterFluxo(rows, { gestor = '', start = null, end = null } = {}) {
  return (rows || []).filter(r => {
    if (gestor && r.gestor !== gestor) return false
    if (start && r.weekDate < start) return false
    if (end && r.weekDate > end) return false
    return true
  })
}

// ───────────────────────── Mensal (agregado do diário) ─────────────────────────
//  A base mensal vem por (mês, gestor) já agregada na preparação DIRETO do diário
//  (não da semana), então uma semana que cruza dois meses não causa duplicidade.

/** 'AAAA-MM' (ou 'AAAA-MM-DD') → { key, date, year, month } | null */
export function parseMes(str) {
  const m = String(str || '').trim().match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  const year = +m[1], month = +m[2]
  if (month < 1 || month > 12) return null
  return { key: `${m[1]}-${m[2]}`, date: new Date(year, month - 1, 1), year, month }
}

/** Normaliza uma linha da base MENSAL (Mes, Gestor_Apelido, Captacao, Resgate). */
export function normalizeMonthRow(row) {
  const mes = parseMes(row.Mes ?? row.mes)
  const gestor = String(row.Gestor_Apelido ?? row.gestor ?? '').trim()
  if (!mes || !gestor) return null
  const captacao = Math.abs(parseNum(row.Captacao))
  const resgate  = Math.abs(parseNum(row.Resgate))
  return { mesKey: mes.key, mesDate: mes.date, gestor, captacao, resgate, liquido: captacao - resgate }
}

export function normalizeMensal(rawRows) {
  const rows = []
  let invalid = 0
  for (const r of rawRows || []) { const n = normalizeMonthRow(r); if (n) rows.push(n); else invalid++ }
  return { rows, invalid }
}

/** Filtra linhas mensais por gestor (vazio = todos). */
export function filterMensal(rows, gestor = '') {
  return (rows || []).filter(r => !gestor || r.gestor === gestor)
}

function ymKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/**
 * Agrega por mês (soma os gestores do recorte) preenchendo TODOS os meses do
 * intervalo com ZERO. Intervalo = interseção de [start,end] (período) com o
 * intervalo real dos dados (allRows) — evita meses inteiramente antes da base.
 * start/end são Date ou null. Ordem cronológica ascendente.
 */
export function aggregateByMonth(rows, start, end, allRows) {
  const sum = new Map()
  for (const r of rows || []) {
    let s = sum.get(r.mesKey)
    if (!s) { s = { captacao: 0, resgate: 0 }; sum.set(r.mesKey, s) }
    s.captacao += r.captacao
    s.resgate  += r.resgate
  }
  const pool = (allRows && allRows.length ? allRows : rows) || []
  if (!pool.length) return []
  const keys = pool.map(r => r.mesKey)
  const dataMin = keys.reduce((a, b) => (a < b ? a : b))
  const dataMax = keys.reduce((a, b) => (a > b ? a : b))
  let startKey = start ? ymKey(start) : dataMin
  let endKey   = end   ? ymKey(end)   : dataMax
  if (startKey < dataMin) startKey = dataMin
  if (endKey   > dataMax) endKey   = dataMax
  if (startKey > endKey) return []
  const out = []
  let y = +startKey.slice(0, 4), m = +startKey.slice(5, 7)
  const ey = +endKey.slice(0, 4), em = +endKey.slice(5, 7)
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const s = sum.get(key) || { captacao: 0, resgate: 0 }
    out.push({ mesKey: key, captacao: s.captacao, resgate: s.resgate, liquido: s.captacao - s.resgate })
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

// ───────────────────────── Agregações ─────────────────────────

/**
 * Um ponto por semana (soma os gestores do recorte).
 * plTotal  = soma de plSemana entre gestores (PL total da semana).
 * numFundos = soma dos fundos (cada fundo é de um único gestor → sem dupla contagem).
 */
/** Semana "em andamento": a DataBase (último dia com dado) é anterior à sexta
 *  daquela semana (segunda + 4). Ex.: dado até quarta → semana ainda incompleta. */
export function semanaParcial(weekKey, dataBase) {
  const wk = parseSemana(weekKey), db = parseSemana(dataBase)
  if (!wk || !db) return false
  const sexta = new Date(wk.date); sexta.setDate(sexta.getDate() + 4)
  return db.date < sexta
}

export function aggregateByWeek(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let w = map.get(r.weekKey)
    if (!w) { w = { weekKey: r.weekKey, weekDate: r.weekDate, weekLabel: r.weekLabel, dataBase: r.dataBase || '', captacao: 0, resgate: 0, plTotal: 0, numFundos: 0 }; map.set(r.weekKey, w) }
    else if ((r.dataBase || '') > w.dataBase) w.dataBase = r.dataBase
    w.captacao += r.captacao
    w.resgate  += r.resgate
    w.plTotal  += r.plSemana
    w.numFundos += r.numFundos
  }
  return [...map.values()]
    .map(w => ({ ...w, liquido: w.captacao - w.resgate, parcial: semanaParcial(w.weekKey, w.dataBase) }))
    .sort((a, b) => a.weekDate - b.weekDate)
}

/**
 * Uma linha por gestor no período (ranking).
 * plTotalMedio = média, no tempo, do PL total semanal do gestor.
 * plRecente    = PL total do gestor na semana mais recente em que ele aparece.
 * LIMITAÇÃO: a base já vem agregada por (semana, gestor); fundos únicos no período não são
 * recuperáveis — numFundos é a média de fundos por semana (arredondada).
 */
export function aggregateByGestor(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let g = map.get(r.gestor)
    if (!g) { g = { gestor: r.gestor, captacao: 0, resgate: 0, plSum: 0, weeks: 0, sumFundos: 0, lastDate: null, lastPL: 0 }; map.set(r.gestor, g) }
    g.captacao += r.captacao
    g.resgate  += r.resgate
    g.plSum    += r.plSemana
    g.weeks    += 1
    g.sumFundos += r.numFundos
    if (!g.lastDate || r.weekDate > g.lastDate) { g.lastDate = r.weekDate; g.lastPL = r.plSemana }
  }
  return [...map.values()].map(g => ({
    gestor: g.gestor,
    captacao: g.captacao,
    resgate: g.resgate,
    liquido: g.captacao - g.resgate,
    plTotalMedio: g.weeks ? g.plSum / g.weeks : 0,
    plRecente: g.lastPL,
    numFundos: g.weeks ? Math.round(g.sumFundos / g.weeks) : 0,
  }))
}

// ───────────────────────── Rentabilidade (%CDI por gestor) ─────────────────────────
// Contrato do CSV: Gestor_Apelido, Retorno_1s..Retorno_12m, PctCDI_1s..PctCDI_12m, DataBase
// PctCDI já vem em pontos percentuais (ex.: 105.4 = 105,4% do CDI). Célula vazia
// = sem histórico suficiente para aquela janela ainda (não é 0%).

/** Converte uma célula numérica opcional: '' ou ausente → null (não é zero). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = parseNum(v)
  return isNaN(n) ? null : n
}

/** Parseia uma linha do CSV de rentabilidade. */
export function normalizeRentabilidadeRow(row) {
  const gestor = String(row.Gestor_Apelido ?? row.gestor ?? '').trim()
  if (!gestor) return null
  return {
    gestor,
    pctCdi1s:  numOrNull(row.PctCDI_1s),
    pctCdi1m:  numOrNull(row.PctCDI_1m),
    pctCdi3m:  numOrNull(row.PctCDI_3m),
    pctCdi6m:  numOrNull(row.PctCDI_6m),
    pctCdi12m: numOrNull(row.PctCDI_12m),
    dataBase: row.DataBase ?? row.dataBase ?? '',
  }
}

/** Mapa gestor → linha de rentabilidade, a partir do CSV bruto. */
export function normalizeRentabilidade(rawRows) {
  const map = new Map()
  for (const r of rawRows || []) {
    const n = normalizeRentabilidadeRow(r)
    if (n) map.set(n.gestor, n)
  }
  return map
}

/** Junta rentabilidade (%CDI por janela) no ranking de gestores (aggregateByGestor). */
export function mergeRentabilidade(ranking, rentMap) {
  return (ranking || []).map(g => {
    const r = rentMap?.get(g.gestor)
    return {
      ...g,
      pctCdi1s:  r ? r.pctCdi1s  : null,
      pctCdi1m:  r ? r.pctCdi1m  : null,
      pctCdi3m:  r ? r.pctCdi3m  : null,
      pctCdi6m:  r ? r.pctCdi6m  : null,
      pctCdi12m: r ? r.pctCdi12m : null,
    }
  })
}

// ───────────────────────── Fundos de um gestor (Captação) ─────────────────────────
// Base semanal POR FUNDO (Fluxo_Semanal_Fundos_*.csv): mesma estrutura da base de
// gestores, com CNPJ_Fundo no lugar. Alimenta a tabela que abre ao clicar numa
// gestora — as colunas de fluxo reagem ao período pelo MESMO caminho de cálculo do
// ranking de gestores (filterFluxo + aggregate), então os fundos somam o total do
// gestor. O %CDI de cada fundo (do próprio fundo) vem de Fluxo_Fundos_*.csv.

/** Normaliza uma linha da base semanal por fundo. */
export function normalizeFundoRow(row) {
  const wk = parseSemana(row.Semana ?? row.semana)
  const cnpj = String(row.CNPJ_Fundo ?? row.cnpj ?? '').replace(/\D/g, '')
  if (!wk || !cnpj) return null
  const captacao = Math.abs(parseNum(row.Captacao))
  const resgate  = Math.abs(parseNum(row.Resgate))
  const base = parseSemana(row.DataBase ?? row.dataBase)
  return {
    weekKey: wk.key,
    weekDate: wk.date,
    dataBase: base ? base.key : wk.key,
    cnpj,
    gestor: String(row.Gestor_Apelido ?? row.gestor ?? '').trim(),
    captacao,
    resgate,
    liquido: captacao - resgate,
    plSemana: parseNum(row.PL_Medio),
  }
}

export function normalizeFluxoFundos(rawRows) {
  const rows = []
  for (const r of rawRows || []) { const n = normalizeFundoRow(r); if (n) rows.push(n) }
  rows.sort((a, b) => a.weekDate - b.weekDate)
  return rows
}

/** Filtra linhas de fundo por gestor e intervalo [start, end] (mesma lógica de filterFluxo). */
export function filterFundos(rows, { gestor = '', start = null, end = null } = {}) {
  return (rows || []).filter(r => {
    if (gestor && r.gestor !== gestor) return false
    if (start && r.weekDate < start) return false
    if (end && r.weekDate > end) return false
    return true
  })
}

/** Agrega por fundo (soma sobre o recorte), espelhando aggregateByGestor. */
export function aggregateByFundo(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let f = map.get(r.cnpj)
    if (!f) { f = { cnpj: r.cnpj, gestor: r.gestor, captacao: 0, resgate: 0, lastDate: null, lastPL: 0 }; map.set(r.cnpj, f) }
    f.captacao += r.captacao
    f.resgate  += r.resgate
    if (!f.lastDate || r.weekDate > f.lastDate) { f.lastDate = r.weekDate; f.lastPL = r.plSemana }
  }
  return [...map.values()].map(f => ({
    cnpj: f.cnpj,
    gestor: f.gestor,
    captacao: f.captacao,
    resgate: f.resgate,
    liquido: f.captacao - f.resgate,
    plRecente: f.lastPL,
  }))
}

/** Mapa CNPJ → { nome, gestor, pctCdi* }, a partir do CSV Fluxo_Fundos_*.csv. */
export function normalizeFundosMeta(rawRows) {
  const map = new Map()
  for (const r of rawRows || []) {
    const cnpj = String(r.CNPJ_Fundo ?? r.cnpj ?? '').replace(/\D/g, '')
    if (!cnpj) continue
    map.set(cnpj, {
      nome: String(r.Nome_Fundo ?? r.nome ?? '').trim(),
      gestor: String(r.Gestor_Apelido ?? r.gestor ?? '').trim(),
      pctCdi1s:  numOrNull(r.PctCDI_1s),
      pctCdi1m:  numOrNull(r.PctCDI_1m),
      pctCdi3m:  numOrNull(r.PctCDI_3m),
      pctCdi6m:  numOrNull(r.PctCDI_6m),
      pctCdi12m: numOrNull(r.PctCDI_12m),
    })
  }
  return map
}

/**
 * Conjunto de CNPJs de fundos de condomínio FECHADO, a partir de
 * Fundos_Atributos.csv (col Forma_Condominio). Fundos fechados captam por
 * emissão de cotas (fluxo esporádico), então o usuário pode querer ocultá-los
 * da leitura de captação. Retorna Set<cnpj (só dígitos)>.
 */
export function normalizeFechados(rawRows) {
  const set = new Set()
  for (const r of rawRows || []) {
    const cnpj = String(r.CNPJ_FUNDO_CLASSE ?? r.CNPJ ?? r.cnpj ?? '').replace(/\D/g, '')
    if (!cnpj) continue
    const forma = String(r.Forma_Condominio ?? r.forma ?? '').trim()
    if (/fechad/i.test(forma)) set.add(cnpj)
  }
  return set
}

/**
 * Remove os fluxos de fundos FECHADOS das linhas por gestor (a base de cabeçalho:
 * cards, semanas, ranking). Para cada (semana, gestor) subtrai captação/resgate/PL
 * e a contagem dos fundos fechados, usando a base POR FUNDO (fundosSemana).
 *
 * Seguro por construção: um fundo fechado é subconjunto do próprio gestor, então
 * o fluxo fechado nunca excede o total do gestor — a subtração nunca fica negativa.
 * Onde a base por fundo estiver incompleta, subtrai de menos (conservador: deixa
 * algum fluxo fechado), nunca demais. Se não há fechados, devolve as linhas como estão.
 */
export function excludeFechados(rows, fundosSemana, fechadosSet) {
  if (!fechadosSet || fechadosSet.size === 0) return rows || []
  const closed = new Map()   // `${weekKey}|${gestor}` → { cap, res, pl, cnpjs:Set }
  for (const f of fundosSemana || []) {
    if (!fechadosSet.has(f.cnpj)) continue
    const k = `${f.weekKey}|${f.gestor}`
    let c = closed.get(k)
    if (!c) { c = { cap: 0, res: 0, pl: 0, cnpjs: new Set() }; closed.set(k, c) }
    c.cap += f.captacao
    c.res += f.resgate
    c.pl  += f.plSemana
    c.cnpjs.add(f.cnpj)
  }
  return (rows || []).map(r => {
    const c = closed.get(`${r.weekKey}|${r.gestor}`)
    if (!c) return r
    const captacao = Math.max(0, r.captacao - c.cap)
    const resgate  = Math.max(0, r.resgate  - c.res)
    return {
      ...r,
      captacao,
      resgate,
      liquido: captacao - resgate,
      plSemana: Math.max(0, r.plSemana - c.pl),
      numFundos: Math.max(0, r.numFundos - c.cnpjs.size),
    }
  })
}

/** Junta nome + %CDI (do próprio fundo) nas linhas agregadas por fundo.
 *  fechadosSet (opcional): marca cada fundo com `fechado` (condomínio fechado). */
export function mergeFundos(fundoRows, metaMap, fechadosSet = null) {
  return (fundoRows || []).map(f => {
    const m = metaMap?.get(f.cnpj)
    return {
      ...f,
      nome: m?.nome || f.cnpj,
      fechado: fechadosSet ? fechadosSet.has(f.cnpj) : false,
      pctCdi1s:  m ? m.pctCdi1s  : null,
      pctCdi1m:  m ? m.pctCdi1m  : null,
      pctCdi3m:  m ? m.pctCdi3m  : null,
      pctCdi6m:  m ? m.pctCdi6m  : null,
      pctCdi12m: m ? m.pctCdi12m : null,
    }
  })
}

/** Indicadores agregados do período (cards). */
export function computeCards(rows) {
  const weeks = aggregateByWeek(rows)
  const captacao = (rows || []).reduce((s, r) => s + r.captacao, 0)
  const resgate  = (rows || []).reduce((s, r) => s + r.resgate, 0)
  const numFundos = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.numFundos, 0) / weeks.length) : 0
  const plTotalMedio = weeks.length ? weeks.reduce((s, w) => s + w.plTotal, 0) / weeks.length : 0
  const ultimaSemana = weeks.length ? weeks[weeks.length - 1] : null
  const numGestores = new Set((rows || []).map(r => r.gestor)).size
  return {
    captacao,
    resgate,
    liquido: captacao - resgate,
    plTotalMedio,
    plRecente: ultimaSemana ? ultimaSemana.plTotal : 0,
    numFundos,
    numGestores,
    numSemanas: weeks.length,
    ultimaSemana,
  }
}

// ───────────────────────── Ordenação genérica ─────────────────────────

/** Ordena por uma função-chave. Numéricos por valor, texto por localeCompare. Nulos no fim. */
export function sortRows(list, keyFn, dir = 'desc') {
  const isNil = v => v == null || (typeof v === 'number' && isNaN(v))
  return [...(list || [])].sort((a, b) => {
    const va = keyFn(a), vb = keyFn(b)
    if (isNil(va) && isNil(vb)) return 0
    if (isNil(va)) return 1            // nulos sempre no fim
    if (isNil(vb)) return -1
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), 'pt-BR')
    return dir === 'asc' ? cmp : -cmp
  })
}

/** Gestores distintos, ordenados (seletor). */
export function gestorOptions(rows) {
  return [...new Set((rows || []).map(r => r.gestor))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

// ───────────────────────── Gráfico (séries e eixo) ─────────────────────────

/** Série do gráfico: resgate vira NEGATIVO só para exibição (cálculos seguem positivos). */
export function toChartSeries(weekly) {
  return (weekly || []).map(w => ({
    weekKey: w.weekKey,
    captacao: w.captacao,
    resgate: w.resgate,                 // positivo (para tooltip)
    resgateNeg: -Math.abs(w.resgate),   // negativo (apenas barra do gráfico)
    liquido: w.liquido,
    plTotal: w.plTotal,
  }))
}

/** 'AAAA-MM-DD' → 'jun/25' (sem Date, sem UTC). */
export function fmtMonthYY(ymd) {
  if (!ymd) return ''
  const m = String(ymd).match(/^(\d{4})-(\d{2})/)
  if (!m) return String(ymd)
  return `${MESES[+m[2] - 1]}/${m[1].slice(2)}`
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (tooltip). */
export function fmtWeekFull(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(ymd || '')
}

/** 'AAAA-MM-DD' → 'DD/MM/AA' (eixo do gráfico). */
export function fmtDayMonthYY(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(ymd || '')
}

/**
 * Escolhe os weekKeys para marcar no eixo X: ~1 por mês (primeira semana de cada mês),
 * reduzindo a frequência se passar de maxTicks (ex.: menos marcas no celular).
 */
export function monthTicks(weeks, maxTicks = 12) {
  const first = []
  const seen = new Set()
  for (const w of weeks || []) {
    const mk = w.weekKey.slice(0, 7)
    if (!seen.has(mk)) { seen.add(mk); first.push(w.weekKey) }
  }
  if (first.length <= maxTicks) return first
  const step = Math.ceil(first.length / maxTicks)
  return first.filter((_, i) => i % step === 0)
}

// ───────────────────────── Formatação ─────────────────────────

/** R$ compacto pt-BR: mil / mi / bi. Espaço não-separável entre valor e unidade. */
export function fmtFluxo(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const f = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
  if (abs >= 1e9) return `R$${NBSP}${f(n / 1e9)}${NBSP}bi`
  if (abs >= 1e6) return `R$${NBSP}${f(n / 1e6)}${NBSP}mi`
  if (abs >= 1e3) return `R$${NBSP}${f(n / 1e3, 0)}${NBSP}mil`
  return `R$${NBSP}${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/** Valor com sinal explícito (+/−) colado ao R$ — não depende de cor. Zero = "R$ 0". */
export function fmtFluxoSigned(n) {
  if (n == null || isNaN(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return sign + fmtFluxo(Math.abs(n))
}

/** Inteiro com separador de milhares pt-BR (ex.: 1.578). */
export function fmtInt(n) {
  if (n == null || isNaN(n)) return '—'
  return Math.round(n).toLocaleString('pt-BR')
}

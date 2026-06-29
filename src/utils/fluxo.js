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

// ───────────────────────── Agregações ─────────────────────────

/**
 * Um ponto por semana (soma os gestores do recorte).
 * plTotal  = soma de plSemana entre gestores (PL total da semana).
 * numFundos = soma dos fundos (cada fundo é de um único gestor → sem dupla contagem).
 */
export function aggregateByWeek(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let w = map.get(r.weekKey)
    if (!w) { w = { weekKey: r.weekKey, weekDate: r.weekDate, weekLabel: r.weekLabel, captacao: 0, resgate: 0, plTotal: 0, numFundos: 0 }; map.set(r.weekKey, w) }
    w.captacao += r.captacao
    w.resgate  += r.resgate
    w.plTotal  += r.plSemana
    w.numFundos += r.numFundos
  }
  return [...map.values()]
    .map(w => ({ ...w, liquido: w.captacao - w.resgate }))
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

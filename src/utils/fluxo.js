// Funções puras (sem React, testáveis) para a aba de Captação / Fluxo dos fundos.
// Contrato das colunas do CSV: Semana, Gestor_Apelido, Captacao, Resgate, Liquido, PL_Medio, Num_Fundos
import { parseNum } from './format.js'

// ───────────────────────── Parsing ─────────────────────────

/** Converte a célula "Semana" em { key, date, label } ou null se inválida. */
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
  const date = new Date(y, m - 1, d)
  if (isNaN(date.getTime())) return null
  const p = n => String(n).padStart(2, '0')
  return { key: `${y}-${p(m)}-${p(d)}`, date, label: `${p(d)}/${p(m)}` }
}

/** Normaliza uma linha do CSV. Resgate vira sempre absoluto; Líquido = Captação − Resgate. */
export function normalizeRow(row) {
  const wk = parseSemana(row.Semana ?? row.semana)
  const gestor = String(row.Gestor_Apelido ?? row.gestor ?? '').trim()
  if (!wk || !gestor) return null
  const captacao = Math.abs(parseNum(row.Captacao))
  const resgate  = Math.abs(parseNum(row.Resgate))
  return {
    weekKey: wk.key,
    weekDate: wk.date,
    weekLabel: wk.label,
    gestor,
    captacao,
    resgate,
    liquido: captacao - resgate,           // sempre calculado, ignora coluna Liquido do CSV
    plMedio: parseNum(row.PL_Medio),
    numFundos: Math.round(parseNum(row.Num_Fundos)),
  }
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

/** Data inicial para um atalho de N meses, relativa à semana mais recente. */
export function startForMonths(rows, months) {
  if (!rows || !rows.length || months == null) return null
  const max = rows[rows.length - 1].weekDate
  const d = new Date(max)
  d.setMonth(d.getMonth() - months)
  return d
}

// ───────────────────────── Filtragem ─────────────────────────

/** Filtra por gestor (vazio = todos) e por intervalo de datas [start, end]. */
export function filterFluxo(rows, { gestor = '', start = null, end = null } = {}) {
  return (rows || []).filter(r => {
    if (gestor && r.gestor !== gestor) return false
    if (start && r.weekDate < start) return false
    if (end && r.weekDate > end) return false
    return true
  })
}

// ───────────────────────── Agregações ─────────────────────────

/** Média ponderada de PL pelo número de fundos. */
function weightedPL(records) {
  let num = 0, den = 0
  for (const r of records) { num += r.plMedio * r.numFundos; den += r.numFundos }
  return den > 0 ? num / den : 0
}

/**
 * Um ponto por semana (soma os gestores do conjunto filtrado).
 * Num_Fundos por semana = soma dos fundos dos gestores naquela semana
 * (cada fundo pertence a um único gestor, então não há dupla contagem dentro da semana).
 */
export function aggregateByWeek(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let w = map.get(r.weekKey)
    if (!w) { w = { weekKey: r.weekKey, weekDate: r.weekDate, weekLabel: r.weekLabel, captacao: 0, resgate: 0, numFundos: 0, recs: [] }; map.set(r.weekKey, w) }
    w.captacao += r.captacao
    w.resgate  += r.resgate
    w.numFundos += r.numFundos
    w.recs.push(r)
  }
  return [...map.values()]
    .map(w => ({
      weekKey: w.weekKey, weekDate: w.weekDate, weekLabel: w.weekLabel,
      captacao: w.captacao, resgate: w.resgate, liquido: w.captacao - w.resgate,
      plMedio: weightedPL(w.recs), numFundos: w.numFundos,
    }))
    .sort((a, b) => a.weekDate - b.weekDate)
}

/**
 * Uma linha por gestor no período (para o ranking).
 * LIMITAÇÃO: como a base já vem agregada por (semana, gestor), o número de fundos
 * únicos no período não é recuperável. Usamos a MÉDIA de fundos por semana (arredondada).
 */
export function aggregateByGestor(rows) {
  const map = new Map()
  for (const r of rows || []) {
    let g = map.get(r.gestor)
    if (!g) { g = { gestor: r.gestor, captacao: 0, resgate: 0, recs: [], weeks: new Set(), sumFundos: 0 }; map.set(r.gestor, g) }
    g.captacao += r.captacao
    g.resgate  += r.resgate
    g.sumFundos += r.numFundos
    g.weeks.add(r.weekKey)
    g.recs.push(r)
  }
  return [...map.values()].map(g => ({
    gestor: g.gestor,
    captacao: g.captacao, resgate: g.resgate, liquido: g.captacao - g.resgate,
    plMedio: weightedPL(g.recs),
    numFundos: g.weeks.size ? Math.round(g.sumFundos / g.weeks.size) : 0,
  }))
}

/** Indicadores agregados do período (cards). */
export function computeCards(rows) {
  const weeks = aggregateByWeek(rows)
  const captacao = (rows || []).reduce((s, r) => s + r.captacao, 0)
  const resgate  = (rows || []).reduce((s, r) => s + r.resgate, 0)
  const numFundos = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.numFundos, 0) / weeks.length) : 0
  return {
    captacao,
    resgate,
    liquido: captacao - resgate,
    plMedio: weightedPL(rows || []),
    numFundos,
    numSemanas: weeks.length,
    ultimaSemana: weeks.length ? weeks[weeks.length - 1] : null,
  }
}

/** Ordena o ranking de gestores por um critério. */
export function sortGestores(list, by = 'liquido') {
  const key = ({
    liquido:  g => g.liquido,
    captacao: g => g.captacao,
    resgate:  g => g.resgate,
    pl:       g => g.plMedio,
  })[by] || (g => g.liquido)
  return [...(list || [])].sort((a, b) => key(b) - key(a))
}

/** Lista de gestores distintos, ordenada (para o seletor). */
export function gestorOptions(rows) {
  return [...new Set((rows || []).map(r => r.gestor))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

// ───────────────────────── Formatação ─────────────────────────

/** R$ compacto pt-BR: mil / mi / bi. */
export function fmtFluxo(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const f = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
  if (abs >= 1e9) return `R$ ${f(n / 1e9)} bi`
  if (abs >= 1e6) return `R$ ${f(n / 1e6)} mi`
  if (abs >= 1e3) return `R$ ${f(n / 1e3, 0)} mil`
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/** Valor com sinal explícito (+/−) — não depende de cor para indicar positivo/negativo. */
export function fmtFluxoSigned(n) {
  if (n == null || isNaN(n)) return '—'
  const sign = n > 0 ? '+ ' : n < 0 ? '− ' : ''
  return sign + fmtFluxo(Math.abs(n))
}

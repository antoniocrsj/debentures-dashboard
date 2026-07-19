// Logica PURA de periodo (dia/semana/mes) — sem React, sem I/O. Compartilhada
// pelo gerador de relatorios (Node) e pelo app. Datas como 'AAAA-MM-DD' (locais).
//
// Semana = ISO 8601 (segunda a domingo; a semana pertence ao ano da sua quinta;
// semana 1 = a que contem 4/jan). Ultimo dia UTIL da semana = sexta.
// Mes = 1o ao ultimo dia; ultimo dia util = ultimo dia de semana (seg-sex).

const p2 = n => String(n).padStart(2, '0')
const MES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function keyToDate(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(k || ''))
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}
export function dateToKey(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
const fmtBr = k => { const d = keyToDate(k); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}` : k }
// dia da semana com segunda=0 .. domingo=6
const dow = d => (d.getDay() + 6) % 7

// ── Semana ISO ──────────────────────────────────────────────────────────────
// { year, week } ISO de uma Date.
export function isoWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - dow(d) + 3)          // quinta desta semana
  const thursday = new Date(d)
  const jan4 = new Date(thursday.getFullYear(), 0, 4)
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dow(jan4))
  const week = 1 + Math.round((thursday - week1Monday) / (7 * 864e5))
  return { year: thursday.getFullYear(), week }
}
export function isoWeekId(dateOrKey) {
  const d = dateOrKey instanceof Date ? dateOrKey : keyToDate(dateOrKey)
  if (!d) return null
  const { year, week } = isoWeek(d)
  return `${year}-W${p2(week)}`
}

// { start, end, lastBusiness } de um id 'AAAA-Www' (segunda, domingo, sexta).
export function weekRange(id) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(id || ''))
  if (!m) return null
  const year = +m[1], week = +m[2]
  const jan4 = new Date(year, 0, 4)
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dow(jan4))
  const monday = new Date(week1Monday)
  monday.setDate(week1Monday.getDate() + (week - 1) * 7)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const friday = new Date(monday); friday.setDate(monday.getDate() + 4)
  return { start: dateToKey(monday), end: dateToKey(sunday), lastBusiness: dateToKey(friday) }
}

// ── Mes ─────────────────────────────────────────────────────────────────────
export function monthId(dateOrKey) {
  const k = dateOrKey instanceof Date ? dateToKey(dateOrKey) : String(dateOrKey || '')
  return /^(\d{4})-(\d{2})/.test(k) ? k.slice(0, 7) : null
}
export function monthRange(id) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(id || ''))
  if (!m) return null
  const year = +m[1], mon = +m[2] - 1
  const start = new Date(year, mon, 1)
  const end = new Date(year, mon + 1, 0)              // ultimo dia do mes
  const lb = new Date(end)
  while (lb.getDay() === 0 || lb.getDay() === 6) lb.setDate(lb.getDate() - 1)  // ultimo dia util
  return { start: dateToKey(start), end: dateToKey(end), lastBusiness: dateToKey(lb) }
}

// ── Status parcial/fechado ──────────────────────────────────────────────────
// Fechado quando a maior data das fontes CRITICAS alcancou o ultimo dia util
// esperado do periodo; senao parcial. lastDataKey = min(maxDataDeCadaFonteCritica).
export function periodStatus(range, lastDataKey) {
  if (!range || !lastDataKey) return 'partial'
  return lastDataKey >= range.lastBusiness ? 'closed' : 'partial'
}

// ── Rotulos ─────────────────────────────────────────────────────────────────
export function weekLabel(id, status, ate) {
  const r = weekRange(id); if (!r) return id
  const fim = status === 'partial' ? `Parcial até ${fmtBr(ate || r.end)}` : `${fmtBr(r.start)}–${fmtBr(r.lastBusiness)}`
  return `Semana ${id.slice(6)}/${id.slice(0, 4)} · ${fim}`
}
export function monthLabel(id, status, ate) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(id || '')); if (!m) return id
  const base = `${MES_ABBR[+m[2] - 1]}/${m[1]}`
  return status === 'partial' ? `${base} · Parcial até ${fmtBr(ate)}` : base
}

// ── Utilitarios de agrupamento ──────────────────────────────────────────────
// Ids de semana/mes presentes numa lista de datas, do mais recente pro mais antigo.
export function recentPeriods(dateKeys, tipo, n = 5) {
  const idOf = tipo === 'weekly' ? isoWeekId : monthId
  const ids = [...new Set((dateKeys || []).map(idOf).filter(Boolean))]
  ids.sort() // 'AAAA-Www' e 'AAAA-MM' ordenam lexicograficamente = cronologicamente
  return ids.slice(-n).reverse()
}
// Datas (keys) de uma lista que caem DENTRO do intervalo [start, end] inclusive.
export function keysInRange(dateKeys, range) {
  if (!range) return []
  return (dateKeys || []).filter(k => k >= range.start && k <= range.end).sort()
}

import { isYes } from './format.js'
import { isoWeekId, weekRange } from './periods.js'

function subtractCalendarMonths(dateKey, months) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '')
  if (!match) return null

  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, 1))
  date.setUTCMonth(date.getUTCMonth() - months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

export function recortaNegociosPorPeriodo(rows = [], months = null) {
  if (!rows.length || !Number.isFinite(months) || months <= 0) return rows

  const datas = rows.map(row => row.data).filter(data => /^\d{4}-\d{2}-\d{2}$/.test(data || ''))
  if (!datas.length) return []

  const fim = datas.reduce((max, data) => data > max ? data : max, '')
  const inicio = subtractCalendarMonths(fim, months)
  return rows.filter(row => row.data >= inicio && row.data <= fim)
}

export function resumoNegociosSecundario(rows = []) {
  let volume12431 = 0
  let volumeTradicional = 0

  for (const row of rows) {
    const volume = Number.isFinite(row.volumeRs) ? row.volumeRs : 0
    if (isYes(row.lei12431)) volume12431 += volume
    else volumeTradicional += volume
  }

  return { volume12431, volumeTradicional, numeroTrades: rows.length }
}

export function agregaNegociosPorSemana(rows = []) {
  const semanas = new Map()

  for (const row of rows) {
    const semana = isoWeekId(row.data)
    if (!semana) continue

    let ponto = semanas.get(semana)
    if (!ponto) {
      const periodo = weekRange(semana)
      ponto = {
        semana,
        inicio: periodo?.start || row.data,
        fim: periodo?.lastBusiness || row.data,
        volume: 0,
        trades: 0,
      }
      semanas.set(semana, ponto)
    }

    ponto.volume += Number.isFinite(row.volumeRs) ? row.volumeRs : 0
    ponto.trades += 1
  }

  return [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana))
}

import { isYes } from './format.js'
import { isoWeekId, weekRange } from './periods.js'

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

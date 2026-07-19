// retencao.mjs
// --------------------------------------------------------------------------
// Politica de retencao dos SNAPSHOTS de fonte (anbima/blc/fundos).
//
// Problema: o Resumo do Dia so' precisa de ~10 dias, mas o Resumo do Mes
// precisa dos snapshots de FRONTEIRA (o ultimo ANTES do inicio do periodo e o
// ultimo ATE o fim) para calcular spread cumulativo e inclusoes/exclusoes. Uma
// poda simples "mantem os 10 mais recentes" apagaria a fronteira de meses
// anteriores e tornaria relatorios FECHADOS irreproduziveis.
//
// Solucao: alem dos N dias recentes (Resumo do Dia), preservamos as datas de
// fronteira de todas as SEMANAS e MESES recentes. Como cada rodada recomputa a
// fronteira a partir do proprio conjunto retido, a protecao se auto-sustenta
// enquanto nWeeks/nMonths cobrirem o alcance guardado (>= 6 meses de meses).
import fs from 'node:fs'
import path from 'node:path'
import { weekRange, monthRange, recentPeriods } from '../../src/utils/periods.js'

const lastLE = (arr, alvo) => { let h = null; for (const d of arr) { if (d <= alvo) h = d; else break } return h }
const lastLT = (arr, alvo) => { let h = null; for (const d of arr) { if (d < alvo) h = d; else break } return h }

// Datas de fronteira (antes-do-inicio + fim) das semanas/meses recentes, dado o
// conjunto de datas de snapshot (asc) de UMA fonte. periodDateKeys define quais
// periodos existem (normalmente as proprias datas de snapshot da fonte).
export function boundaryDates(snapDatesAsc, periodDateKeys, { nWeeks = 8, nMonths = 8 } = {}) {
  const keep = new Set()
  for (const [tipo, n] of [['weekly', nWeeks], ['monthly', nMonths]]) {
    for (const id of recentPeriods(periodDateKeys, tipo, n)) {
      const range = tipo === 'weekly' ? weekRange(id) : monthRange(id)
      if (!range) continue
      const antes = lastLT(snapDatesAsc, range.start), fim = lastLE(snapDatesAsc, range.end)
      if (antes) keep.add(antes)
      if (fim) keep.add(fim)
    }
  }
  return keep
}

// Conjunto final de datas a MANTER: os `recentes` mais novos (Resumo do Dia) +
// as fronteiras de semanas/meses recentes (Resumo da Semana/Mes).
export function keepSet(snapDatesAsc, periodDateKeys, { recentes = 12, ...opts } = {}) {
  const keep = boundaryDates(snapDatesAsc, periodDateKeys, opts)
  for (const d of snapDatesAsc.slice(-recentes)) keep.add(d)
  return keep
}

// Poda um diretorio de snapshots preservando o keepSet. Retorna as datas apagadas.
// periodDateKeys default = as proprias datas de snapshot da fonte.
export function pruneDir(dir, periodDateKeys = null, opts = {}) {
  if (!fs.existsSync(dir)) return []
  const dates = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).map(f => f.slice(0, -4)).sort()
  const keep = keepSet(dates, periodDateKeys || dates, opts)
  const apagadas = []
  for (const d of dates) if (!keep.has(d)) { try { fs.unlinkSync(path.join(dir, `${d}.csv`)); apagadas.push(d) } catch { /* ignore */ } }
  return apagadas
}

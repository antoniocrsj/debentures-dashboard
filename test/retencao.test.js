import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundaryDates, keepSet } from '../tools/relatorios/retencao.mjs'
import { downloadName } from '../src/utils/download.js'
import { weekRange, monthRange } from '../src/utils/periods.js'

// Serie longa de snapshots diarios (uteis) cobrindo mar-jul/2026, para exercitar
// a retencao de FRONTEIRA de meses antigos que caem FORA da janela recente.
function diasUteis(ini, fim) {
  const out = []
  const d = new Date(ini + 'T00:00:00'), end = new Date(fim + 'T00:00:00')
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}
const SNAPS = diasUteis('2026-03-02', '2026-07-16')  // ~100 dias uteis

test('boundaryDates: preserva fronteira (antes-do-inicio + fim) de cada mes recente', () => {
  const bnd = boundaryDates(SNAPS, SNAPS, { nWeeks: 0, nMonths: 6 })
  // Junho fechado: fim = ultimo snapshot <= 30/06; antes = ultimo snapshot < 01/06.
  const jun = monthRange('2026-06')
  const fimJun = SNAPS.filter(d => d <= jun.end).at(-1)
  const antesJun = SNAPS.filter(d => d < jun.start).at(-1)
  assert.equal(fimJun, '2026-06-30')
  assert.equal(antesJun, '2026-05-29')
  assert.ok(bnd.has(fimJun), 'fim de junho deve ser preservado')
  assert.ok(bnd.has(antesJun), 'fronteira antes de junho deve ser preservada')
})

test('keepSet: mantem 10 recentes E as fronteiras antigas (teste 11)', () => {
  const keep = keepSet(SNAPS, SNAPS, { recentes: 10, nWeeks: 8, nMonths: 6 })
  const recentes10 = SNAPS.slice(-10)
  for (const d of recentes10) assert.ok(keep.has(d), `recente ${d} preservado`)
  // Uma fronteira de marco (bem fora dos 10 recentes) sobrevive.
  const mar = monthRange('2026-03')
  const fimMar = SNAPS.filter(d => d <= mar.end).at(-1)
  assert.ok(!recentes10.includes(fimMar), 'fim de marco esta fora dos 10 recentes')
  assert.ok(keep.has(fimMar), 'fim de marco preservado por ser fronteira')
  // Um dia "do meio" de abril (nao-fronteira, fora dos recentes) e' podado.
  const abrMeio = '2026-04-15'
  assert.ok(SNAPS.includes(abrMeio) && !keep.has(abrMeio), 'dia do meio de abril e podado')
})

test('keepSet: fronteira de semana tambem sobrevive fora da janela recente', () => {
  const keep = keepSet(SNAPS, SNAPS, { recentes: 5, nWeeks: 8, nMonths: 0 })
  const w = weekRange('2026-W24')  // semana de meados de junho
  const fim = SNAPS.filter(d => d <= w.end).at(-1)
  const antes = SNAPS.filter(d => d < w.start).at(-1)
  assert.ok(keep.has(fim) && keep.has(antes), 'fronteiras da semana preservadas')
})

test('downloadName: nomes de arquivo por modo (teste 15)', () => {
  assert.equal(downloadName('daily', '2026-07-16', 'html'), 'resumo-do-dia-2026-07-16.html')
  assert.equal(downloadName('weekly', '2026-W29', 'html'), 'resumo-da-semana-2026-W29.html')
  assert.equal(downloadName('monthly', '2026-07', 'html'), 'resumo-do-mes-2026-07.html')
  assert.equal(downloadName('daily', '2026-07-16', 'json'), 'resumo-do-dia-2026-07-16.json')
  assert.equal(downloadName('weekly', '2026-W01', 'json'), 'resumo-da-semana-2026-W01.json')
  assert.equal(downloadName('monthly', '2026-12', 'json'), 'resumo-do-mes-2026-12.json')
})

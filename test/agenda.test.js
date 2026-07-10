import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgenda } from '../src/utils/agenda.js'

const juros = (d) => ({ data_evento: d, evento_arc: 'Juros', evento: 'PAGAMENTO DE JUROS', taxa: '1.600000000000000', status: { status: 'Previsto' } })
const amort = (d, pct) => ({ data_evento: d, evento_arc: 'Amortização', evento: 'AMORTIZACAO', taxa: pct, status: { status: 'Previsto' } })

test('parseAgenda: bullet (IOCHA7) → "4y bullet"', () => {
  const content = [
    juros('2027-01-07'), juros('2027-07-07'), juros('2028-01-07'), juros('2028-07-07'),
    juros('2029-01-07'), juros('2029-07-07'), juros('2030-01-07'),
    { data_evento: '2030-07-07', evento_arc: 'Amortização', evento: 'VENCIMENTO (RESGATE)', taxa: '100.000000000000000', status: { status: 'Previsto' } },
    juros('2030-07-07'),
  ]
  const r = parseAgenda(content, '2026-07-07', '2030-07-07')
  assert.equal(r.prazoAnos, 4)
  assert.equal(r.amortLabel, '4y bullet')
  assert.equal(r.amortizacoes.length, 1)
  assert.equal(r.amortizacoes[0].pct, 100)
})

test('parseAgenda: amortização em 2 anos → "5y (4/5)"', () => {
  const content = [
    juros('2021-01-01'), amort('2024-01-01', '50.0'), amort('2025-01-01', '50.0'),
  ]
  const r = parseAgenda(content, '2020-01-01', '2025-01-01')
  assert.equal(r.prazoAnos, 5)
  assert.equal(r.amortLabel, '5y (4/5)')
  assert.equal(r.amortizacoes.length, 2)
})

test('parseAgenda: amortização num ano só (não-bullet) → "5y (5)"', () => {
  const content = [juros('2024-06-01'), amort('2025-01-01', '100.0')]
  // amort de 100% mas cai como "bullet" porque é única e ~100%
  const r = parseAgenda(content, '2020-01-01', '2025-01-01')
  assert.equal(r.amortLabel, '5y bullet')
})

test('parseAgenda: sem eventos de amortização → só "Ny"', () => {
  const r = parseAgenda([juros('2021-01-01'), juros('2022-01-01')], '2020-01-01', '2025-01-01')
  assert.equal(r.amortLabel, '5y')
  assert.equal(r.amortizacoes.length, 0)
})

test('parseAgenda: aceita datas em dd/MM/yyyy e ordena', () => {
  const r = parseAgenda([juros('01/07/2028'), juros('01/07/2027')], '07/07/2026', '07/07/2030')
  assert.equal(r.prazoAnos, 4)
  assert.equal(r.eventos[0].dataStr <= r.eventos[1].dataStr, true)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isoWeekId, weekRange, monthId, monthRange, periodStatus,
  recentPeriods, keysInRange, dateToKey, keyToDate,
} from '../src/utils/periods.js'

test('isoWeekId: semanas normais', () => {
  assert.equal(isoWeekId('2026-07-15'), '2026-W29')  // quarta
  assert.equal(isoWeekId('2026-07-13'), '2026-W29')  // segunda da mesma semana
  assert.equal(isoWeekId('2026-07-12'), '2026-W28')  // domingo -> semana anterior
})

test('isoWeekId: virada de ano (ISO)', () => {
  // 2026-01-01 e' quinta -> pertence a W01 de 2026
  assert.equal(isoWeekId('2026-01-01'), '2026-W01')
  // 2020-12-31 e' quinta -> W53 de 2020
  assert.equal(isoWeekId('2020-12-31'), '2020-W53')
  // 2021-01-01 e' sexta -> ainda W53 de 2020 (semana pertence ao ano da quinta)
  assert.equal(isoWeekId('2021-01-01'), '2020-W53')
  // 2019-12-30 (segunda) -> W01 de 2020
  assert.equal(isoWeekId('2019-12-30'), '2020-W01')
})

test('weekRange: segunda/sexta/domingo', () => {
  const r = weekRange('2026-W29')
  assert.equal(r.start, '2026-07-13')        // segunda
  assert.equal(r.lastBusiness, '2026-07-17') // sexta
  assert.equal(r.end, '2026-07-19')          // domingo
  // round-trip: a segunda e a sexta pertencem a W29
  assert.equal(isoWeekId(r.start), '2026-W29')
  assert.equal(isoWeekId(r.lastBusiness), '2026-W29')
})

test('monthId / monthRange', () => {
  assert.equal(monthId('2026-07-15'), '2026-07')
  const r = monthRange('2026-07')
  assert.equal(r.start, '2026-07-01')
  assert.equal(r.end, '2026-07-31')
  assert.equal(r.lastBusiness, '2026-07-31')  // 31/07/2026 e' sexta
  // fevereiro (ultimo dia util recua do fim de semana)
  const f = monthRange('2026-02')
  assert.equal(f.end, '2026-02-28')            // 28/02/2026 e' sabado
  assert.equal(f.lastBusiness, '2026-02-27')   // recua p/ sexta
})

test('periodStatus: parcial vs fechado', () => {
  const r = weekRange('2026-W29')  // lastBusiness 2026-07-17
  assert.equal(periodStatus(r, '2026-07-15'), 'partial')  // dados so' ate' quarta
  assert.equal(periodStatus(r, '2026-07-17'), 'closed')   // alcancou a sexta
  assert.equal(periodStatus(r, '2026-07-20'), 'closed')   // passou (segunda seguinte)
  assert.equal(periodStatus(r, null), 'partial')          // sem dado -> parcial
})

test('recentPeriods: 5 mais recentes (semana e mes)', () => {
  const dias = []
  for (let d = new Date(2026, 5, 1); d <= new Date(2026, 6, 20); d.setDate(d.getDate() + 1)) dias.push(dateToKey(new Date(d)))
  const semanas = recentPeriods(dias, 'weekly', 5)
  assert.equal(semanas.length, 5)
  assert.equal(semanas[0], isoWeekId('2026-07-20'))  // mais recente primeiro
  assert.ok(semanas[0] > semanas[4])
  const meses = recentPeriods(dias, 'monthly', 5)
  assert.deepEqual(meses, ['2026-07', '2026-06'])
})

test('keysInRange: filtra o intervalo inclusive', () => {
  const dias = ['2026-07-10', '2026-07-13', '2026-07-15', '2026-07-17', '2026-07-20']
  const r = weekRange('2026-W29')  // 13..19
  assert.deepEqual(keysInRange(dias, r), ['2026-07-13', '2026-07-15', '2026-07-17'])
})

test('keyToDate/dateToKey: local, round-trip', () => {
  assert.equal(dateToKey(keyToDate('2026-07-15')), '2026-07-15')
  assert.equal(keyToDate('2026-07-15').getMonth(), 6)  // julho = 6 (local, sem UTC)
})

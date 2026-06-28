// Testes das funções puras de fluxo. Rodar com: npm test  (usa o runner nativo do Node)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSemana, normalizeRow, normalizeFluxo,
  filterFluxo, aggregateByWeek, aggregateByGestor, computeCards,
  sortGestores, gestorOptions, startForMonths,
  fmtFluxo, fmtFluxoSigned,
} from '../src/utils/fluxo.js'

test('parseSemana entende ISO e BR', () => {
  assert.equal(parseSemana('2026-01-05').key, '2026-01-05')
  assert.equal(parseSemana('2026-01-05').label, '05/01')
  assert.equal(parseSemana('05/01/2026').key, '2026-01-05')
  assert.equal(parseSemana(''), null)
  assert.equal(parseSemana('xx'), null)
})

test('normalizeRow calcula liquido e absolutiza resgate', () => {
  const n = normalizeRow({ Semana: '2026-01-05', Gestor_Apelido: 'A', Captacao: '1000', Resgate: '-300', PL_Medio: '5000', Num_Fundos: '4' })
  assert.equal(n.captacao, 1000)
  assert.equal(n.resgate, 300)        // abs
  assert.equal(n.liquido, 700)        // 1000 - 300
  assert.equal(n.numFundos, 4)
  // linha inválida (sem gestor) -> null
  assert.equal(normalizeRow({ Semana: '2026-01-05', Gestor_Apelido: '' }), null)
})

test('normalizeFluxo ordena por semana e conta inválidas', () => {
  const { rows, invalid } = normalizeFluxo([
    { Semana: '2026-01-12', Gestor_Apelido: 'A', Captacao: '1', Resgate: '0', PL_Medio: '1', Num_Fundos: '1' },
    { Semana: '2026-01-05', Gestor_Apelido: 'A', Captacao: '1', Resgate: '0', PL_Medio: '1', Num_Fundos: '1' },
    { Semana: 'lixo', Gestor_Apelido: 'A' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(invalid, 1)
  assert.equal(rows[0].weekKey, '2026-01-05')   // ordenado asc
})

const SAMPLE = normalizeFluxo([
  { Semana: '2026-01-05', Gestor_Apelido: 'A', Captacao: '1000', Resgate: '200', PL_Medio: '10000', Num_Fundos: '2' },
  { Semana: '2026-01-05', Gestor_Apelido: 'B', Captacao: '500',  Resgate: '100', PL_Medio: '20000', Num_Fundos: '3' },
  { Semana: '2026-01-12', Gestor_Apelido: 'A', Captacao: '800',  Resgate: '300', PL_Medio: '11000', Num_Fundos: '2' },
]).rows

test('aggregateByWeek soma gestores e calcula liquido', () => {
  const w = aggregateByWeek(SAMPLE)
  assert.equal(w.length, 2)
  assert.equal(w[0].captacao, 1500)   // 1000 + 500
  assert.equal(w[0].resgate, 300)     // 200 + 100
  assert.equal(w[0].liquido, 1200)
  assert.equal(w[0].numFundos, 5)     // 2 + 3
})

test('aggregateByGestor soma por gestor e média de fundos/semana', () => {
  const g = aggregateByGestor(SAMPLE)
  const a = g.find(x => x.gestor === 'A')
  assert.equal(a.captacao, 1800)      // 1000 + 800
  assert.equal(a.resgate, 500)
  assert.equal(a.liquido, 1300)
  assert.equal(a.numFundos, 2)        // média de 2 e 2
})

test('computeCards agrega o período', () => {
  const c = computeCards(SAMPLE)
  assert.equal(c.captacao, 2300)
  assert.equal(c.resgate, 600)
  assert.equal(c.liquido, 1700)
  assert.equal(c.numSemanas, 2)
  assert.equal(c.ultimaSemana.weekKey, '2026-01-12')
})

test('filterFluxo por gestor e período', () => {
  assert.equal(filterFluxo(SAMPLE, { gestor: 'B' }).length, 1)
  assert.equal(filterFluxo(SAMPLE, { start: new Date(2026, 0, 10) }).length, 1)
})

test('sortGestores e gestorOptions', () => {
  const ranking = sortGestores(aggregateByGestor(SAMPLE), 'captacao')
  assert.equal(ranking[0].gestor, 'A')   // 1800 > 500
  assert.deepEqual(gestorOptions(SAMPLE), ['A', 'B'])
})

test('startForMonths recua a partir da última semana', () => {
  const s = startForMonths(SAMPLE, 0)
  assert.equal(s.getTime(), SAMPLE[SAMPLE.length - 1].weekDate.getTime())
})

test('formatação compacta e com sinal', () => {
  assert.equal(fmtFluxo(2_500_000), 'R$ 2,5 mi')
  assert.equal(fmtFluxo(1_200_000_000), 'R$ 1,2 bi')
  assert.equal(fmtFluxo(45_000), 'R$ 45 mil')
  assert.equal(fmtFluxoSigned(250_000_000), '+ R$ 250,0 mi')
  assert.equal(fmtFluxoSigned(-180_000_000), '− R$ 180,0 mi')
})

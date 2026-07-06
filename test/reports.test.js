// Testes das funções puras do Resumo do Dia. Rodar com: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDia, fmtDia, diffKeyed, topMovers,
  pickReportDates, previousDate, sourceDateFor, summarize, repairText,
} from '../src/utils/reports.js'

test('repairText: conserta mojibake UTF-8-lido-como-latin1, não toca texto limpo', () => {
  assert.equal(repairText('PrÃ©-Fixado 16.3433%'), 'Pré-Fixado 16.3433%')
  assert.equal(repairText('IPCA + 7.0718%'), 'IPCA + 7.0718%')   // intacto
  assert.equal(repairText('DI + 3.4000%'), 'DI + 3.4000%')
  assert.equal(repairText('normal'), 'normal')
  assert.equal(repairText(''), '')
  assert.equal(repairText(null), '')
})

test('parseDia entende ISO e BR, data local (sem UTC)', () => {
  assert.equal(parseDia('2026-07-03').key, '2026-07-03')
  assert.equal(parseDia('2026-07-03').label, '03/07/2026')
  assert.equal(parseDia('2026-07-03').date.getMonth(), 6)   // julho local
  assert.equal(parseDia('03/07/2026').key, '2026-07-03')
  assert.equal(parseDia(''), null)
  assert.equal(parseDia('lixo'), null)
  assert.equal(fmtDia('2026-07-03'), '03/07/2026')
  assert.equal(fmtDia('sem data'), 'sem data')
})

test('diffKeyed: added/removed/changed por chave', () => {
  const prev = [{ id: 'A', v: 1 }, { id: 'B', v: 2 }, { id: 'C', v: 3 }]
  const curr = [{ id: 'B', v: 2 }, { id: 'C', v: 9 }, { id: 'D', v: 4 }]
  const d = diffKeyed(prev, curr, r => r.id, (a, b) => a.v !== b.v)
  assert.deepEqual(d.added.map(r => r.id), ['D'])
  assert.deepEqual(d.removed.map(r => r.id), ['A'])
  assert.equal(d.changed.length, 1)             // C mudou de 3 → 9
  assert.equal(d.changed[0].antes.v, 3)
  assert.equal(d.changed[0].depois.v, 9)
})

test('diffKeyed: sem changedFn não reporta alterações', () => {
  const d = diffKeyed([{ id: 'A', v: 1 }], [{ id: 'A', v: 2 }], r => r.id)
  assert.equal(d.added.length, 0)
  assert.equal(d.removed.length, 0)
  assert.equal(d.changed.length, 0)
})

test('topMovers: maiores e menores, ignora nulos', () => {
  const rows = [{ g: 'X', v: 10 }, { g: 'Y', v: -5 }, { g: 'Z', v: null }, { g: 'W', v: 3 }]
  const maiores = topMovers(rows, r => r.v, 2, 'desc').map(r => r.g)
  assert.deepEqual(maiores, ['X', 'W'])
  const menores = topMovers(rows, r => r.v, 2, 'asc').map(r => r.g)
  assert.deepEqual(menores, ['Y', 'W'])
})

test('pickReportDates: 5 datas mais recentes da união das fontes', () => {
  const perSource = {
    anbima: ['2026-07-03', '2026-07-02'],
    captacao: ['2026-07-01', '2026-06-30'],
    debentures: ['2026-07-03'],
  }
  assert.deepEqual(
    pickReportDates(perSource, 5),
    ['2026-07-03', '2026-07-02', '2026-07-01', '2026-06-30']
  )
  assert.deepEqual(pickReportDates(perSource, 2), ['2026-07-03', '2026-07-02'])
})

test('previousDate e sourceDateFor: data anterior/atual da fonte', () => {
  const datas = ['2026-06-30', '2026-07-01', '2026-07-03']
  assert.equal(previousDate(datas, '2026-07-03'), '2026-07-01')  // anterior estrito
  assert.equal(previousDate(datas, '2026-06-30'), null)           // não há anterior
  assert.equal(sourceDateFor(datas, '2026-07-02'), '2026-07-01')  // mais recente ≤ D
  assert.equal(sourceDateFor(datas, '2026-07-03'), '2026-07-03')
  assert.equal(sourceDateFor(datas, '2026-06-29'), null)
})

test('summarize: bullets só do que tem conteúdo', () => {
  const bullets = summarize({
    debentures: { novas: [{}, {}], saidas: [] },
    captacao: { '12431': { captacao: 100, resgate: 40, liquido: 60 }, trad: null },
    gestores: { top12431Captacao: [{ gestor: 'ARX', liquido: 120e6 }], top12431Resgate: [{ gestor: 'Z', liquido: -90e6 }] },
    anbima: { altas: [{}], quedas: [] },
    fundos: { novos: [{}], removidos: [] },
    alertas: [{}, {}],
  })
  const textos = bullets.map(b => b.texto)
  assert.ok(textos.some(t => t.includes('2 nova(s) debênture')))
  assert.ok(textos.some(t => t.includes('Captação líquida Incentivados')))
  assert.ok(textos.some(t => t.includes('Maior captação: ARX')))
  assert.ok(textos.some(t => t.includes('2 alerta(s)')))
  // segmento trad sem dado não vira bullet
  assert.ok(!textos.some(t => t.includes('Tradicional')))
})

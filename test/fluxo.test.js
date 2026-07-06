// Testes das funções puras de fluxo. Rodar com: npm test  (runner nativo do Node)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSemana, normalizeRow, normalizeFluxo,
  filterFluxo, aggregateByWeek, aggregateByGestor, computeCards,
  sortRows, gestorOptions, startForMonths,
  toChartSeries, fmtMonthYY, fmtWeekFull, monthTicks,
  fmtFluxo, fmtFluxoSigned,
  parseMes, normalizeMonthRow, filterMensal, aggregateByMonth,
  normalizeRentabilidade, mergeRentabilidade,
  normalizeFluxoFundos, filterFundos, aggregateByFundo, normalizeFundosMeta, mergeFundos,
} from '../src/utils/fluxo.js'

const norm = s => s.replace(/ /g, ' ')   // troca espaço não-separável por comum

test('parseMes e normalizeMonthRow (Mes/Gestor/Captacao/Resgate)', () => {
  assert.equal(parseMes('2026-06').key, '2026-06')
  assert.equal(parseMes('2026-06-26').key, '2026-06')
  assert.equal(parseMes('2026-13'), null)   // mês inválido
  assert.equal(parseMes('lixo'), null)
  const n = normalizeMonthRow({ Mes: '2026-06', Gestor_Apelido: 'A', Captacao: '100', Resgate: '-40' })
  assert.equal(n.captacao, 100)
  assert.equal(n.resgate, 40)               // resgate absoluto
  assert.equal(n.liquido, 60)
  assert.equal(normalizeMonthRow({ Mes: '', Gestor_Apelido: 'A' }), null)
})

test('aggregateByMonth: soma gestores, zero-fill, cronológico, Líquida correta', () => {
  const rows = [
    { mesKey: '2026-01', gestor: 'A', captacao: 100, resgate: 40 },
    { mesKey: '2026-01', gestor: 'B', captacao: 50,  resgate: 10 },
    { mesKey: '2026-03', gestor: 'A', captacao: 20,  resgate: 5  },
  ]
  const out = aggregateByMonth(rows, null, null, rows)
  assert.deepEqual(out.map(m => m.mesKey), ['2026-01', '2026-02', '2026-03'])   // fev preenchido
  assert.equal(out[0].captacao, 150)   // A+B em jan (sem dupla contagem)
  assert.equal(out[0].resgate, 50)
  assert.equal(out[0].liquido, 100)
  assert.equal(out[1].captacao, 0)     // fev sem movimentação = zero
  assert.equal(out[1].liquido, 0)
  assert.equal(out[2].captacao, 20)
})

test('aggregateByMonth: respeita o filtro de gestor', () => {
  const rows = [
    { mesKey: '2026-01', gestor: 'A', captacao: 100, resgate: 40 },
    { mesKey: '2026-01', gestor: 'B', captacao: 50,  resgate: 10 },
  ]
  const out = aggregateByMonth(filterMensal(rows, 'A'), null, null, rows)
  assert.equal(out.length, 1)
  assert.equal(out[0].captacao, 100)
  assert.equal(out[0].liquido, 60)
})

test('aggregateByMonth: intervalo de período não passa antes da base', () => {
  const rows = [{ mesKey: '2025-07', gestor: 'A', captacao: 10, resgate: 0 }]
  // período começa antes da base (2025-05) -> clampa para 2025-07
  const out = aggregateByMonth(rows, new Date(2025, 4, 1), new Date(2025, 6, 31), rows)
  assert.deepEqual(out.map(m => m.mesKey), ['2025-07'])
})

test('parseSemana entende ISO e BR (datas locais, sem UTC)', () => {
  assert.equal(parseSemana('2026-01-05').key, '2026-01-05')
  assert.equal(parseSemana('2026-01-05').label, '05/01')
  assert.equal(parseSemana('2026-01-05').date.getMonth(), 0)   // janeiro local
  assert.equal(parseSemana('05/01/2026').key, '2026-01-05')
  assert.equal(parseSemana(''), null)
})

test('normalizeRow calcula liquido, absolutiza resgate, guarda PL semanal', () => {
  const n = normalizeRow({ Semana: '2026-01-05', Gestor_Apelido: 'A', Captacao: '1000', Resgate: '-300', PL_Medio: '5000', Num_Fundos: '4' })
  assert.equal(n.captacao, 1000)
  assert.equal(n.resgate, 300)
  assert.equal(n.liquido, 700)
  assert.equal(n.plSemana, 5000)
  assert.equal(normalizeRow({ Semana: '2026-01-05', Gestor_Apelido: '' }), null)
})

const SAMPLE = normalizeFluxo([
  { Semana: '2026-01-05', Gestor_Apelido: 'A', Captacao: '1000', Resgate: '200', PL_Medio: '10000', Num_Fundos: '2' },
  { Semana: '2026-01-05', Gestor_Apelido: 'B', Captacao: '500',  Resgate: '100', PL_Medio: '20000', Num_Fundos: '3' },
  { Semana: '2026-01-12', Gestor_Apelido: 'A', Captacao: '800',  Resgate: '300', PL_Medio: '11000', Num_Fundos: '2' },
]).rows

test('aggregateByWeek: PL total = soma do PL entre gestores', () => {
  const w = aggregateByWeek(SAMPLE)
  assert.equal(w[0].plTotal, 30000)   // 10000 + 20000
  assert.equal(w[0].captacao, 1500)
  assert.equal(w[0].liquido, 1200)
  assert.equal(w[1].plTotal, 11000)
})

test('computeCards: PL total médio = média dos totais semanais; PL recente = última semana', () => {
  const c = computeCards(SAMPLE)
  assert.equal(c.captacao, 2300)
  assert.equal(c.resgate, 600)
  assert.equal(c.liquido, 1700)
  assert.equal(c.plTotalMedio, 20500)   // (30000 + 11000) / 2
  assert.equal(c.plRecente, 11000)      // semana 2026-01-12
  assert.equal(c.numGestores, 2)
  assert.equal(c.ultimaSemana.weekKey, '2026-01-12')
})

test('aggregateByGestor: PL total médio no tempo e PL recente por gestor', () => {
  const g = aggregateByGestor(SAMPLE)
  const a = g.find(x => x.gestor === 'A')
  assert.equal(a.plTotalMedio, 10500)   // média de 10000 e 11000
  assert.equal(a.plRecente, 11000)      // semana mais recente de A
  assert.equal(a.captacao, 1800)
  assert.equal(a.liquido, 1300)
  const b = g.find(x => x.gestor === 'B')
  assert.equal(b.plTotalMedio, 20000)
})

test('normalizeRentabilidade: célula vazia vira null (não zero)', () => {
  const map = normalizeRentabilidade([
    { Gestor_Apelido: 'A', PctCDI_1s: '105,4', PctCDI_1m: '', PctCDI_3m: '98.2', PctCDI_6m: '', PctCDI_12m: '' },
  ])
  const a = map.get('A')
  assert.equal(a.pctCdi1s, 105.4)
  assert.equal(a.pctCdi1m, null)
  assert.equal(a.pctCdi3m, 98.2)
  assert.equal(a.pctCdi12m, null)
})

test('mergeRentabilidade: junta por gestor; sem match vira null, não quebra a linha', () => {
  const ranking = aggregateByGestor(SAMPLE)
  const rentMap = normalizeRentabilidade([
    { Gestor_Apelido: 'A', PctCDI_1s: '110', PctCDI_1m: '108', PctCDI_3m: '', PctCDI_6m: '', PctCDI_12m: '' },
  ])
  const merged = mergeRentabilidade(ranking, rentMap)
  const a = merged.find(x => x.gestor === 'A')
  const b = merged.find(x => x.gestor === 'B')
  assert.equal(a.pctCdi1s, 110)
  assert.equal(a.pctCdi1m, 108)
  assert.equal(a.pctCdi3m, null)
  assert.equal(b.pctCdi1s, null)   // B nao esta' no rentMap
  assert.equal(b.captacao, ranking.find(x => x.gestor === 'B').captacao) // resto da linha intacto
})

const FUNDOS = normalizeFluxoFundos([
  { Semana: '2026-01-05', CNPJ_Fundo: '11.111/0001-11', Gestor_Apelido: 'A', Captacao: '1000', Resgate: '200', PL_Medio: '10000' },
  { Semana: '2026-01-12', CNPJ_Fundo: '11.111/0001-11', Gestor_Apelido: 'A', Captacao: '500',  Resgate: '100', PL_Medio: '11000' },
  { Semana: '2026-01-05', CNPJ_Fundo: '22.222/0001-22', Gestor_Apelido: 'A', Captacao: '300',  Resgate: '50',  PL_Medio: '4000' },
  { Semana: '2026-01-05', CNPJ_Fundo: '33.333/0001-33', Gestor_Apelido: 'B', Captacao: '900',  Resgate: '0',   PL_Medio: '9000' },
])

test('normalizeFluxoFundos + filterFundos: CNPJ so digitos, filtra por gestor/período', () => {
  assert.equal(FUNDOS.length, 4)
  assert.equal(FUNDOS[0].cnpj, '11111000111')
  const soA = filterFundos(FUNDOS, { gestor: 'A' })
  assert.equal(soA.length, 3)
  const desde12 = filterFundos(FUNDOS, { gestor: 'A', start: new Date(2026, 0, 10) })
  assert.equal(desde12.length, 1)   // só a semana 12/01 do fundo 11111
})

test('aggregateByFundo: soma por fundo, líquido e PL recente; fundos somam o total do gestor', () => {
  const fa = aggregateByFundo(filterFundos(FUNDOS, { gestor: 'A' }))
  const f1 = fa.find(x => x.cnpj === '11111000111')
  assert.equal(f1.captacao, 1500)      // 1000 + 500
  assert.equal(f1.resgate, 300)
  assert.equal(f1.liquido, 1200)
  assert.equal(f1.plRecente, 11000)    // semana mais recente
  // soma dos fundos de A = total do gestor A
  const totalCap = fa.reduce((s, f) => s + f.captacao, 0)
  assert.equal(totalCap, 1800)         // 1500 (11111) + 300 (22222)
})

test('mergeFundos: junta nome + %CDI do fundo; sem meta usa CNPJ e %CDI null', () => {
  const meta = normalizeFundosMeta([
    { CNPJ_Fundo: '11111000111', Nome_Fundo: 'Fundo Um', Gestor_Apelido: 'A', PctCDI_1s: '112,4', PctCDI_3m: '', PctCDI_12m: '104.8' },
  ])
  const merged = mergeFundos(aggregateByFundo(filterFundos(FUNDOS, { gestor: 'A' })), meta)
  const f1 = merged.find(x => x.cnpj === '11111000111')
  const f2 = merged.find(x => x.cnpj === '22222000122')
  assert.equal(f1.nome, 'Fundo Um')
  assert.equal(f1.pctCdi1s, 112.4)
  assert.equal(f1.pctCdi3m, null)      // célula vazia = null
  assert.equal(f1.pctCdi12m, 104.8)
  assert.equal(f2.nome, '22222000122') // sem meta → cai pro CNPJ
  assert.equal(f2.pctCdi1s, null)
})

test('sortRows: numérico por valor, nulos no fim, não muta a base', () => {
  const list = [{ v: 3 }, { v: null }, { v: 1 }, { v: 10 }]
  const desc = sortRows(list, x => x.v, 'desc').map(x => x.v)
  assert.deepEqual(desc, [10, 3, 1, null])
  const asc = sortRows(list, x => x.v, 'asc').map(x => x.v)
  assert.deepEqual(asc, [1, 3, 10, null])
  assert.equal(list[0].v, 3)   // original intacto
  // ranking por PL desc
  const top = sortRows(aggregateByGestor(SAMPLE), x => x.plTotalMedio, 'desc')[0]
  assert.equal(top.gestor, 'B')
})

test('toChartSeries: resgate vira negativo só no gráfico', () => {
  const s = toChartSeries(aggregateByWeek(SAMPLE))
  assert.equal(s[0].resgate, 300)       // positivo (tooltip)
  assert.equal(s[0].resgateNeg, -300)   // negativo (barra)
  assert.equal(s[0].liquido, 1200)      // líquido segue da subtração positiva
})

test('filterFluxo e gestorOptions', () => {
  assert.equal(filterFluxo(SAMPLE, { gestor: 'B' }).length, 1)
  assert.equal(filterFluxo(SAMPLE, { start: new Date(2026, 0, 10) }).length, 1)
  assert.deepEqual(gestorOptions(SAMPLE), ['A', 'B'])
})

test('startForMonths recua a partir da semana mais recente da base', () => {
  const s = startForMonths(SAMPLE, 0)
  assert.equal(s.getTime(), SAMPLE[SAMPLE.length - 1].weekDate.getTime())
})

test('formatação mensal jun/25 e tooltip dd/mm/aaaa', () => {
  assert.equal(fmtMonthYY('2025-06-30'), 'jun/25')
  assert.equal(fmtMonthYY('2026-01-05'), 'jan/26')
  assert.equal(fmtWeekFull('2025-06-16'), '16/06/2025')
})

test('monthTicks: ~1 por mês, limitando a quantidade', () => {
  const weeks = ['2025-06-02','2025-06-09','2025-07-07','2025-08-04','2025-08-18'].map(k => ({ weekKey: k }))
  assert.deepEqual(monthTicks(weeks, 12), ['2025-06-02', '2025-07-07', '2025-08-04'])
  assert.equal(monthTicks(weeks, 2).length, 2)   // reduz no mobile
})

test('formatação com sinal colado e zero sem sinal', () => {
  assert.equal(norm(fmtFluxo(2_500_000)), 'R$ 2,5 mi')
  assert.equal(norm(fmtFluxoSigned(250_000_000)), '+R$ 250,0 mi')
  assert.equal(norm(fmtFluxoSigned(-180_000_000)), '−R$ 180,0 mi')
  assert.equal(norm(fmtFluxoSigned(0)), 'R$ 0')
})

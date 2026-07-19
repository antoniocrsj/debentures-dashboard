import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGestoresPorTicker, flattenEventos, aggGestores, aggGrupos, aggAtivos,
  aggFundos, aggMeses, totalPeriodo,
} from '../src/utils/vencimentos.js'

// ─── Fixture pequena, com valores conferiveis a mao ──────────────────────────
// AAA (G1/E1, incentivada): jul J ct100, ago A ct300.  Carregado por X(60)+Y(40)=100.
// BBB (G2/E2, tradicional):  jul J ct50.               Carregado por X(50)=50.
// Fatias por gestor: X = AAA J 60 + AAA A 180 + BBB J 50 ; Y = AAA J 40 + AAA A 120.
function fixture() {
  return {
    meses: [
      { mes: '2026-07', label: 'jul/26', carteira: { juros: 150, amort: 0, total: 150 }, mercado: { juros: 280, amort: 0, total: 280 } },
      { mes: '2026-08', label: 'ago/26', carteira: { juros: 0, amort: 300, total: 300 }, mercado: { juros: 0, amort: 400, total: 400 } },
    ],
    porGestor: [
      { nome: 'X', juros: 110, amort: 180, total: 290 },
      { nome: 'Y', juros: 40, amort: 120, total: 160 },
    ],
    porGrupo: [
      { nome: 'G1', carteira: { juros: 100, amort: 300, total: 400 }, mercado: { juros: 200, amort: 400, total: 600 } },
      { nome: 'G2', carteira: { juros: 50, amort: 0, total: 50 }, mercado: { juros: 80, amort: 0, total: 80 } },
    ],
    ativos: [
      { ticker: 'AAA', grupo: 'G1', emissor: 'E1', incentivada: true, eventos: [
        { d: '2026-07-15', t: 'J', ct: 100, mc: 200 },
        { d: '2026-08-15', t: 'A', ct: 300, mc: 400, pct: 100 },
      ] },
      { ticker: 'BBB', grupo: 'G2', emissor: 'E2', incentivada: false, eventos: [
        { d: '2026-07-20', t: 'J', ct: 50, mc: 80 },
      ] },
    ],
  }
}
const BLC = [
  { CD_ATIVO: 'AAA', GESTOR: 'X', VL_ALOCADO: '60' },
  { CD_ATIVO: 'AAA', GESTOR: 'Y', VL_ALOCADO: '40' },
  { CD_ATIVO: 'BBB', GESTOR: 'X', VL_ALOCADO: '50' },
]
const setup = () => { const data = fixture(); return { data, gpt: buildGestoresPorTicker(BLC), eventos: flattenEventos(data) } }

test('buildGestoresPorTicker soma o total e guarda as linhas', () => {
  const gpt = buildGestoresPorTicker(BLC)
  assert.equal(gpt.get('AAA').total, 100)
  assert.equal(gpt.get('BBB').total, 50)
  assert.deepEqual(gpt.get('AAA').rows.map(r => r.g).sort(), ['X', 'Y'])
})

test('aggGestores: fast-path devolve porGestor quando sem filtro', () => {
  const { data, gpt, eventos } = setup()
  const rows = aggGestores(data, eventos, gpt, { seg: 'todos', selMes: null })
  assert.equal(rows, data.porGestor)  // mesma referencia (atalho)
})

test('aggGestores: recomputa com mes selecionado (so julho = juros)', () => {
  const { data, gpt, eventos } = setup()
  const rows = aggGestores(data, eventos, gpt, { seg: 'todos', selMes: '2026-07' })
  const byName = Object.fromEntries(rows.map(r => [r.nome, r]))
  assert.equal(byName.X.juros, 110); assert.equal(byName.X.amort, 0); assert.equal(byName.X.total, 110)
  assert.equal(byName.Y.total, 40)
})

test('aggGestores NAO depende da selecao do gestor (mesma lista sempre)', () => {
  const { data, gpt, eventos } = setup()
  // a funcao nem recebe gestorSel: a tabela de gestores e' estavel por construcao
  const a = aggGestores(data, eventos, gpt, { seg: '12431', selMes: null })
  const b = aggGestores(data, eventos, gpt, { seg: '12431', selMes: null })
  assert.deepEqual(a, b)
  // seg=12431 -> so' AAA conta: X=60+180=240, Y=40+120=160
  const byName = Object.fromEntries(a.map(r => [r.nome, r]))
  assert.equal(byName.X.total, 240); assert.equal(byName.Y.total, 160)
})

test('aggMeses (gestor X, carteira) reconcilia com o total do gestor', () => {
  const { data, gpt, eventos } = setup()
  const meses = aggMeses(data, eventos, gpt, { gestorSel: 'X', seg: 'todos', persp: 'carteira', base: 'view' })
  const soma = meses.reduce((s, m) => s + m.total, 0)
  assert.equal(soma, 290)  // == porGestor X total
  assert.equal(meses[0].juros, 110); assert.equal(meses[1].amort, 180)
})

test('totalPeriodo: mes selecionado vs 12m', () => {
  const { data, gpt, eventos } = setup()
  const meses = aggMeses(data, eventos, gpt, { gestorSel: 'X', seg: 'todos', persp: 'carteira', base: 'view' })
  assert.deepEqual(totalPeriodo(meses, null), { juros: 110, amort: 180, total: 290 })
  assert.deepEqual(totalPeriodo(meses, '2026-07'), { juros: 110, amort: 0, total: 110 })
})

test('aggGrupos (gestor X) reconcilia com o card do gestor', () => {
  const { data, gpt, eventos } = setup()
  const grupos = aggGrupos(data, eventos, gpt, { gestorSel: 'X', seg: 'todos', selMes: null, persp: 'carteira' })
  const soma = grupos.reduce((s, g) => s + g.total, 0)
  assert.equal(soma, 290)
  const g1 = grupos.find(g => g.nome === 'G1')
  assert.equal(g1.total, 240)  // AAA fatia de X: 60 + 180
})

test('aggGrupos: fast-path usa porGrupo (mercado) quando sem gestor/filtro', () => {
  const { data, gpt, eventos } = setup()
  const grupos = aggGrupos(data, eventos, gpt, { gestorSel: null, seg: 'todos', selMes: null, persp: 'mercado' })
  const g1 = grupos.find(g => g.nome === 'G1')
  assert.equal(g1.total, 600)  // mercado
})

test('aggAtivos (gestor Y) traz so os ativos que Y carrega', () => {
  const { data, gpt } = setup()
  const rows = aggAtivos(data, gpt, { gestorSel: 'Y', seg: 'todos', selMes: null, persp: 'carteira' })
  assert.deepEqual(rows.map(r => r.ticker), ['AAA'])  // Y nao tem BBB
  assert.equal(rows[0].total, 160)  // AAA fatia de Y: 40 + 120
  assert.equal(rows[0].proxData, '2026-07-15')
})

test('aggFundos: indisponivel quando nao ha porFundo (nunca fabrica)', () => {
  const { data } = setup()
  const r = aggFundos(data, { gestorSel: null, seg: 'todos', selMes: null })
  assert.equal(r.disponivel, false)
  assert.deepEqual(r.rows, [])
})

test('aggFundos: filtra por gestor/segmento/mes e calcula %PL', () => {
  const data = fixture()
  data.porFundo = [
    { cnpj: '1', nome: 'Fundo Um', gestor: 'X', segmento: '12431', pl: 1000, juros: 110, amort: 180, total: 290, pm: [[0, 110, 0], [1, 0, 180]] },
    { cnpj: '2', nome: 'Fundo Dois', gestor: 'Y', segmento: 'CDI', pl: 800, juros: 40, amort: 120, total: 160, pm: [[0, 40, 0], [1, 0, 120]] },
  ]
  // gestor X: so' o fundo 1; %PL = 290/1000
  const rx = aggFundos(data, { gestorSel: 'X', seg: 'todos', selMes: null })
  assert.equal(rx.disponivel, true)
  assert.equal(rx.rows.length, 1)
  assert.equal(rx.rows[0].total, 290)
  assert.equal(Math.round(rx.rows[0].pctPL), 29)
  // mes ago (index 1) do fundo 1: so' amort 180
  const rm = aggFundos(data, { gestorSel: 'X', seg: 'todos', selMes: '2026-08' })
  assert.equal(rm.rows[0].juros, 0); assert.equal(rm.rows[0].amort, 180); assert.equal(rm.rows[0].total, 180)
  // segmento tradicional exclui o fundo 12431
  const rt = aggFundos(data, { gestorSel: 'X', seg: 'trad', selMes: null })
  assert.equal(rt.rows.length, 0)
})

test('reconciliacao global: soma dos gestores == soma dos ct dos ativos', () => {
  const { data, gpt, eventos } = setup()
  const rows = aggGestores(data, eventos, gpt, { seg: 'todos', selMes: null })
  const somaGestores = rows.reduce((s, r) => s + r.total, 0)
  let somaCt = 0
  for (const ev of eventos) somaCt += ev.ct
  assert.equal(somaGestores, somaCt)  // 290 + 160 == 450
})

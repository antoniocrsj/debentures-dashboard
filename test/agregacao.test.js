import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggCaptacaoPeriodo, aggGestoresPeriodo, aggPerfPeriodo } from '../src/utils/aggregacao.js'
import { aggIda } from '../src/utils/ida.js'
import { weekRange } from '../src/utils/periods.js'

const R = weekRange('2026-W29')  // 2026-07-13 .. 2026-07-19

const fluxo = [
  { Dia: '2026-07-13', Gestor_Apelido: 'A', Captacao: '100', Resgate: '40', PL: '1000', Num_Fundos: '2' },
  { Dia: '2026-07-13', Gestor_Apelido: 'B', Captacao: '50', Resgate: '10', PL: '500', Num_Fundos: '1' },
  { Dia: '2026-07-14', Gestor_Apelido: 'A', Captacao: '30', Resgate: '5', PL: '1100', Num_Fundos: '2' },
  { Dia: '2026-07-14', Gestor_Apelido: 'B', Captacao: '0', Resgate: '0', PL: '520', Num_Fundos: '1' },
  { Dia: '2026-07-20', Gestor_Apelido: 'A', Captacao: '999', Resgate: '0', PL: '9999', Num_Fundos: '2' }, // fora do periodo
]

test('aggCaptacaoPeriodo: soma capt/resg, PL na ultima data (nao soma)', () => {
  const c = aggCaptacaoPeriodo(fluxo, R)
  assert.equal(c.captacao, 180)
  assert.equal(c.resgate, 55)
  assert.equal(c.liquido, 125)
  assert.equal(c.pl, 1620)          // PL de 07-14 (1100+520), NAO a soma de todos os dias
  assert.equal(c.dataPl, '2026-07-14')
  assert.equal(c.de, '2026-07-13'); assert.equal(c.ate, '2026-07-14')
  assert.equal(c.diasUteis, 2)
})

test('aggGestoresPeriodo: liquido sobre a serie inteira, ordenado', () => {
  const g = aggGestoresPeriodo(fluxo, R)
  assert.deepEqual(g.map(x => x.gestor), ['A', 'B'])   // A (85) > B (40)
  assert.equal(g[0].liquido, 85); assert.equal(g[0].pl, 1100); assert.equal(g[0].dias, 2)
  assert.equal(g[1].liquido, 40); assert.equal(g[1].pl, 520)
})

const perf = [
  { Dia: '2026-07-13', CNPJ_Fundo: '111', Gestor_Apelido: 'A', RetornoCota: '1.0', PL: '100' },
  { Dia: '2026-07-14', CNPJ_Fundo: '111', Gestor_Apelido: 'A', RetornoCota: '2.0', PL: '102' },
  { Dia: '2026-07-15', CNPJ_Fundo: '111', Gestor_Apelido: 'A', RetornoCota: '-0.5', PL: '101' },
  { Dia: '2026-07-13', CNPJ_Fundo: '222', Gestor_Apelido: 'B', RetornoCota: '30', PL: '50' },   // glitch (>25%)
  { Dia: '2026-07-13', CNPJ_Fundo: '333', Gestor_Apelido: 'C', RetornoCota: '0.1', PL: '10' },  // 1 obs -> insuficiente
]

test('aggPerfPeriodo: composto geometrico + cobertura (glitch e insuficiente)', () => {
  const p = aggPerfPeriodo(perf, R, { minCobertura: 0.6 })
  assert.equal(p.diasUteis, 3)                          // 13,14,15
  assert.equal(p.fundos.length, 1)
  assert.equal(p.fundos[0].cnpj, '111')
  // ∏(1+r/100)-1 = 1.01*1.02*0.995 - 1 = 0.025049 -> 2.5049%
  assert.equal(p.fundos[0].retorno, 2.5049)
  assert.equal(p.fundos[0].obs, 3)
  assert.equal(p.excluidos.glitch, 1)                  // 222
  assert.equal(p.excluidos.insuficiente, 1)            // 333
})

test('aggPerfPeriodo: composto != soma dos diarios', () => {
  // soma simples = 1+2-0.5 = 2.5; composto = 2.5049... -> arredonda p/ 2.5 aqui,
  // mas com retornos maiores a diferenca aparece:
  const rows = [
    { Dia: '2026-07-13', CNPJ_Fundo: '9', Gestor_Apelido: 'X', RetornoCota: '10', PL: '1' },
    { Dia: '2026-07-14', CNPJ_Fundo: '9', Gestor_Apelido: 'X', RetornoCota: '10', PL: '1' },
    { Dia: '2026-07-15', CNPJ_Fundo: '9', Gestor_Apelido: 'X', RetornoCota: '10', PL: '1' },
  ]
  const p = aggPerfPeriodo(rows, R, { minCobertura: 0.6 })
  // soma = 30; composto = 1.1^3 - 1 = 33.1%
  assert.equal(p.fundos[0].retorno, 33.1)
})

test('aggIda: retorno do indice + variacao de spread ponta-a-ponta', () => {
  const ida = new Map([
    ['IDADI', [{ data: '2026-06-30', numero: 100 }, { data: '2026-07-17', numero: 101 }]],
    ['IDAIPCAINFRAESTRUTURA', [{ data: '2026-06-30', numero: 200 }, { data: '2026-07-17', numero: 206 }]],
  ])
  const spr = new Map([
    ['CDI', [{ data: '2026-06-30', spreadBps: 120 }, { data: '2026-07-17', spreadBps: 135 }]],
    ['IPCAINFRA', [{ data: '2026-06-30', spreadBps: 40 }, { data: '2026-07-17', spreadBps: 35 }]],
  ])
  const r = aggIda(ida, spr, '2026-06-30', '2026-07-17')
  assert.equal(r.trad.retornoPct, 1)          // 101/100 - 1
  assert.equal(r.trad.variacaoBps, 15)        // abriu 15 bps
  assert.equal(r.trad.spreadConfiavel, true)
  assert.equal(r['12431'].retornoPct, 3)      // 206/200 - 1
  assert.equal(r['12431'].variacaoBps, -5)    // fechou 5 bps
  assert.equal(r['12431'].spreadConfiavel, false)  // IPCA-Infra: nivel e' regime/aprox
})

test('aggIda: sem as duas pontas -> null (nao inventa)', () => {
  const ida = new Map([['IDADI', [{ data: '2026-07-17', numero: 101 }]]])
  const r = aggIda(ida, new Map(), '2026-06-30', '2026-07-17')
  assert.equal(r.trad, null)
})

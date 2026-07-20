import test from 'node:test'
import assert from 'node:assert/strict'
import { agregarFundosPorGestor } from '../src/utils/fluxo.js'
import { cnpjsNoCorte, CORTE_OFICIAL, CORTES } from '../src/utils/corte.js'

const wk = (key, date) => ({ weekKey: key, weekDate: new Date(date).getTime() })

const fundo = (key, cnpj, gestor, cap, res, pl) => ({
  ...wk(key, key),
  dataBase: key,
  cnpj, gestor,
  captacao: cap, resgate: res, liquido: cap - res,
  plSemana: pl,
})

test('agregarFundosPorGestor soma captacao/resgate por gestor na semana', () => {
  const rows = [
    fundo('2026-01-05', '111', 'A', 10, 4, 100),
    fundo('2026-01-05', '222', 'A', 5, 1, 50),
    fundo('2026-01-05', '333', 'B', 7, 2, 70),
  ]
  const out = agregarFundosPorGestor(rows, null)
  assert.equal(out.length, 2)
  const a = out.find(r => r.gestor === 'A')
  assert.equal(a.captacao, 15)
  assert.equal(a.resgate, 5)
  assert.equal(a.liquido, 10)
  assert.equal(a.plSemana, 150)
  assert.equal(a.numFundos, 2)
})

test('numFundos conta CNPJ DISTINTO (fundo repetido na semana nao infla)', () => {
  const rows = [
    fundo('2026-01-05', '111', 'A', 10, 0, 100),
    fundo('2026-01-05', '111', 'A', 5, 0, 0),   // mesmo CNPJ, 2a linha
  ]
  const [a] = agregarFundosPorGestor(rows, null)
  assert.equal(a.captacao, 15, 'valores somam')
  assert.equal(a.numFundos, 1, 'mas o fundo conta uma vez so')
})

test('o corte tira do agregado quem nao passa da regua', () => {
  const rows = [
    fundo('2026-01-05', '111', 'A', 10, 0, 100),
    fundo('2026-01-05', '222', 'A', 90, 0, 900),
  ]
  const pct = new Map([['111', 12], ['222', 40]])
  const aceitos = cnpjsNoCorte(pct, 20)
  assert.deepEqual([...aceitos], ['222'], 'so o de 40% passa do corte 20%')
  const [a] = agregarFundosPorGestor(rows, aceitos)
  assert.equal(a.captacao, 90, 'o fundo de 12% saiu da conta')
  assert.equal(a.numFundos, 1)
})

test('cnpjsNoCorte e estritamente MAIOR que o corte (mesma regra do pipeline)', () => {
  const pct = new Map([['111', 15], ['222', 15.01]])
  const aceitos = cnpjsNoCorte(pct, 15)
  assert.equal(aceitos.has('111'), false, 'exatamente 15% NAO passa do corte 15')
  assert.equal(aceitos.has('222'), true)
})

test('fundo ausente do mapa fica de fora quando o corte aperta', () => {
  const rows = [fundo('2026-01-05', '999', 'A', 10, 0, 100)]
  const aceitos = cnpjsNoCorte(new Map([['111', 50]]), 20)
  const out = agregarFundosPorGestor(rows, aceitos)
  assert.equal(out.length, 0, 'sem %Deb conhecido nao da p/ afirmar que passa')
})

test('semanas saem ordenadas e o corte oficial esta na lista de degraus', () => {
  const rows = [
    fundo('2026-02-02', '111', 'A', 1, 0, 10),
    fundo('2026-01-05', '111', 'A', 2, 0, 10),
  ]
  const out = agregarFundosPorGestor(rows, null)
  assert.deepEqual(out.map(r => r.weekKey), ['2026-01-05', '2026-02-02'])
  assert.ok(CORTES.includes(CORTE_OFICIAL), 'o corte oficial precisa ser selecionavel')
})

import { historicoNoCorte } from '../src/utils/corte.js'

test('historicoNoCorte reagrega por mes/gestor/segmento mantendo so o corte', () => {
  const perFundo = [
    { mes: '202606', cnpj: '111', gestor: 'A', segmento: 'CDI', caixa: 10, pl: 100 },
    { mes: '202606', cnpj: '222', gestor: 'A', segmento: 'CDI', caixa: 5, pl: 50 },
    { mes: '202605', cnpj: '111', gestor: 'A', segmento: 'CDI', caixa: 8, pl: 100 },
  ]
  const aceitos = new Set(['111'])   // 222 fica de fora
  const h = historicoNoCorte(perFundo, aceitos)
  assert.deepEqual(h.meses, ['202605', '202606'], 'meses ordenados')
  const jun = h.series.find(r => r.mes === '202606')
  assert.equal(jun.caixa, 10, 'so o 111 entra no mes')
  assert.equal(jun.pl, 100)
  assert.equal(h.series.length, 2, 'um registro por (mes,gestor,seg)')
})

test('historicoNoCorte sem filtro soma todos os fundos', () => {
  const perFundo = [
    { mes: '202606', cnpj: '111', gestor: 'A', segmento: 'CDI', caixa: 10, pl: 100 },
    { mes: '202606', cnpj: '222', gestor: 'A', segmento: 'CDI', caixa: 5, pl: 50 },
  ]
  const h = historicoNoCorte(perFundo, null)
  assert.equal(h.series[0].caixa, 15, 'os dois somam')
  assert.equal(h.series[0].pl, 150)
})

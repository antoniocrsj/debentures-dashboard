import test from 'node:test'
import assert from 'node:assert/strict'
import { amortPorAno, fracaoEstimada } from '../src/utils/amortizacao.js'

// datas bem no futuro p/ o teste nao expirar
const M = arr => new Map(arr)

test('amortPorAno distribui o volume pelas parcelas futuras (soma = volume)', () => {
  const assets = [{ codigoAtivo: 'AAA', volumeEmitido: 1000 }]
  const crono = M([['AAA', [
    { data: '2099-06-15', pct: 50, fonte: 'fixo' },
    { data: '2100-06-15', pct: 50, fonte: 'fixo' },
  ]]])
  const r = amortPorAno(assets, crono)
  assert.deepEqual(r.map(x => x.ano), ['2099', '2100'])
  assert.equal(r[0].valor, 500)
  assert.equal(r[1].valor, 500)
  assert.equal(r[0].valor + r[1].valor, 1000, 'a soma reconstroi o volume')
})

test('ignora parcelas passadas e renormaliza pelas futuras', () => {
  const assets = [{ codigoAtivo: 'AAA', volumeEmitido: 900 }]
  const crono = M([['AAA', [
    { data: '2000-01-01', pct: 40, fonte: 'anbima' },  // passado -> ignora
    { data: '2099-01-01', pct: 30, fonte: 'anbima' },
    { data: '2100-01-01', pct: 30, fonte: 'anbima' },
  ]]])
  const r = amortPorAno(assets, crono)
  // futuras: 30+30=60; cada uma leva metade do volume
  assert.equal(r.length, 2)
  assert.equal(r[0].valor, 450)
  assert.equal(r[1].valor, 450)
})

test('agrega varios ativos no mesmo ano', () => {
  const assets = [
    { codigoAtivo: 'AAA', volumeEmitido: 100 },
    { codigoAtivo: 'BBB', volumeEmitido: 200 },
  ]
  const crono = M([
    ['AAA', [{ data: '2099-03-01', pct: 100, fonte: 'bullet' }]],
    ['BBB', [{ data: '2099-09-01', pct: 100, fonte: 'bullet' }]],
  ])
  const r = amortPorAno(assets, crono)
  assert.equal(r.length, 1)
  assert.equal(r[0].ano, '2099')
  assert.equal(r[0].valor, 300)
})

test('ateAno lumpa os anos alem do teto num balde "N+"', () => {
  const assets = [{ codigoAtivo: 'AAA', volumeEmitido: 300 }]
  const crono = M([['AAA', [
    { data: '2030-01-01', pct: 100 / 3, fonte: 'linear' },
    { data: '2040-01-01', pct: 100 / 3, fonte: 'linear' },
    { data: '2050-01-01', pct: 100 / 3, fonte: 'linear' },
  ]]])
  const r = amortPorAno(assets, crono, { ateAno: 2035 })
  const balde = r.find(x => x.ano === '2035+')
  assert.ok(balde, 'existe o balde 2035+')
  assert.ok(Math.abs(balde.valor - 200) < 1e-6, 'os dois anos alem do teto somam')
})

test('fracaoEstimada = share de volume cuja fonte tem linear', () => {
  const assets = [
    { codigoAtivo: 'AAA', volumeEmitido: 300 },  // linear
    { codigoAtivo: 'BBB', volumeEmitido: 700 },  // anbima
  ]
  const crono = M([
    ['AAA', [{ data: '2099-01-01', pct: 100, fonte: 'linear' }]],
    ['BBB', [{ data: '2099-01-01', pct: 100, fonte: 'anbima' }]],
  ])
  assert.equal(fracaoEstimada(assets, crono), 0.3)
})

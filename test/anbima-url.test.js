// Testes do helper de link da ANBIMA (botão "Ver na ANBIMA" no modal do ativo).
// Rodar: node --test test/anbima-url.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anbimaUrl, normalizeTicker } from '../src/utils/anbima.js'

const BASE = 'https://data.anbima.com.br/debentures'

test('normalizeTicker: apara espaços e converte para maiúsculas', () => {
  assert.equal(normalizeTicker('  ceapa0 '), 'CEAPA0')
  assert.equal(normalizeTicker('petr16'), 'PETR16')
  assert.equal(normalizeTicker(''), '')
  assert.equal(normalizeTicker(null), '')
  assert.equal(normalizeTicker(undefined), '')
})

test('anbimaUrl: ticker válido gera URL de características', () => {
  assert.equal(anbimaUrl('CEAPA0'), `${BASE}/CEAPA0/caracteristicas`)
  assert.equal(anbimaUrl('PETR16'), `${BASE}/PETR16/caracteristicas`)
})

test('anbimaUrl: minúsculas viram maiúsculas', () => {
  assert.equal(anbimaUrl('ceapa0'), `${BASE}/CEAPA0/caracteristicas`)
})

test('anbimaUrl: espaços extras nas pontas são removidos', () => {
  assert.equal(anbimaUrl('  CEAPA0  '), `${BASE}/CEAPA0/caracteristicas`)
  assert.equal(anbimaUrl(' petr16 '), `${BASE}/PETR16/caracteristicas`)
})

test('anbimaUrl: sem ticker retorna null (botão não deve aparecer)', () => {
  assert.equal(anbimaUrl(''), null)
  assert.equal(anbimaUrl('   '), null)
  assert.equal(anbimaUrl(null), null)
  assert.equal(anbimaUrl(undefined), null)
})

test('anbimaUrl: números e letras do código não são alterados', () => {
  assert.equal(anbimaUrl('ABCD12'), `${BASE}/ABCD12/caracteristicas`)
})

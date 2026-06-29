// Testes da integracao ANBIMA no front-end (merge por ticker + exibicao).
// As regras financeiras (conversao %CDI, spread NTN-B por fator, formatacao das
// taxas) ficam na camada de preparacao (tools/preparar-anbima.ps1) e foram
// validadas com dados reais. Aqui cobrimos o que o app faz: cruzar e exibir.
// Rodar: node --test test/anbima.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnbimaIndex, enrichDebenture } from '../src/utils/data.js'

const ctx = anbimaByTicker => ({ emissorMap: {}, blcByAtivo: {}, fundoMap: {}, anbimaByTicker })
const deb = ticker => ({ 'Codigo do Ativo': ticker })

test('buildAnbimaIndex: indexa por ticker em maiusculas, com trim', () => {
  const idx = buildAnbimaIndex([
    { ticker: 'egiea1', txAnbimaFormatada: 'B32 - 45 bps' },
    { ticker: ' AALM12 ', txAnbimaFormatada: 'CDI + 0,68%' },
  ])
  assert.equal(idx['EGIEA1'].txAnbimaFormatada, 'B32 - 45 bps')
  assert.equal(idx['AALM12'].txAnbimaFormatada, 'CDI + 0,68%')
})

test('caso 1: CDI + spread encontrado', () => {
  const idx = buildAnbimaIndex([{ ticker: 'AALM12', txAnbimaFormatada: 'CDI + 0,68%' }])
  assert.equal(enrichDebenture(deb('AALM12'), ctx(idx)).txAnbima, 'CDI + 0,68%')
})

test('caso 2: percentual do CDI ja convertido', () => {
  const idx = buildAnbimaIndex([{ ticker: 'KLBNA2', txAnbimaFormatada: 'CDI + 0,39%', percentualCdiOriginal: '103,1418' }])
  const a = enrichDebenture(deb('KLBNA2'), ctx(idx))
  assert.equal(a.txAnbima, 'CDI + 0,39%')
  assert.equal(a.anbimaInfo.percentualCdiOriginal, '103,1418')
})

test('caso 3: IPCA com NTN-B identificada traz a auditoria do spread', () => {
  const idx = buildAnbimaIndex([{
    ticker: 'EGIEA1', txAnbimaFormatada: 'B32 - 45 bps',
    codigoNtnbExibicao: 'B32', taxaNtnbReferencia: '8,3827', spreadNtnbBps: '-45',
  }])
  const a = enrichDebenture(deb('EGIEA1'), ctx(idx))
  assert.equal(a.txAnbima, 'B32 - 45 bps')
  assert.equal(a.anbimaInfo.spreadNtnbBps, '-45')
})

test('caso 4: IPCA sem NTN-B (status pendente) exibe —', () => {
  const idx = buildAnbimaIndex([{ ticker: 'XPTO11', txAnbimaFormatada: '—', statusCalculoAnbima: 'ipca_sem_taxa_ntnb' }])
  assert.equal(enrichDebenture(deb('XPTO11'), ctx(idx)).txAnbima, '—')
})

test('caso 5: prefixado', () => {
  const idx = buildAnbimaIndex([{ ticker: 'AEGPA8', txAnbimaFormatada: '17,30%' }])
  assert.equal(enrichDebenture(deb('AEGPA8'), ctx(idx)).txAnbima, '17,30%')
})

test('caso 6: IGP-M', () => {
  const idx = buildAnbimaIndex([{ ticker: 'CVRDA6', txAnbimaFormatada: 'IGP-M + 1,20%' }])
  assert.equal(enrichDebenture(deb('CVRDA6'), ctx(idx)).txAnbima, 'IGP-M + 1,20%')
})

test('caso 7: ticker nao encontrado -> — e anbimaInfo null', () => {
  const a = enrichDebenture(deb('NADA99'), ctx(buildAnbimaIndex([])))
  assert.equal(a.txAnbima, '—')
  assert.equal(a.anbimaInfo, null)
})

test('caso 8: taxa vazia -> —', () => {
  const idx = buildAnbimaIndex([{ ticker: 'VAZIO1', txAnbimaFormatada: '' }])
  assert.equal(enrichDebenture(deb('VAZIO1'), ctx(idx)).txAnbima, '—')
})

test('caso 12: spread negativo e exibido com sinal -', () => {
  const idx = buildAnbimaIndex([{ ticker: 'NEG111', txAnbimaFormatada: 'B35 - 10 bps' }])
  assert.equal(enrichDebenture(deb('NEG111'), ctx(idx)).txAnbima, 'B35 - 10 bps')
})

test('ticker do app em minusculo casa com a base ANBIMA', () => {
  const idx = buildAnbimaIndex([{ ticker: 'AALM12', txAnbimaFormatada: 'CDI + 0,68%' }])
  assert.equal(enrichDebenture(deb('aalm12'), ctx(idx)).txAnbima, 'CDI + 0,68%')
})

test('base sem ANBIMA (arquivo ausente) nao quebra: tudo vira —', () => {
  const a = enrichDebenture(deb('AALM12'), ctx(buildAnbimaIndex([])))
  assert.equal(a.txAnbima, '—')
  // left join preserva o ativo
  assert.equal(a.codigoAtivo, 'AALM12')
})

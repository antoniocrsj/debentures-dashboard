import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cortesRange, janelaRange, aggSensibilidade } from '../src/utils/sensibilidade.js'

test('cortesRange: grade densa 10-80 passo 1 = 71 pontos', () => {
  const c = cortesRange(10, 80, 1)
  assert.equal(c.length, 71)
  assert.equal(c[0], 10)
  assert.equal(c.at(-1), 80)
})

test('janelaRange: 12m/6m contam a partir da data-ancora; total sem inicio', () => {
  assert.equal(janelaRange('2026-07-15', null).start, null)
  assert.equal(janelaRange('2026-07-15', 12).start, '2025-07-15')
  assert.equal(janelaRange('2026-07-15', 6).start, '2026-01-15')
})

// Universo com 3 fundos 12431: A=25% (forte), B=17% (entre 15-25), C=12% (so' no
// piso). fluxo diario cobre um mes; A e B captam liquido positivo, C so' resgata.
const UNIVERSO = [
  { cnpj: 'A', segmento: '12431', pctDeb: 25, pl: 1000 },
  { cnpj: 'B', segmento: '12431', pctDeb: 17, pl: 500 },
  { cnpj: 'C', segmento: '12431', pctDeb: 12, pl: 200 },
  { cnpj: 'D', segmento: 'CDI', pctDeb: 30, pl: 300 },
]
const FLUXO = [
  { dia: '2026-07-01', cnpj: 'A', captacao: 100, resgate: 10, pl: 1000 },
  { dia: '2026-07-02', cnpj: 'A', captacao: 50, resgate: 0, pl: 1050 },
  { dia: '2026-07-01', cnpj: 'B', captacao: 30, resgate: 5, pl: 500 },
  { dia: '2026-07-02', cnpj: 'B', captacao: 20, resgate: 0, pl: 520 },
  { dia: '2026-07-01', cnpj: 'C', captacao: 0, resgate: 40, pl: 200 },
  { dia: '2026-07-02', cnpj: 'C', captacao: 0, resgate: 10, pl: 150 },
  { dia: '2026-07-01', cnpj: 'D', captacao: 60, resgate: 0, pl: 300 },
]

test('aggSensibilidade: corte mais apertado exclui fundos, muda o liquido total', () => {
  const r = aggSensibilidade({ universo: UNIVERSO, fluxo: FLUXO, cortes: [10, 15, 20, 26], janelas: { total: null } })
  const porCorte = Object.fromEntries(r.porSegmento['12431'].total.map(p => [p.corte, p]))

  // corte 10: A, B e C entram (todos > 10%).
  assert.equal(porCorte[10].numFundos, 3)
  assert.equal(porCorte[10].captacao, 100 + 50 + 30 + 20)   // A+B, C nao capta
  assert.equal(porCorte[10].resgate, 10 + 5 + 40 + 10)      // A+B+C
  assert.equal(porCorte[10].liquido, porCorte[10].captacao - porCorte[10].resgate)

  // corte 15: C (12%) cai fora; so' A e B ficam.
  assert.equal(porCorte[15].numFundos, 2)
  assert.equal(porCorte[15].captacao, 100 + 50 + 30 + 20)
  assert.equal(porCorte[15].resgate, 10 + 5)

  // corte 20: B (17%) tambem cai; so' A.
  assert.equal(porCorte[20].numFundos, 1)
  assert.equal(porCorte[20].captacao, 150)
  assert.equal(porCorte[20].liquido, 150 - 10)

  // corte 26: ninguem passa (A=25% nao e' > 26%).
  assert.equal(porCorte[26].numFundos, 0)
  assert.equal(porCorte[26].captacao, 0)
  assert.equal(porCorte[26].liquido, 0)
})

test('aggSensibilidade: segmentos nao se misturam (CDI/trad isolado do 12431)', () => {
  const r = aggSensibilidade({ universo: UNIVERSO, fluxo: FLUXO, cortes: [10], janelas: { total: null } })
  const trad = r.porSegmento.trad.total.find(p => p.corte === 10)
  assert.equal(trad.numFundos, 1)
  assert.equal(trad.captacao, 60)
  assert.equal(trad.resgate, 0)
})

test('aggSensibilidade: PL e o ESTOQUE da ultima data na janela, nunca somado entre dias', () => {
  const r = aggSensibilidade({ universo: UNIVERSO, fluxo: FLUXO, cortes: [10], janelas: { total: null } })
  const p10 = r.porSegmento['12431'].total.find(p => p.corte === 10)
  // A termina em 1050 (02/07), B em 520 (02/07), C em 150 (02/07) -> soma 1720,
  // NUNCA 1000+1050+500+520+200+150 (que seria somar os dois dias).
  assert.equal(p10.pl, 1050 + 520 + 150)
})

test('aggSensibilidade: janela 6m/12m restringe a data de inicio (exclusivo)', () => {
  const fluxoLongo = [
    { dia: '2025-01-10', cnpj: 'A', captacao: 999, resgate: 0, pl: 100 },   // fora de 6m e 12m
    { dia: '2026-07-01', cnpj: 'A', captacao: 100, resgate: 0, pl: 1000 },
    { dia: '2026-07-02', cnpj: 'A', captacao: 50, resgate: 0, pl: 1050 },
  ]
  const universoA = [{ cnpj: 'A', segmento: '12431', pctDeb: 25, pl: 1000 }]
  const r = aggSensibilidade({ universo: universoA, fluxo: fluxoLongo, cortes: [10], janelas: { total: null, '6m': 6 } })
  const total = r.porSegmento['12431'].total.find(p => p.corte === 10)
  const seis = r.porSegmento['12431']['6m'].find(p => p.corte === 10)
  assert.equal(total.captacao, 999 + 100 + 50)
  assert.equal(seis.captacao, 100 + 50)   // exclui o dia de 2025 (fora da janela de 6m)
})

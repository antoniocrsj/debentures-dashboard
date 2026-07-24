import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toISO, toNum, isMissing, normalizarRegistro, SHEETS } from '../tools/preparar-anbima-be.mjs'
import { fmtRecompraTaxa } from '../src/utils/format.js'
import { buildAnbimaBEIndex, enrichDebenture } from '../src/utils/data.js'
import { parseCSV } from '../src/utils/csv.js'

const [EXERC, FUTURO] = SHEETS
const REF = '2026-07-17'
const MINUS = '−' // sinal usado por fmtRecompraTaxa para negativos
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// --- conversao das datas do Excel -------------------------------------------
test('toISO: serial Excel, Date, ISO, BR e ausentes', () => {
  assert.equal(toISO(46220), '2026-07-17')   // data de referencia
  assert.equal(toISO(46373), '2026-12-17')   // proximo evento (RADL14)
  assert.equal(toISO(new Date(Date.UTC(2027, 9, 4))), '2027-10-04')
  assert.equal(toISO('2026-12-17'), '2026-12-17')
  assert.equal(toISO('17/12/2026'), '2026-12-17')
  for (const v of ['-', '', null, undefined]) assert.equal(toISO(v), null)
})

// --- numeros (negativos preservados) + normalizacao -------------------------
test('toNum: US/BR/negativo/percent e ausentes -> null', () => {
  assert.equal(toNum('105.4679'), 105.4679)
  assert.equal(toNum('-1.264'), -1.264)          // taxa negativa preservada
  assert.equal(toNum(304), 304)
  assert.equal(toNum('1,6'), 1.6)                // BR
  assert.equal(toNum('1.045.245,00'), 1045245)   // BR com milhar
  assert.equal(toNum('7,07%'), 7.07)
  for (const v of ['-', '', null]) assert.equal(toNum(v), null)
})

test('isMissing: vazio/traco/N-D sao ausentes; valor nao', () => {
  for (const v of ['', '-', '—', 'n/d', null, undefined]) assert.equal(isMissing(v), true)
  for (const v of ['0', 0, 'DI + 1,6%', 105.4]) assert.equal(isMissing(v), false)
})

// --- classificacao Em exercicio / Futuro + normalizacao ---------------------
test('normalizarRegistro: Em exercicio (implicita), ticker UPPER/trim', () => {
  const r = normalizarRegistro({ ticker: ' radl14 ', remuneracao: '106,99% do DI', dataEvento: 46373, pctPuPar: 1.000976, taxaEvento: 105.4679 }, EXERC, REF)
  assert.equal(r.ticker, 'RADL14')
  assert.equal(r.statusExercicio, 'Em exercício')
  assert.equal(r.tipoTaxa, 'implícita')
  assert.equal(r.dataEvento, '2026-12-17')
  assert.equal(r.taxaEvento, 105.4679)
  assert.equal(r.origemAba, EXERC.nome)
  assert.equal(r.dataReferencia, REF)
})

test('normalizarRegistro: Futuro (breakeven) com taxa NEGATIVA e dias uteis', () => {
  const r = normalizarRegistro({ ticker: 'AALM12', remuneracao: 'DI + 1,6%', dataEvento: 46664, diasUteisAteEvento: 304, pctPuPar: 1.045245, taxaEvento: -1.264 }, FUTURO, REF)
  assert.equal(r.statusExercicio, 'Futuro')
  assert.equal(r.tipoTaxa, 'breakeven')
  assert.equal(r.taxaEvento, -1.264)
  assert.equal(r.diasUteisAteEvento, 304)
  assert.equal(r.dataEvento, '2027-10-04')
})

test('normalizarRegistro: Em exercicio SEM proximo evento -> nulls, status mantido', () => {
  const r = normalizarRegistro({ ticker: 'ABSP12', remuneracao: 'DI + 1,95%', dataEvento: '-', pctPuPar: '-', taxaEvento: '-' }, EXERC, REF)
  assert.equal(r.statusExercicio, 'Em exercício')  // status preservado
  assert.equal(r.dataEvento, null)
  assert.equal(r.taxaEvento, null)                 // nao inventa
  assert.equal(r.pctPuPar, null)
})

// --- formatacao DI+ / % do DI / IPCA+ (incl. negativa) ----------------------
test('fmtRecompraTaxa: %DI, DI+, IPCA+, negativa e null', () => {
  assert.equal(fmtRecompraTaxa(105.4679, '106,99% do DI'), '105,47% DI')
  assert.equal(fmtRecompraTaxa(2.5096, 'DI + 3,9%'), 'DI +2,51%')
  assert.equal(fmtRecompraTaxa(-1.264, 'DI + 1,6%'), `DI ${MINUS}1,26%`)   // negativa
  assert.equal(fmtRecompraTaxa(6.1774, 'IPCA + 6,1774%'), 'IPCA +6,18%')
  assert.equal(fmtRecompraTaxa(null, 'DI + 1,6%'), '-')
  assert.equal(fmtRecompraTaxa(NaN, 'DI + 1,6%'), '-')
})

// --- indice + join no enrich ------------------------------------------------
test('buildAnbimaBEIndex: ticker UPPER, numeros, negativo, missing -> null', () => {
  const idx = buildAnbimaBEIndex([
    { ticker: 'aalm12', statusExercicio: 'Futuro', dataEvento: '2027-10-04', diasUteisAteEvento: '304', pctPuPar: '1.045245', taxaEvento: '-1.264', tipoTaxa: 'breakeven', remuneracao: 'DI + 1,6%', dataReferencia: REF, origemAba: FUTURO.nome },
    { ticker: 'ABSP12', statusExercicio: 'Em exercício', dataEvento: '', diasUteisAteEvento: '', pctPuPar: '', taxaEvento: '', tipoTaxa: 'implícita', remuneracao: 'DI + 1,95%', dataReferencia: REF, origemAba: EXERC.nome },
  ])
  assert.equal(idx.AALM12.taxaEvento, -1.264)
  assert.equal(idx.AALM12.diasUteisAteEvento, 304)
  assert.equal(idx.ABSP12.taxaEvento, null)
  assert.equal(idx.ABSP12.dataEvento, '')
})

test('enrichDebenture: junta recompra por ticker; sem match -> null', () => {
  const idx = buildAnbimaBEIndex([{ ticker: 'RADL14', statusExercicio: 'Em exercício', dataEvento: '2026-12-17', diasUteisAteEvento: '', pctPuPar: '1.000976', taxaEvento: '105.4679', tipoTaxa: 'implícita', remuneracao: '106,99% do DI', dataReferencia: REF, origemAba: EXERC.nome }])
  const base = { emissorMap: {}, blcByAtivo: {}, anbimaByTicker: {}, anbimaBEByTicker: idx }
  const a = enrichDebenture({ 'Codigo do Ativo': 'RADL14', 'CNPJ': '123' }, base)
  assert.equal(a.recompra.taxaEvento, 105.4679)
  const b = enrichDebenture({ 'Codigo do Ativo': 'XXXX99', 'CNPJ': '123' }, base)  // ausente no cadastro/base
  assert.equal(b.recompra, null)
})

test('app funciona SEM a base opcional (indice vazio): recompra null, sem quebrar', () => {
  const a = enrichDebenture({ 'Codigo do Ativo': 'RADL14' }, { emissorMap: {}, blcByAtivo: {}, anbimaByTicker: {}, anbimaBEByTicker: buildAnbimaBEIndex([]) })
  assert.equal(a.recompra, null)
  assert.equal(a.codigoAtivo, 'RADL14')
  // e tambem quando a chave nem e' passada (base ausente por completo)
  const b = enrichDebenture({ 'Codigo do Ativo': 'RADL14' }, { emissorMap: {}, blcByAtivo: {}, anbimaByTicker: {} })
  assert.equal(b.recompra, null)
})

// --- ordenacao com valores ausentes (sempre por ultimo) ---------------------
test('ordenacao: recompra sem taxa/data vai por ULTIMO (asc e desc)', () => {
  const keyTaxa = (a, dir) => { const v = a.recompra?.taxaEvento; return v == null ? (dir === 'asc' ? Infinity : -Infinity) : v }
  const arr = [
    { id: 'a', recompra: { taxaEvento: 5 } },
    { id: 'b', recompra: null },
    { id: 'c', recompra: { taxaEvento: -2 } },
    { id: 'd', recompra: { taxaEvento: null } },
  ]
  const ordena = dir => [...arr].sort((x, y) => { const c = keyTaxa(x, dir) - keyTaxa(y, dir); return dir === 'asc' ? c : -c })
  const asc = ordena('asc')
  assert.equal(asc[0].recompra.taxaEvento, -2)                     // menor primeiro
  assert.ok(asc.slice(-2).every(x => x.recompra?.taxaEvento == null)) // ausentes por ultimo
  const desc = ordena('desc')
  assert.equal(desc[0].recompra.taxaEvento, 5)                     // maior primeiro
  assert.ok(desc.slice(-2).every(x => x.recompra?.taxaEvento == null))
})

// --- integracao: base gerada (leitura das 2 abas end-to-end) ----------------
test('base gerada: schema, cada ticker 1x, status validos, datas ISO, taxas numericas', () => {
  const csvPath = path.join(ROOT, 'public', 'Anbima_BE.csv')
  if (!fs.existsSync(csvPath)) { assert.ok(true, 'Anbima_BE.csv ausente (base opcional) — pulado'); return }
  const raw = fs.readFileSync(csvPath, 'utf8')
  assert.match(raw.split('\n')[0], /^"ticker","statusExercicio","dataEvento","diasUteisAteEvento","pctPuPar","taxaEvento","tipoTaxa","remuneracao","dataReferencia","origemAba"/)
  const rows = parseCSV(raw)
  const tickers = rows.map(r => r.ticker)
  assert.equal(new Set(tickers).size, tickers.length)                        // sem duplicados
  assert.deepEqual([...new Set(rows.map(r => r.statusExercicio))].sort(), ['Em exercício', 'Futuro'])  // 2 abas lidas
  for (const r of rows) {
    if (r.dataEvento) assert.match(r.dataEvento, /^\d{4}-\d{2}-\d{2}$/)       // datas ISO
    if (r.taxaEvento) assert.ok(Number.isFinite(parseFloat(r.taxaEvento)))    // taxa numerica
  }
  assert.ok(rows.some(r => r.taxaEvento.startsWith('-')))                     // ao menos uma negativa
  assert.ok(rows.some(r => r.taxaEvento === '' && r.statusExercicio === 'Em exercício')) // incompleto, status mantido
})

test('meta gerada: data de referencia ISO + contagens coerentes', () => {
  const metaPath = path.join(ROOT, 'public', 'Anbima_BE_meta.json')
  if (!fs.existsSync(metaPath)) { assert.ok(true, 'meta ausente — pulado'); return }
  const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  if (m.preservado) { assert.ok(true, 'base preservada (planilha ausente/invalida)'); return }
  assert.match(m.dataReferencia, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(m.total, m.emExercicio + m.futuro)
  assert.ok(Array.isArray(m.tickersNaoEncontrados))
  assert.ok(Array.isArray(m.registrosIncompletos))
})

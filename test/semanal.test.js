import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { weekRange } from '../src/utils/periods.js'
import {
  classificaTendencia, TENDENCIA, buildDebentures, buildTendencia, pctDelta, median, quantile, trimMean, volSerie,
} from '../tools/relatorios/semanal.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public', 'reports')

// ── Classificação de tendência (regra explícita) ────────────────────────────
test('classificaTendencia: sem snapshot -> dados insuficientes', () => {
  const r = classificaTendencia({ semFronteira: true })
  assert.equal(r.classe, 'dados insuficientes')
})
test('classificaTendencia: amostra abaixo do mínimo -> dados insuficientes', () => {
  const r = classificaTendencia({ n: 5, medianaBps: 3, pctAbriu: 80, pctFechou: 10 })
  assert.equal(r.classe, 'dados insuficientes')
})
test('classificaTendencia: casos das semanas do estudo (12.431)', () => {
  // W29: mediana +2, 75% abriu / 14% fechou -> abertura (breadth forte)
  assert.equal(classificaTendencia({ n: 594, medianaBps: 2, pctAbriu: 75, pctFechou: 14 }).classe, 'abertura')
  // W28: mediana +1, 57/29 -> leve abertura
  assert.equal(classificaTendencia({ n: 604, medianaBps: 1, pctAbriu: 57, pctFechou: 29 }).classe, 'leve abertura')
  // W30: mediana -1, 31/57 -> leve fechamento
  assert.equal(classificaTendencia({ n: 618, medianaBps: -1, pctAbriu: 31, pctFechou: 57 }).classe, 'leve fechamento')
})
test('classificaTendencia: fechamento forte, estabilidade e misto', () => {
  assert.equal(classificaTendencia({ n: 100, medianaBps: -6, pctAbriu: 10, pctFechou: 80 }).classe, 'fechamento')
  assert.equal(classificaTendencia({ n: 100, medianaBps: 0, pctAbriu: 20, pctFechou: 22 }).classe, 'estabilidade')
  assert.equal(classificaTendencia({ n: 100, medianaBps: 0, pctAbriu: 40, pctFechou: 40 }).classe, 'movimento misto')
})
test('classificaTendencia: 15..40 marca amostra pequena mas classifica', () => {
  const r = classificaTendencia({ n: 21, medianaBps: -1, pctAbriu: 19, pctFechou: 57 })
  assert.equal(r.classe, 'leve fechamento')
  assert.equal(r.amostraPequena, true)
})

// ── pctDelta: sem divisão por zero ──────────────────────────────────────────
test('pctDelta: base zero/null -> null (sem divisão por zero)', () => {
  assert.equal(pctDelta(10, 0), null)
  assert.equal(pctDelta(10, null), null)
  assert.equal(pctDelta(15, 10), 0.5)
})

// ── Estatística básica ──────────────────────────────────────────────────────
test('median/quantile/trimMean', () => {
  assert.equal(median([1, 2, 3]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(Math.round(trimMean([0, 1, 2, 3, 100], 0.2)), 2)   // apara extremos
})

// ── Fixture p/ buildDebentures ──────────────────────────────────────────────
const linha = (o) => ({
  'Codigo do Ativo': o.tk, 'Empresa': o.emp || 'Emissor X', 'Serie': o.serie || 'S001',
  'Emissao': o.emissao || '1', 'CNPJ': o.cnpj, 'Data de Registro CVM da Emissao': o.data,
  'Quantidade Emitida': o.qtd, 'Valor Nominal na Emissao': o.vn || 1000,
  'Deb. Incent. (Lei 12.431)': o.inc ? 'S' : 'N', 'indice': o.idx || 'IPCA',
  'Juros Criterio Novo - Taxa': o.taxa || '', 'Data de Vencimento': o.venc || '',
  'Garantia/Especie': o.gar || '', 'Tipo de Amortizacao': o.amort || '', 'Coordenador Lider': o.lider || '',
  'Registro CVM da Emissao': o.reg || '',
})
const srcBase = {
  emissores: new Map([['11111111111111', { grupo: 'Grupo A', empresa: 'Alpha SA', setor: 'Energia' }]]),
  anbimaBE: new Map(), anbimaTx: new Map(),
}
const RANGE = weekRange('2026-W31')  // 2026-07-27 .. 2026-08-02

test('buildDebentures: seleção pela data de Registro CVM dentro da semana', () => {
  const src = { ...srcBase, debentures: [
    linha({ tk: 'AAA11', cnpj: '11111111111111', emissao: '1', data: '2026-07-28', qtd: 100000, inc: true }),   // dentro
    linha({ tk: 'BBB11', cnpj: '22222222222222', emissao: '1', data: '2026-07-20', qtd: 100000, inc: true }),   // semana anterior (fora)
  ] }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.resumo.nOfertas, 1)
  assert.equal(r.ofertas[0].tickers[0], 'AAA11')
})

test('buildDebentures: dedup multi-série numa oferta (soma das séries)', () => {
  const src = { ...srcBase, debentures: [
    linha({ tk: 'MUL11', cnpj: '11111111111111', emissao: '2', serie: 'S001', data: '2026-07-28', qtd: 300000, inc: true }),
    linha({ tk: 'MUL21', cnpj: '11111111111111', emissao: '2', serie: 'S002', data: '2026-07-28', qtd: 200000, inc: true }),
  ] }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.resumo.nOfertas, 1)          // 2 séries -> 1 oferta
  assert.equal(r.resumo.nSeries, 2)
  assert.equal(r.ofertas[0].volumeOferta, 500000 * 1000)   // 300k+200k séries x VN
  assert.deepEqual(r.ofertas[0].tickers.sort(), ['MUL11', 'MUL21'])
})

test('buildDebentures: split 12.431 x tradicional e totais', () => {
  const src = { ...srcBase, debentures: [
    linha({ tk: 'INC11', cnpj: '11111111111111', emissao: '3', data: '2026-07-28', qtd: 500000, inc: true }),
    linha({ tk: 'TRA11', cnpj: '33333333333333', emissao: '1', data: '2026-07-29', qtd: 40000, inc: false }),
  ] }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.resumo.volume12431, 500000 * 1000)
  assert.equal(r.resumo.volumeTradicional, 40000 * 1000)
  assert.equal(r.resumo.volumeTotal, 540000 * 1000)
})

test('buildDebentures: semana sem emissões', () => {
  const r = buildDebentures(RANGE, { ...srcBase, debentures: [] })
  assert.equal(r.resumo.nOfertas, 0)
  assert.ok(r.sintese[0].includes('Nenhuma'))
})

test('buildDebentures: série sem volume -> inconsistência sinalizada (não some silenciosamente)', () => {
  const src = { ...srcBase, debentures: [
    linha({ tk: 'NOV11', cnpj: '11111111111111', emissao: '9', serie: 'S001', data: '2026-07-28', qtd: 100000, inc: true }),
    linha({ tk: 'NOV21', cnpj: '11111111111111', emissao: '9', serie: 'S002', data: '2026-07-28', qtd: '', inc: true }),  // sem qtd
  ] }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.inconsistencias.length, 1)
  assert.equal(r.resumo.volumeConfiavel, false)
  assert.equal(r.ofertas[0].volumeParcial, true)
})

test('buildDebentures: junta o sindicato (coordenadores + líder) por número de registro', () => {
  const src = {
    ...srcBase,
    coordenadores: { 'AUT/DEB/PRI/2026/999': { coordenadores: [
      { razaoSocial: 'Banco Líder SA', cnpj: '1', lider: true },
      { razaoSocial: 'Banco Co SA', cnpj: '2', lider: false },
    ] } },
    debentures: [linha({ tk: 'SIND1', cnpj: '11111111111111', emissao: '5', data: '2026-07-28', qtd: 100000, inc: true, reg: 'AUT/DEB/PRI/2026/999' })],
  }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.ofertas[0].coordenadores.length, 2)
  assert.equal(r.ofertas[0].coordenadores.find(c => c.lider).razaoSocial, 'Banco Líder SA')
})

test('buildDebentures: sem match de registro -> coordenadores null (fallback ao cadastro)', () => {
  const src = { ...srcBase, coordenadores: {}, debentures: [linha({ tk: 'NOSIND1', cnpj: '11111111111111', emissao: '6', data: '2026-07-28', qtd: 100000, inc: true, reg: 'AUT/DEB/PRI/2026/000', lider: 'Banco X' })] }
  const r = buildDebentures(RANGE, src)
  assert.equal(r.ofertas[0].coordenadores, null)
  assert.equal(r.ofertas[0].coordenador, 'Banco X')   // fallback preservado
})

test('parseTeto: NTN-B com spread negativo/positivo, CDI e piso (remuneração máxima 12.431)', async () => {
  const { parseTeto } = await import('../tools/preparar-coordenadores-sre.mjs')
  // AXIA: "...vencimento em 15 de maio de 2035 ... spread negativo de 0,20%; ou (ii) 7,80%"
  const axia = parseTeto('serão limitados à maior taxa entre (i) A taxa interna de retorno do Tesouro IPCA+ com vencimento em 15 de maio de 2035 ... acrescida exponencialmente de um spread negativo de 0,20%; ou (ii) 7,80%')
  assert.equal(axia.compacto, 'B35 −20bps')
  assert.equal(axia.floorPct, '7,80%')
  // JBS: data "15/05/2035" + "acrescida de 0,15% a.a." (positivo)
  const jbs = parseTeto('limitado à taxa interna de retorno da NTN-B com vencimento em 15/05/2035 acrescida de 0,15% a.a.')
  assert.equal(jbs.compacto, 'B35 +15bps')
  // BTG: 2040 + "spread negativo equivalente a, no máximo, 0,30%"
  const btg = parseTeto('correspondentes à taxa interna de retorno do Tesouro IPCA+ com vencimento em 15 de agosto de 2040 ... acrescida, exponencialmente, de um determinado spread negativo equivalente a, no máximo, 0,30% ao ano.')
  assert.equal(btg.compacto, 'B40 −30bps')
  // CDI
  assert.equal(parseTeto('CDI + 2,50% a.a.').compacto, 'CDI + 2,50%')
  // Formatos DIRETOS (sem "vencimento em"): "NTN-B35 - 0,10%", "NTNB-30-0,05%",
  // "B40 - 0,90%" (sem NTN-), "+ 5,50%" (positivo).
  assert.equal(parseTeto('NTN-B35 - 0,10% a.a. ou IPCA + 7,79 a.a.').compacto, 'B35 −10bps')
  assert.equal(parseTeto('NTNB-30-0,05% ano base 252 ou IPCA+7,30%').compacto, 'B30 −5bps')
  assert.equal(parseTeto('O maior entre: B40 - 0,90% ou IPCA + 6,25%').compacto, 'B40 −90bps')
  assert.equal(parseTeto('NTN-B 2035, apurada no dia do Book + 5,50%').compacto, 'B35 +550bps')
  // EGIEA6: "vencimento em ... 2037, acrescida ... de, no máximo, -1,15%" — sinal
  // de MENOS literal (sem a palavra "negativo") tem de dar spread NEGATIVO.
  assert.equal(parseTeto('taxa interna de retorno do Tesouro IPCA+ com vencimento em 15 de maio de 2037, acrescida exponencialmente de spread (sobretaxa) de, no máximo, -1,15% ao ano, base 252').compacto, 'B37 −115bps')
  // "decrescido/decrescida" (verbo de decréscimo) = spread NEGATIVO, sem a palavra "negativo".
  assert.equal(parseTeto('taxa interna de retorno da NTN-B, com vencimento em 15 de maio de 2035, decrescido exponencialmente de 0,41% ao ano').compacto, 'B35 −41bps')
  // spread em "N bps" (inteiro), positivo e negativo.
  assert.equal(parseTeto('NTNB 2032 + 30bps a.a.').compacto, 'B32 +30bps')
  assert.equal(parseTeto('IPCA + 7,60% ou NTN-B 30 - 16bps, dos dois o maior').compacto, 'B30 −16bps')
  // "N bps" ANTES de um "%" de alternativa IPCA: usa o primeiro (o -50bps da NTN-B).
  assert.equal(parseTeto('NTNB 2035 - 50bps ou IPCA + 6,80% a.a.').compacto, 'B35 −50bps')
  // ano depois de um nome de mês ("NTN-B maio de 2035").
  assert.equal(parseTeto('O maior entre: (i) IPCA + 9,59% a.a. ou (ii) NTN-B maio de 2035 + 1,80% a.a.').compacto, 'B35 +180bps')
  // sem informação -> null
  assert.equal(parseTeto(''), null)
})

test('volSerie: parsing e ausência', () => {
  assert.equal(volSerie({ 'Quantidade Emitida': '1000', 'Valor Nominal na Emissao': '1000' }), 1e6)
  assert.equal(volSerie({ 'Quantidade Emitida': '', 'Valor Nominal na Emissao': '' }), null)
})

// ── buildTendencia sem snapshot de fronteira ────────────────────────────────
test('buildTendencia: sem snapshots -> semFronteira + dados insuficientes', () => {
  const helpers = { snapDates: () => [], readSnap: () => null, lastLT: () => null, lastLE: () => null }
  const src = { tickerInfo: new Map(), flag12431: new Map() }
  const t = buildTendencia(RANGE, src, helpers)
  assert.equal(t.semFronteira, true)
  assert.equal(t.porSegmento['12431'].classificacao, 'dados insuficientes')
  assert.equal(t.porSegmento.trad.classificacao, 'dados insuficientes')
})

// ── Saída real: Semanal v2 + preservação do Mensal ──────────────────────────
test('output: Semanal é v2 com as 3 partes; Mensal permanece no formato antigo', () => {
  const wIdx = path.join(PUB, 'weekly', 'index.json')
  const mIdx = path.join(PUB, 'monthly', 'index.json')
  if (!fs.existsSync(wIdx) || !fs.existsSync(mIdx)) return   // sem geração ainda: pula
  const w = JSON.parse(fs.readFileSync(wIdx, 'utf8')).reports
  assert.ok(w.length >= 1 && w.length <= 5)
  const wj = JSON.parse(fs.readFileSync(path.join(PUB, 'weekly', `${w[0].id}.json`), 'utf8'))
  assert.equal(wj.formato, 'v2')
  assert.ok(wj.partes && wj.partes.debentures && wj.partes.secundario && wj.partes.tecnico)
  assert.ok(!wj.sections)   // não usa o shape antigo
  const m = JSON.parse(fs.readFileSync(mIdx, 'utf8')).reports
  const mj = JSON.parse(fs.readFileSync(path.join(PUB, 'monthly', `${m[0].id}.json`), 'utf8'))
  assert.ok(mj.sections)    // Mensal INTACTO
  assert.ok(!mj.formato)
  assert.ok(!mj.partes)
})

test('output: status parcial/fechado válido e datas de fonte presentes', () => {
  const wIdx = path.join(PUB, 'weekly', 'index.json')
  if (!fs.existsSync(wIdx)) return
  const w = JSON.parse(fs.readFileSync(wIdx, 'utf8')).reports
  for (const e of w) {
    assert.ok(['partial', 'closed'].includes(e.status))
    assert.ok(fs.existsSync(path.join(PUB, 'weekly', `${e.id}.json`)))
    assert.ok(fs.existsSync(path.join(PUB, 'weekly', `${e.id}.html`)))
  }
})

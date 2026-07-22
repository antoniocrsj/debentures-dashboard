// gerar-periodos.mjs
// --------------------------------------------------------------------------
// Gera os Resumos da SEMANA e do MES, agregando as SERIES DIARIAS completas e
// os SNAPSHOTS de fronteira (nunca somando os relatorios diarios prontos).
// Reaproveita a logica pura validada: src/utils/{periods,aggregacao,ida}.js.
// O gerador diario (gerar-relatorios.mjs) fica INTOCADO.
//
// Saida: public/reports/{weekly,monthly}/<id>.json + <id>.html + index.json
// Uso:   node tools/gerar-periodos.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCSV } from '../src/utils/csv.js'
import { parseNum } from '../src/utils/format.js'
import { apelidoFundo } from '../src/utils/caixa.js'
import { diffKeyed, topMovers } from '../src/utils/reports.js'
import {
  weekRange, monthRange, monthId, isoWeekId, recentPeriods, weekLabel, monthLabel, periodStatus,
} from '../src/utils/periods.js'
import { aggCaptacaoPeriodo, aggGestoresPeriodo, aggPerfPeriodo, diasNoIntervalo } from '../src/utils/aggregacao.js'
import { aggIda, IDA_SEG } from '../src/utils/ida.js'
import { renderPeriodoHtml } from './relatorios/render-periodo.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const DATA = path.join(PUBLIC, 'data')
const SNAP = path.join(PUBLIC, 'reports', 'snapshots')
const N = 5
const digits = s => String(s || '').replace(/\D/g, '')
const readCsv = f => (fs.existsSync(f) ? (() => { try { return parseCSV(fs.readFileSync(f, 'utf8')) } catch { return [] } })() : [])
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }

// ── Fontes ──────────────────────────────────────────────────────────────────
function loadAll() {
  const dia = { '12431': readCsv(path.join(DATA, 'Fluxo_Diario_12431.csv')), trad: readCsv(path.join(DATA, 'Fluxo_Diario_Trad.csv')) }
  const perf = { '12431': readCsv(path.join(DATA, 'Perf_Diario_12431.csv')), trad: readCsv(path.join(DATA, 'Perf_Diario_Trad.csv')) }
  // nome do fundo por CNPJ (Fundos_12431/CDI em tools/)
  const nomePorCnpj = new Map()
  for (const f of ['Fundos_12431.csv', 'Fundos_CDI.csv']) {
    for (const r of readCsv(path.join(__dirname, f))) {
      const c = digits(r['CNPJ_FUNDO_CLASSE']); if (c && !nomePorCnpj.has(c)) nomePorCnpj.set(c, apelidoFundo(r['DENOM_SOCIAL'] || '') || c)
    }
  }
  // IDA
  const idaByCode = new Map(), spreadByPar = new Map()
  for (const r of readCsv(path.join(DATA, 'Ida_Historico.csv'))) {
    const cod = r.Codigo, d = r.Data, num = parseNum(r.NumeroIndice)
    if (!cod || !d) continue
    if (!idaByCode.has(cod)) idaByCode.set(cod, [])
    idaByCode.get(cod).push({ data: d, numero: num })
  }
  for (const r of readCsv(path.join(DATA, 'Ida_Spread_Historico.csv'))) {
    const par = r.Par, d = r.Data
    if (!par || !d) continue
    // SpreadNivelBps so' e' confiavel p/ CDI; IPCA/IPCAINFRA vem vazio (nivel nao
    // calculado) -> null, para o IDA nao reportar "0 bps" falso.
    const raw = r.SpreadNivelBps
    const s = (raw === '' || raw == null) ? null : parseNum(raw)
    if (!spreadByPar.has(par)) spreadByPar.set(par, [])
    spreadByPar.get(par).push({ data: d, spreadBps: s })
  }
  for (const m of [idaByCode, spreadByPar]) for (const arr of m.values()) arr.sort((a, b) => a.data.localeCompare(b.data))
  // debentures (novas por registro CVM) + emissores (grupo)
  const emissores = new Map()
  for (const r of readCsv(path.join(PUBLIC, 'Emissores.csv'))) {
    const c = digits(r['CNPJ Emissor'] || r['CNPJ']); if (c) emissores.set(c, { grupo: (r['Grupo'] || '').trim(), empresa: (r['Emissor'] || r['Empresa'] || '').trim() })
  }
  const debentures = readCsv(path.join(PUBLIC, 'Debentures.csv'))
  return { dia, perf, nomePorCnpj, idaByCode, spreadByPar, emissores, debentures }
}

// datas distintas de uma serie diaria (col 'Dia'), asc.
const distinctDias = rows => [...new Set(rows.map(r => String(r.Dia || '')).filter(Boolean))].sort()
// snapshots de uma fonte (datas asc).
const snapDates = fonte => (fs.existsSync(path.join(SNAP, fonte)) ? fs.readdirSync(path.join(SNAP, fonte)).filter(f => f.endsWith('.csv')).map(f => f.slice(0, -4)).sort() : [])
const readSnap = (fonte, d) => { const p = path.join(SNAP, fonte, `${d}.csv`); return fs.existsSync(p) ? readCsv(p) : null }
const lastLE = (arr, alvo) => { let h = null; for (const d of arr) { if (d <= alvo) h = d; else break } return h }
const lastLT = (arr, alvo) => { let h = null; for (const d of arr) { if (d < alvo) h = d; else break } return h }

// ── ANBIMA cumulativo (spread ponta-a-ponta dos snapshots de fronteira) ──────
function spreadDoRow(r) {
  const tipo = (r.tipoTaxaAnbima || '').trim()
  if (/IPCA|NTNB|NTN-B/i.test(tipo)) { const v = parseNum(r.spreadNtnbBps); return isFinite(v) && v !== 0 ? v : null }
  const v = parseNum(r.spreadCdiEquivalente); return isFinite(v) && v !== 0 ? v : null
}
const familia = tipo => /IPCA|NTNB|NTN-B/i.test(tipo || '') ? '12431' : 'trad'
function buildAnbimaPeriodo(snapAntes, snapFim, tickerInfo) {
  if (!snapAntes || !snapFim) return { semAnterior: true, porMercado: null, totalComparados: 0 }
  const idx = rows => { const m = new Map(); for (const r of rows) { const t = (r.ticker || '').trim().toUpperCase(); if (t) m.set(t, r) } return m }
  const A = idx(snapAntes), B = idx(snapFim)
  const movs = { '12431': [], trad: [] }
  for (const [t, rb] of B) {
    const ra = A.get(t); if (!ra) continue
    const sa = spreadDoRow(ra), sb = spreadDoRow(rb)
    if (sa == null || sb == null) continue
    const seg = familia(rb.tipoTaxaAnbima)
    const info = tickerInfo.get(t) || {}
    const dur = parseNum(rb.durationAnbimaAnos)
    movs[seg].push({
      ticker: t, emissor: info.empresa || '', grupo: info.grupo || '',
      indexadorFamilia: seg === '12431' ? 'IPCA/NTN-B' : 'CDI',
      spreadAnteriorBps: Math.round(sa), spreadAtualBps: Math.round(sb), variacaoBps: Math.round(sb - sa),
      spreadAtual: `${Math.round(sb)} bps`, durationAnos: isFinite(dur) && dur > 0 ? dur : null,
    })
  }
  const stats = arr => {
    const ab = arr.filter(m => m.variacaoBps > 0).sort((a, b) => b.variacaoBps - a.variacaoBps)
    const fe = arr.filter(m => m.variacaoBps < 0).sort((a, b) => a.variacaoBps - b.variacaoBps)
    const vals = arr.map(m => m.variacaoBps).sort((a, b) => a - b)
    const mediana = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null
    const media = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
    return { aberturas: ab.slice(0, 5), fechamentos: fe.slice(0, 5), totalAberturas: ab.length, totalFechamentos: fe.length, totalComparados: arr.length, variacaoMediaBps: media, variacaoMedianaBps: mediana == null ? null : Math.round(mediana) }
  }
  const porMercado = { '12431': stats(movs['12431']), trad: stats(movs.trad) }
  return { semAnterior: false, porMercado, totalComparados: movs['12431'].length + movs.trad.length }
}

// diff de universo (fundos/blc) entre dois snapshots por chave.
function diffUniverso(snapAntes, snapFim, keyCol, mapRow) {
  if (!snapAntes || !snapFim) return { semAnterior: true, novos: [], removidos: [] }
  const d = diffKeyed(snapAntes, snapFim, r => digits(r[keyCol]) || (r[keyCol] || '').trim())
  return { semAnterior: false, novos: d.added.map(mapRow), removidos: d.removed.map(mapRow) }
}

// ── Monta um relatorio de periodo ────────────────────────────────────────────
function buildPeriodo(tipo, id, src, tickerInfo) {
  const range = tipo === 'weekly' ? weekRange(id) : monthRange(id)
  const label = tipo === 'weekly' ? weekLabel(id) : monthLabel(id)
  const idAnterior = tipo === 'weekly' ? isoWeekId(new Date(new Date(range.start).getTime() - 3 * 864e5)) : prevMonthId(id)
  const rangeAnt = tipo === 'weekly' ? weekRange(idAnterior) : monthRange(idAnterior)

  // §3 Captacao + §4 Gestores por segmento
  const captacao = {}, gestores = {}
  const capDatas = []
  for (const seg of ['12431', 'trad']) {
    const rows = src.dia[seg]
    const c = aggCaptacaoPeriodo(rows, range)
    const cAnt = aggCaptacaoPeriodo(rows, rangeAnt)
    captacao[seg] = { ...c, numFundos: c.numFundos, anterior: cAnt.diasUteis ? { liquido: cAnt.liquido, captacao: cAnt.captacao, resgate: cAnt.resgate, de: cAnt.de, ate: cAnt.ate } : null }
    if (c.ate) capDatas.push(c.ate)
    const g = aggGestoresPeriodo(rows, range)
    const S = seg === '12431' ? '12431' : 'Trad'
    gestores[`top${S}Captacao`] = topMovers(g, x => x.liquido, 5, 'desc').filter(x => x.liquido > 0)
    gestores[`top${S}Resgate`] = topMovers(g, x => x.liquido, 5, 'asc').filter(x => x.liquido < 0)
  }

  // §8 Performance por segmento (composto)
  const perf = {}
  const perfCob = {}
  const perfDataFim = {}   // ultima data COM DADO de perf no periodo (nao a fronteira nominal)
  for (const seg of ['12431', 'trad']) {
    const p = aggPerfPeriodo(src.perf[seg], range, { nomePorCnpj: src.nomePorCnpj })
    const S = seg === '12431' ? '12431' : 'Trad'
    perf[`top${S}Pos`] = p.fundos.filter(f => f.retorno > 0).slice(0, 5).map(f => ({ ...f, segmento: seg }))
    perf[`top${S}Neg`] = [...p.fundos].filter(f => f.retorno < 0).sort((a, b) => a.retorno - b.retorno).slice(0, 5).map(f => ({ ...f, segmento: seg }))
    perfCob[seg] = { diasUteis: p.diasUteis, excluidos: p.excluidos, avaliados: p.fundos.length, minCobertura: p.minCobertura }
    perfDataFim[seg] = diasNoIntervalo(src.perf[seg], range).pop() || null
  }

  // §2 Novas debentures registradas no periodo (dedup ticker)
  const vistos = new Set(); const novasDeb = []
  for (const r of src.debentures) {
    const dr = (r['Data de Registro CVM da Emissao'] || '').trim()
    const key = /^\d{4}-\d{2}-\d{2}/.test(dr) ? dr.slice(0, 10) : (dr.match(/(\d{2})\/(\d{2})\/(\d{4})/) ? `${dr.slice(6, 10)}-${dr.slice(3, 5)}-${dr.slice(0, 2)}` : '')
    if (!key || key < range.start || key > range.end) continue
    const tk = (r['Codigo do Ativo'] || '').trim().toUpperCase(); if (!tk || vistos.has(tk)) continue
    vistos.add(tk)
    const emi = src.emissores.get(digits(r['CNPJ'])) || {}
    novasDeb.push({ ticker: tk, empresa: emi.empresa || (r['Empresa'] || '').trim(), grupo: emi.grupo || '', dataRegistro: key, indexador: (r['indice'] || r['Indexador'] || '').trim(), incentivada: /^(s|sim|1|true|x)$/i.test((r['Deb. Incent. (Lei 12.431)'] || '').trim()) })
  }

  // §5 ANBIMA cumulativo (fronteira) + IDA
  const anbAntes = lastLT(snapDates('anbima'), range.start), anbFim = lastLE(snapDates('anbima'), range.end)
  const anbima = buildAnbimaPeriodo(readSnap('anbima', anbAntes), readSnap('anbima', anbFim), tickerInfo)
  anbima.dataIni = anbAntes; anbima.dataFim = anbFim
  const idaDatas = src.idaByCode.get(IDA_SEG['12431'].codigo) ? [...new Set([...src.idaByCode.values()].flat().map(x => x.data))].sort() : []
  const idaAntes = lastLT(idaDatas, range.start), idaFim = lastLE(idaDatas, range.end)
  const ida = (idaAntes && idaFim) ? aggIda(src.idaByCode, src.spreadByPar, idaAntes, idaFim) : null

  // §6 Fundos incl/excl + §7 Inclusoes de ativos (BLC) por fronteira
  const fAntes = lastLT(snapDates('fundos'), range.start), fFim = lastLE(snapDates('fundos'), range.end)
  const fundos = diffUniverso(readSnap('fundos', fAntes), readSnap('fundos', fFim), 'CNPJ_FUNDO_CLASSE', r => ({ cnpj: digits(r.CNPJ_FUNDO_CLASSE), nome: apelidoFundo(r.DENOM_SOCIAL || '') || digits(r.CNPJ_FUNDO_CLASSE) }))
  const bAntes = lastLT(snapDates('blc'), range.start), bFim = lastLE(snapDates('blc'), range.end)
  const inclBlc = diffUniverso(readSnap('blc', bAntes), readSnap('blc', bFim), 'CD_ATIVO', r => ({ ticker: (r.CD_ATIVO || '').trim() }))
  const inclusoes = { novosDebentures: novasDeb.map(d => d.ticker), novosBlc: inclBlc.novos.map(x => x.ticker), saiuBlc: inclBlc.removidos.map(x => x.ticker), semAnterior: inclBlc.semAnterior }

  // datas/cobertura + status
  const critAte = [captacao['12431'].ate, captacao.trad.ate, anbFim].filter(Boolean).sort()[0] || null
  const status = periodStatus(range, critAte)
  const labelFinal = tipo === 'weekly' ? weekLabel(id, status, critAte) : monthLabel(id, status, critAte)
  const sourceDates = {
    cap12431: captacao['12431'].ate, capTrad: captacao.trad.ate,
    anbima: anbFim, fundos: fFim, blc: bFim, ida: idaFim,
    // Data REAL do ultimo dado de perf no periodo -- NAO range.end (o domingo
    // nominal da semana, que pode estar no FUTURO num periodo em andamento).
    perf12431: perfDataFim['12431'],
    perfTrad: perfDataFim.trad,
  }

  // §9 Alertas
  const alertas = []
  if (status === 'partial') alertas.push({ tipo: 'parcial', texto: `Período em andamento — dados até ${critAte || '—'}.` })
  if (anbima.semAnterior) alertas.push({ tipo: 'anbima-sem-fronteira', texto: 'Sem snapshot ANBIMA na fronteira do período — variação por ativo indisponível; use a direção agregada (IDA).' })
  if (fundos.semAnterior) alertas.push({ tipo: 'fundos-sem-fronteira', texto: 'Sem snapshot de fundos na fronteira — inclusões/exclusões indisponíveis neste período.' })
  for (const seg of ['12431', 'trad']) if (perfCob[seg].excluidos.insuficiente + perfCob[seg].excluidos.glitch > 0) alertas.push({ tipo: 'perf-cobertura', texto: `Performance ${seg === '12431' ? '12.431' : 'Tradicional'}: ${perfCob[seg].excluidos.insuficiente} fundo(s) fora por cobertura < ${Math.round(perfCob[seg].minCobertura * 100)}% e ${perfCob[seg].excluidos.glitch} por dado inválido.` })

  // §1 Sumario
  const per = tipo === 'weekly' ? 'na semana' : 'no mês'
  const summary = []
  for (const seg of ['12431', 'trad']) {
    const c = captacao[seg]; const nome = seg === '12431' ? '12.431' : 'Tradicional'
    if (c.diasUteis) summary.push({ texto: `Captação líquida ${nome} ${per}: ${fmtSum(c.liquido)} (capt. ${fmtSum(c.captacao)} − resg. ${fmtSum(c.resgate)}, ${c.diasUteis} dia(s) útil(eis)).`, tom: c.liquido >= 0 ? 'pos' : 'neg' })
  }
  if (ida) for (const seg of ['12431', 'trad']) if (ida[seg]) { const x = ida[seg]; summary.push({ texto: `${x.indice} rendeu ${x.retornoPct >= 0 ? '+' : ''}${x.retornoPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% ${per}${x.variacaoBps != null ? `, spread ${x.variacaoBps >= 0 ? 'abriu' : 'fechou'} ${Math.abs(x.variacaoBps)} bps${x.spreadConfiavel ? '' : ' (aprox.)'}` : ''}.` }) }
  if (novasDeb.length) summary.push({ texto: `${novasDeb.length} nova(s) debênture(s) registrada(s) ${per}.` })

  return {
    periodo: tipo, id, label: labelFinal, status, de: range.start, ate: critAte || range.end,
    sourceDates,
    sections: { debentures: { novas: novasDeb }, captacao, gestores, anbima, ida, fundos, perf, inclusoes, alertas, perfCobertura: perfCob },
    summary,
  }
}
const prevMonthId = id => { const m = /^(\d{4})-(\d{2})$/.exec(id); const d = new Date(+m[1], +m[2] - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const fmtSum = v => { const a = Math.abs(v); const s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}R$ ${(a / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`; if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mi`; return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` }

function tickerInfoMap(src) {
  const m = new Map()
  for (const r of src.debentures) {
    const t = (r['Codigo do Ativo'] || '').trim().toUpperCase(); if (!t) continue
    const emi = src.emissores.get(digits(r['CNPJ'])) || {}
    m.set(t, { empresa: emi.empresa || (r['Empresa'] || '').trim(), grupo: emi.grupo || '' })
  }
  return m
}

function main() {
  const src = loadAll()
  const tickerInfo = tickerInfoMap(src)
  const capDatas = [...new Set([...distinctDias(src.dia['12431']), ...distinctDias(src.dia.trad)])].sort()
  let totalW = 0, totalM = 0
  for (const tipo of ['weekly', 'monthly']) {
    const dir = path.join(PUBLIC, 'reports', tipo === 'weekly' ? 'weekly' : 'monthly')
    ensureDir(dir)
    const ids = recentPeriods(capDatas, tipo, N)
    const index = []
    for (const id of ids) {
      const rep = buildPeriodo(tipo, id, src, tickerInfo)
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rep, null, 2))
      fs.writeFileSync(path.join(dir, `${id}.html`), renderPeriodoHtml(rep))
      index.push({ id, label: rep.label, de: rep.de, ate: rep.ate, status: rep.status, json: `/reports/${tipo}/${id}.json`, html: `/reports/${tipo}/${id}.html`, sourceDates: rep.sourceDates })
      if (tipo === 'weekly') totalW++; else totalM++
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ reports: index }, null, 2))
  }
  console.log(`=== Resumos de periodo ===`)
  console.log(`semanas: ${totalW} | meses: ${totalM}`)
  console.log(`-> public/reports/weekly/ , public/reports/monthly/`)
}

main()

// Resumo SEMANAL do Luc — estrutura v2, espelhando as 3 abas do app:
//   1. Debêntures  2. Secundário  3. Técnico
// Isolado de propósito: o Mensal continua usando buildPeriodo() em gerar-periodos.mjs,
// e o Resumo do Dia (gerar-relatorios.mjs) não é tocado.
//
// Regras-chave (auditáveis):
//  - Semana = ISO 8601 (mesma convenção de periods.js). Usa a semana DOS DADOS.
//  - Novas emissões: por Data de Registro CVM dentro da semana (NUNCA data de
//    entrada na base nem data da atualização). Dedup por OFERTA (CNPJ+Emissão);
//    somam-se as séries (a base é por-série). Volume só das debêntures CVM.
//  - Tendência de spread: snapshot ANBIMA imediatamente ANTES do início vs último
//    ATÉ o fim da semana; classificação por regra explícita (classificaTendencia).
//  - Nada de Boletim ANBIMA; nada de "volume subscrito por fundos"; sem rating
//    (não existe na base) — campos ausentes são omitidos, nunca inventados.

import { weekRange, isoWeekId } from '../../src/utils/periods.js'
import { aggCaptacaoPeriodo, aggGestoresPeriodo } from '../../src/utils/aggregacao.js'
import { aggIda, IDA_SEG } from '../../src/utils/ida.js'
import { parseNum, fmtRecompraTaxa } from '../../src/utils/format.js'

const TRADE_DESTAQUE = 20e6   // R$ 20 milhões (negócio asset-dia)
const digits = s => String(s || '').replace(/\D/g, '')
const isYes = s => /^(s|sim|1|true|x)$/i.test(String(s || '').trim())
// data CVM/base -> ISO yyyy-MM-dd (aceita ISO ou dd/MM/yyyy)
const isoOf = s => {
  const t = String(s || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
const isoWeekOf = d => (d ? isoWeekId(new Date(d + 'T12:00:00')) : '')
const arrDe = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const round = (v, c = 0) => { const p = 10 ** c; return Math.round(v * p) / p }
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const quantile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo) }
const trimMean = (a, t = 0.1) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length * t); const c = s.slice(k, s.length - k); return c.length ? c.reduce((x, y) => x + y, 0) / c.length : null }
const sum = a => a.reduce((x, y) => x + y, 0)
const pctDelta = (atual, base) => (base && isFinite(base) && base !== 0) ? (atual - base) / Math.abs(base) : null

// ─────────────────────────────────────────────────────────────────────────────
// Classificação de tendência do spread (regra explícita, provisória v1).
// Calibrada no estudo de 2026-W28..W31 (ver METODOLOGIA_Resumo_Semanal.md):
// mediana semanal do move ∈ [-1,+2] bps em semanas calmas; |move| ≤ 2bps em ~49%
// dos ativos. Baseia-se na MEDIANA (m, bps) + amplitude de mercado b = %abriu-%fechou.
// Convenção: spread ABRE (m>0) = ruim p/ quem carrega; FECHA (m<0) = bom.
export const TENDENCIA = {
  N_MIN: 15,          // abaixo disto -> "dados insuficientes"
  N_PEQUENA: 40,      // 15..40 -> classifica, mas marca "amostra pequena"
  ABERTURA: 4, LEVE: 2, MICRO: 1,   // limiares de mediana (bps)
  B_FORTE: 40, B_LEVE: 15,          // amplitude (pontos percentuais)
  MISTO_LADO: 30,                   // % em cada lado p/ "movimento misto"
}
export function classificaTendencia({ n, medianaBps, pctAbriu, pctFechou, semFronteira }) {
  if (semFronteira) return { classe: 'dados insuficientes', motivo: 'sem snapshot ANBIMA na fronteira da semana', amostraPequena: false }
  if (!n || n < TENDENCIA.N_MIN) return { classe: 'dados insuficientes', motivo: `amostra comparável muito pequena (n=${n || 0} < ${TENDENCIA.N_MIN})`, amostraPequena: true }
  const m = medianaBps, b = (pctAbriu - pctFechou)
  const T = TENDENCIA
  let classe
  if (m >= T.ABERTURA || (m >= T.LEVE && b >= T.B_FORTE)) classe = 'abertura'
  else if (m <= -T.ABERTURA || (m <= -T.LEVE && b <= -T.B_FORTE)) classe = 'fechamento'
  else if (m >= T.LEVE || (m >= T.MICRO && b >= T.B_LEVE)) classe = 'leve abertura'
  else if (m <= -T.LEVE || (m <= -T.MICRO && b <= -T.B_LEVE)) classe = 'leve fechamento'
  else if (Math.abs(m) <= T.MICRO && pctAbriu >= T.MISTO_LADO && pctFechou >= T.MISTO_LADO) classe = 'movimento misto'
  else classe = 'estabilidade'
  return { classe, motivo: null, amostraPequena: n < TENDENCIA.N_PEQUENA }
}

// spread ANBIMA de um snapshot-row (IPCA -> bps s/ NTN-B; CDI -> equiv.), ignora 0.
function spreadSnap(r) {
  const tipo = (r.tipoTaxaAnbima || '').trim()
  if (/IPCA|NTNB|NTN-B/i.test(tipo)) { const v = parseNum(r.spreadNtnbBps); return isFinite(v) && v !== 0 ? v : null }
  const v = parseNum(r.spreadCdiEquivalente); return isFinite(v) && v !== 0 ? v : null
}
const refSnap = r => (r.codigoNtnbExibicao || r.ntnbReferencia || 'CDI').trim()

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 1 — DEBÊNTURES (novas emissões pela data de Registro CVM na semana)
// ═══════════════════════════════════════════════════════════════════════════
function volSerie(r) {
  const q = parseNum(r['Quantidade Emitida']) || parseNum(r['Quantidade em Mercado'])
  const vn = parseNum(r['Valor Nominal na Emissao']) || parseNum(r['Valor Nominal Atual'])
  return (isFinite(q) && isFinite(vn) && q > 0 && vn > 0) ? q * vn : null
}
function buildDebentures(range, src) {
  const emissores = src.emissores, be = src.anbimaBE, tx = src.anbimaTx
  // 1) linhas de debênture com Registro CVM dentro da semana
  const linhas = []
  for (const r of src.debentures) {
    const dr = isoOf(r['Data de Registro CVM da Emissao'])
    if (!dr || dr < range.start || dr > range.end) continue
    linhas.push(r)
  }
  // 2) agrupa por OFERTA (CNPJ + Emissão); séries = tickers
  const ofertasMap = new Map()
  for (const r of linhas) {
    const cnpj = digits(r['CNPJ'])
    const chave = `${cnpj}|${(r['Emissao'] || '').trim()}`
    let o = ofertasMap.get(chave)
    if (!o) { o = { chave, cnpj, emissao: (r['Emissao'] || '').trim(), series: [] }; ofertasMap.set(chave, o) }
    o.series.push(r)
  }
  const inconsistencias = []
  const ofertas = []
  for (const o of ofertasMap.values()) {
    const r0 = o.series[0]
    const emi = emissores.get(o.cnpj) || {}
    // volume da oferta = soma das séries (base é por-série -> sem dupla contagem)
    let volTotal = 0, semVol = 0
    const seriesDet = o.series.map(r => {
      const v = volSerie(r)
      if (v == null) semVol++; else volTotal += v
      const tk = (r['Codigo do Ativo'] || '').trim().toUpperCase()
      const rc = be?.get(tk)
      const anb = tx?.get(tk)
      const campo = (k, val) => { const s = (val ?? '').toString().trim(); return s && s !== '—' ? s : null }
      const det = {
        ticker: tk, serie: (r['Serie'] || '').trim(),
        volumeSerie: v,
        indexador: campo('i', r['indice'] || r['Indexador']),
        taxaEmissao: campo('t', r['Juros Criterio Novo - Taxa']),
        vencimento: isoOf(r['Data de Vencimento']) || null,
        garantia: campo('g', r['Garantia/Especie']) || campo('f', r['Forma']),
        amortizacao: campo('a', r['Tipo de Amortizacao']) || campo('a2', r['Amortizacao - Criterio']),
        incentivada: isYes(r['Deb. Incent. (Lei 12.431)']),
        durationAnos: anb && parseNum(anb.durationAnbimaAnos) > 0 ? round(parseNum(anb.durationAnbimaAnos), 2) : null,
        resgateAntecipado: campo('r', r['Resgate Antecipado']),
        recompra: rc ? { status: rc.statusExercicio || null, data: rc.dataEvento || null, breakeven: rc.taxaEvento != null && rc.taxaEvento !== '' ? fmtRecompraTaxa(parseNum(rc.taxaEvento), rc.remuneracao) : null, pctPuPar: rc.pctPuPar ? round(parseNum(rc.pctPuPar) * 100, 2) : null } : null,
      }
      // remove campos vazios (omitir, nunca inventar)
      for (const k of Object.keys(det)) if (det[k] == null || det[k] === '') delete det[k]
      return det
    })
    if (semVol > 0) inconsistencias.push({ oferta: o.chave, emissor: emi.empresa || (r0['Empresa'] || '').trim(), motivo: `${semVol} série(s) sem quantidade/valor nominal — volume da oferta pode estar incompleto`, seriesSemVolume: o.series.filter(r => volSerie(r) == null).map(r => (r['Codigo do Ativo'] || '').trim()) })
    // sindicato completo (SRE) por número de registro; líder já vem marcado.
    const registro = (r0['Registro CVM da Emissao'] || '').trim()
    const coordInfo = (src.coordenadores || {})[registro] || null
    ofertas.push({
      chave: o.chave, cnpj: o.cnpj, emissao: o.emissao, registro,
      emissor: emi.empresa || (r0['Empresa'] || '').trim(),
      grupo: emi.grupo || '',
      setor: emi.setor || '',
      coordenador: (r0['Coordenador Lider'] || '').trim(),   // líder do cadastro (fallback)
      coordenadores: coordInfo?.coordenadores?.length ? coordInfo.coordenadores : null,   // sindicato SRE
      // Remuneração MÁXIMA (teto do bookbuilding) — muito relevante no 12.431.
      // teto.compacto ex.: "B35 −20bps"; teto.floorPct ex.: "7,80%". Texto integral
      // preservado p/ auditoria. Fonte: SRE acaoObjeto.
      teto: coordInfo?.teto || null,
      remuneracaoMaxima: coordInfo?.remuneracaoMaxima || null,
      rating: (coordInfo?.rating && !/^n[.\/ ]?a\b/i.test(coordInfo.rating.trim())) ? coordInfo.rating.trim() : null,
      dataRegistro: isoOf(r0['Data de Registro CVM da Emissao']),
      incentivada: isYes(r0['Deb. Incent. (Lei 12.431)']),
      volumeOferta: volTotal > 0 ? volTotal : null,
      volumeParcial: semVol > 0,
      nSeries: o.series.length,
      tickers: seriesDet.map(s => s.ticker),
      series: seriesDet,
    })
  }
  ofertas.sort((a, b) => (b.volumeOferta || 0) - (a.volumeOferta || 0))
  // 3) cabeçalho / totais
  const totalVol = sum(ofertas.filter(o => o.volumeOferta).map(o => o.volumeOferta))
  const vol12431 = sum(ofertas.filter(o => o.incentivada && o.volumeOferta).map(o => o.volumeOferta))
  const volTrad = totalVol - vol12431
  const emissoresSet = new Set(ofertas.map(o => o.cnpj).filter(Boolean))
  const gruposSet = new Set(ofertas.map(o => o.grupo).filter(Boolean))
  const nSeriesTotal = sum(ofertas.map(o => o.nSeries))
  const porGrupo = agrupaVolume(ofertas, o => o.grupo || o.emissor)
  const resumo = {
    nOfertas: ofertas.length, nSeries: nSeriesTotal,
    nEmissores: emissoresSet.size, nGrupos: gruposSet.size,
    volumeTotal: totalVol || 0, volume12431: vol12431 || 0, volumeTradicional: volTrad || 0,
    maioresPorGrupo: porGrupo.slice(0, 5),
    volumeConfiavel: inconsistencias.length === 0,
  }
  const sintese = []
  if (!ofertas.length) sintese.push('Nenhuma nova debênture registrada na CVM na semana.')
  else {
    sintese.push(`${ofertas.length} oferta(s) nova(s) (${nSeriesTotal} série(s)) de ${emissoresSet.size} emissor(es), somando ${fmtBRL(totalVol)}.`)
    sintese.push(`12.431: ${fmtBRL(vol12431)} · Tradicional: ${fmtBRL(volTrad)}.`)
    if (porGrupo[0]) sintese.push(`Maior: ${porGrupo[0].nome} (${fmtBRL(porGrupo[0].volume)}).`)
    if (inconsistencias.length) sintese.push(`⚠ ${inconsistencias.length} oferta(s) com volume incompleto — total pode estar subestimado (ver inconsistências).`)
  }
  return { sintese, resumo, ofertas, inconsistencias }
}
function agrupaVolume(ofertas, chaveFn) {
  const m = new Map()
  for (const o of ofertas) { const k = chaveFn(o); if (!k || !o.volumeOferta) continue; m.set(k, (m.get(k) || 0) + o.volumeOferta) }
  return [...m.entries()].map(([nome, volume]) => ({ nome, volume })).sort((a, b) => b.volume - a.volume)
}

// formatação BRL local (mesmo padrão do resto dos relatórios)
function fmtBRL(v) {
  if (v == null || !isFinite(v)) return '—'
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e9) return `${s}R$ ${(a / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} bi`
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 2 — SECUNDÁRIO
// ═══════════════════════════════════════════════════════════════════════════
// spread ANBIMA numérico por ticker (bps p/ IPCA, % p/ CDI) — p/ comparar trades.
function anbimaSpreadMap(tx) {
  const m = new Map()
  if (!tx) return m
  for (const [t, r] of tx) {
    const ipca = /IPCA|NTNB|NTN-B/i.test(r.tipoTaxaAnbima || '')
    const v = ipca ? parseNum(r.spreadNtnbBps) : parseNum(r.taxaAnbimaOriginal)
    if (isFinite(v) && v !== 0) m.set(t, { spread: v, ipca, ref: refSnap(r) })
  }
  return m
}
// 2.1 Tendência de spread por segmento (fronteira de snapshots ANBIMA).
function buildTendencia(range, src, helpers) {
  const { snapDates, readSnap, lastLT, lastLE } = helpers
  const datas = snapDates('anbima')
  const antes = lastLT(datas, range.start), fim = lastLE(datas, range.end)
  const semFronteira = !antes || !fim || antes === fim
  const idx = rows => { const m = new Map(); for (const r of (rows || [])) { const t = (r.ticker || '').trim().toUpperCase(); if (t) m.set(t, r) } return m }
  const A = semFronteira ? new Map() : idx(readSnap('anbima', antes))
  const B = semFronteira ? new Map() : idx(readSnap('anbima', fim))
  const seg = { '12431': [], trad: [] }
  for (const [t, rb] of B) {
    const ra = A.get(t); if (!ra) continue
    if (/IPCA|NTNB|NTN-B/i.test(rb.tipoTaxaAnbima || '') && refSnap(ra) !== refSnap(rb)) continue
    const sa = spreadSnap(ra), sb = spreadSnap(rb); if (sa == null || sb == null) continue
    const info = src.tickerInfo.get(t) || {}
    const mv = round(sb - sa)
    seg[src.flag12431.get(t) ? '12431' : 'trad'].push({ ticker: t, emissor: info.empresa || '', grupo: info.grupo || '', variacaoBps: mv, spreadAnteriorBps: round(sa), spreadAtualBps: round(sb) })
  }
  const out = {}
  for (const s of ['12431', 'trad']) {
    const arr = seg[s], moves = arr.map(x => x.variacaoBps)
    const ab = arr.filter(x => x.variacaoBps > 0), fe = arr.filter(x => x.variacaoBps < 0), es = arr.filter(x => x.variacaoBps === 0)
    const n = arr.length
    const pAb = n ? 100 * ab.length / n : 0, pFe = n ? 100 * fe.length / n : 0
    const cls = classificaTendencia({ n, medianaBps: median(moves) ?? 0, pctAbriu: pAb, pctFechou: pFe, semFronteira })
    out[s] = {
      classificacao: cls.classe, motivoInsuf: cls.motivo, amostraPequena: cls.amostraPequena,
      n, medianaBps: median(moves), mediaAparadaBps: trimMean(moves) == null ? null : round(trimMean(moves), 1),
      abriu: ab.length, fechou: fe.length, estavel: es.length,
      pctAbriu: round(pAb), pctFechou: round(pFe), pctEstavel: n ? round(100 * es.length / n) : 0,
      p25Bps: quantile(moves, .25), p75Bps: quantile(moves, .75),
      maioresAberturas: [...ab].sort((a, b) => b.variacaoBps - a.variacaoBps).slice(0, 5),
      maioresFechamentos: [...fe].sort((a, b) => a.variacaoBps - b.variacaoBps).slice(0, 5),
    }
  }
  return { semFronteira, dataIni: antes || null, dataFim: fim || null, porSegmento: out }
}
// linhas de mercado (asset-dia) da semana, enriquecidas.
function mercadoDaSemana(range, src) {
  const anb = src.anbimaNum
  const rows = []
  for (const r of (src.mercado || [])) {
    const d = isoOf(r.Data); if (!d || d < range.start || d > range.end) continue
    const t = (r.Ativo || '').trim().toUpperCase()
    const info = src.tickerInfo.get(t) || {}
    const inc = !!src.flag12431.get(t)
    const vol = parseNum(r.VolMercado) || 0
    const spread = parseNum(r.Spread)
    const a = anb.get(t)
    let vsAnbima = null
    if (a && isFinite(spread)) { const ipcaFam = /IPCA/i.test(r.Indexador || ''); if (a.ipca === ipcaFam) vsAnbima = round(spread - a.spread, ipcaFam ? 0 : 2) }
    rows.push({ ticker: t, data: d, emissor: info.empresa || '', grupo: info.grupo || info.empresa || '', incentivada: inc, seg: inc ? '12431' : 'trad', volume: vol, taxaMed: r.Taxa_mid || '', spreadFmt: r.SpreadFmt || '', spreadNum: isFinite(spread) ? spread : null, refSpread: r.RefSpread || '', vsAnbima })
  }
  return rows
}
function resumoMercado(rows) {
  const vol = sum(rows.map(r => r.volume))
  const v12 = sum(rows.filter(r => r.seg === '12431').map(r => r.volume))
  return { volume: vol, nTrades: rows.length, volume12431: v12, volumeTradicional: vol - v12 }
}
function buildSecundario(range, src, helpers, semanasAnt) {
  const tendencia = buildTendencia(range, src, helpers)
  // acima/abaixo da taxa ANBIMA (trades comparáveis)
  const rows = mercadoDaSemana(range, src)
  for (const s of ['12431', 'trad']) {
    const comp = rows.filter(r => r.seg === s && r.vsAnbima != null)
    const acima = comp.filter(r => r.vsAnbima > 0).length, abaixo = comp.filter(r => r.vsAnbima < 0).length
    if (tendencia.porSegmento[s]) tendencia.porSegmento[s].vsAnbima = { comparaveis: comp.length, acima, abaixo, igual: comp.length - acima - abaixo }
  }
  // IDA (confirma/diverge)
  const idaDatas = [...new Set([...(src.idaByCode?.values() || [])].flat().map(x => x.data))].sort()
  const idaAntes = helpers.lastLT(idaDatas, range.start), idaFim = helpers.lastLE(idaDatas, range.end)
  const ida = (idaAntes && idaFim && src.idaByCode) ? aggIda(src.idaByCode, src.spreadByPar, idaAntes, idaFim) : null
  // 2.2 trades em destaque (asset-dia ≥ 20 MM) agrupados por grupo econômico
  const destaque = rows.filter(r => r.volume >= TRADE_DESTAQUE)
  const grpMap = new Map()
  for (const r of destaque) {
    const k = r.grupo || r.emissor || r.ticker
    let g = grpMap.get(k); if (!g) { g = { grupo: k, emissores: new Set(), ativos: new Set(), volumeTotal: 0, nTrades: 0, maiorTrade: null, datas: new Set(), seg: new Set(), trades: [] }; grpMap.set(k, g) }
    g.emissores.add(r.emissor); g.ativos.add(r.ticker); g.volumeTotal += r.volume; g.nTrades++; g.datas.add(r.data); g.seg.add(r.seg)
    if (!g.maiorTrade || r.volume > g.maiorTrade.volume) g.maiorTrade = r
    g.trades.push(r)
  }
  const grupos = [...grpMap.values()].map(g => ({
    grupo: g.grupo, emissores: [...g.emissores].filter(Boolean), ativos: [...g.ativos],
    volumeTotal: g.volumeTotal, nTrades: g.nTrades, datas: [...g.datas].sort(),
    enquadramento: g.seg.size > 1 ? 'misto' : (g.seg.has('12431') ? '12.431' : 'Tradicional'),
    maiorTrade: g.maiorTrade ? { ticker: g.maiorTrade.ticker, data: g.maiorTrade.data, volume: g.maiorTrade.volume, taxaMed: g.maiorTrade.taxaMed, spreadFmt: g.maiorTrade.spreadFmt, vsAnbima: g.maiorTrade.vsAnbima } : null,
    trades: g.trades.sort((a, b) => b.volume - a.volume).map(t => ({ ticker: t.ticker, data: t.data, volume: t.volume, taxaMed: t.taxaMed, spreadFmt: t.spreadFmt, vsAnbima: t.vsAnbima })),
  })).sort((a, b) => b.volumeTotal - a.volumeTotal)
  // resumo semanal + comparações (semana anterior e média de 4 semanas)
  const atual = resumoMercado(rows)
  const rAnt = semanasAnt.length ? resumoMercado(mercadoDaSemana(semanasAnt[0].range, src)) : null
  const vol4 = semanasAnt.slice(0, 4).map(w => resumoMercado(mercadoDaSemana(w.range, src)).volume)
  const media4 = vol4.length ? sum(vol4) / vol4.length : null
  const porGrupoVol = agrupaVolumeMercado(rows, r => r.grupo || r.emissor)
  const porAtivoVol = agrupaVolumeMercado(rows, r => r.ticker)
  const resumo = {
    ...atual,
    anterior: rAnt ? { volume: rAnt.volume, nTrades: rAnt.nTrades } : null,
    variacaoVolNominal: rAnt ? atual.volume - rAnt.volume : null,
    variacaoVolPct: rAnt ? pctDelta(atual.volume, rAnt.volume) : null,
    media4Semanas: media4, variacaoVs4Pct: media4 ? pctDelta(atual.volume, media4) : null,
    maioresGrupos: porGrupoVol.slice(0, 5), maioresAtivos: porAtivoVol.slice(0, 5),
  }
  // síntese
  const sintese = []
  for (const [s, nome] of [['12431', '12.431'], ['trad', 'Tradicional']]) {
    const t = tendencia.porSegmento[s]
    if (!t) continue
    if (t.classificacao === 'dados insuficientes') sintese.push(`Tendência ${nome}: dados insuficientes (${t.motivoInsuf}).`)
    else sintese.push(`Spread ${nome}: ${t.classificacao} (mediana ${fmtBps(t.medianaBps)}, ${t.abriu} abriram / ${t.fechou} fecharam de ${t.n}${t.amostraPequena ? ' — amostra pequena' : ''}).`)
  }
  sintese.push(`Secundário: ${fmtBRL(atual.volume)} em ${atual.nTrades} negócio(s) (12.431 ${fmtBRL(atual.volume12431)} · Trad ${fmtBRL(atual.volumeTradicional)}).`)
  if (destaque.length) sintese.push(`${destaque.length} negócio(s) ≥ R$ 20 mi em ${grupos.length} grupo(s).`)
  return { sintese, tendencia, ida: ida ? { '12431': ida['12431'] || null, trad: ida.trad || null } : null, trades: { limiar: TRADE_DESTAQUE, resumo, grupos } }
}
const fmtBps = v => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(round(v, 1))} bps`
function agrupaVolumeMercado(rows, chaveFn) {
  const m = new Map()
  for (const r of rows) { const k = chaveFn(r); if (!k) continue; m.set(k, (m.get(k) || 0) + r.volume) }
  return [...m.entries()].map(([nome, volume]) => ({ nome, volume })).sort((a, b) => b.volume - a.volume)
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 3 — TÉCNICO (indicadores da semana; 12.431 x tradicional)
// ═══════════════════════════════════════════════════════════════════════════
// volume emitido CVM por ISO-week (a partir das ofertas), split 12.431/trad.
function volumeEmitidoPorSemana(src) {
  const m = new Map()   // wid -> { '12431':v, trad:v }
  const offers = new Map()
  for (const r of src.debentures) {
    const d = isoOf(r['Data de Registro CVM da Emissao']); if (!d) continue
    const chave = `${digits(r['CNPJ'])}|${(r['Emissao'] || '').trim()}`
    const v = volSerie(r) || 0
    const inc = isYes(r['Deb. Incent. (Lei 12.431)'])
    const wid = isoWeekOf(d)
    let o = offers.get(chave); if (!o) { o = { wid, inc, vol: 0 }; offers.set(chave, o) }
    o.vol += v
  }
  for (const o of offers.values()) {
    let e = m.get(o.wid); if (!e) { e = { '12431': 0, trad: 0 }; m.set(o.wid, e) }
    e[o.inc ? '12431' : 'trad'] += o.vol
  }
  return m
}
function indicador(atual, ant, media4, dias, dataFim) {
  return { valor: atual, anterior: ant, variacaoNominal: ant == null ? null : atual - ant, variacaoPct: ant == null ? null : pctDelta(atual, ant), media4Semanas: media4, diasUteis: dias, dataFonte: dataFim }
}
function buildTecnico(range, src, semanasAnt, debPart, volEmitWk, thisWid) {
  const out = {}
  const sintese = []
  for (const seg of ['12431', 'trad']) {
    const nome = seg === '12431' ? '12.431' : 'Tradicional'
    const rows = src.dia[seg]
    const c = aggCaptacaoPeriodo(rows, range)
    const cAnt = semanasAnt.length ? aggCaptacaoPeriodo(rows, semanasAnt[0].range) : { captacao: null, resgate: null, liquido: null }
    const wk4 = semanasAnt.slice(0, 4).map(w => aggCaptacaoPeriodo(rows, w.range))
    const avg = key => { const xs = wk4.filter(x => x.diasUteis).map(x => x[key]); return xs.length ? sum(xs) / xs.length : null }
    // volume emitido CVM
    const volAtual = (volEmitWk.get(thisWid) || {})[seg] || 0
    const volAnt = semanasAnt.length ? ((volEmitWk.get(semanasAnt[0].wid) || {})[seg] || 0) : null
    const vol4 = semanasAnt.slice(0, 4).map(w => (volEmitWk.get(w.wid) || {})[seg] || 0)
    const volMedia4 = vol4.length ? sum(vol4) / vol4.length : null
    // destaques por gestora (captação/resgate/líquida)
    const g = aggGestoresPeriodo(rows, range)
    const gAnt = semanasAnt.length ? aggGestoresPeriodo(rows, semanasAnt[0].range) : []
    const antLiqPorGestor = new Map(gAnt.map(x => [x.gestor, x.liquido]))
    const mudancas = g.map(x => ({ gestor: x.gestor, deltaLiquido: x.liquido - (antLiqPorGestor.get(x.gestor) ?? 0), liquido: x.liquido }))
      .sort((a, b) => Math.abs(b.deltaLiquido) - Math.abs(a.deltaLiquido)).slice(0, 5)
    out[seg] = {
      captacaoBruta: indicador(c.captacao, cAnt.captacao, avg('captacao'), c.diasUteis, c.ate),
      resgates: indicador(c.resgate, cAnt.resgate, avg('resgate'), c.diasUteis, c.ate),
      captacaoLiquida: indicador(c.liquido, cAnt.liquido, avg('liquido'), c.diasUteis, c.ate),
      volumeEmitidoCVM: indicador(volAtual, volAnt, volMedia4, null, range.end),
      destaques: {
        maioresCaptacoes: [...g].sort((a, b) => b.captacao - a.captacao).slice(0, 5).map(x => ({ gestor: x.gestor, valor: x.captacao })),
        maioresResgates: [...g].sort((a, b) => b.resgate - a.resgate).slice(0, 5).map(x => ({ gestor: x.gestor, valor: x.resgate })),
        maioresLiquidas: [...g].sort((a, b) => b.liquido - a.liquido).slice(0, 5).map(x => ({ gestor: x.gestor, valor: x.liquido })),
        pioresLiquidas: [...g].sort((a, b) => a.liquido - b.liquido).slice(0, 5).map(x => ({ gestor: x.gestor, valor: x.liquido })),
        maioresMudancas: mudancas,
      },
    }
    if (c.diasUteis) sintese.push(`${nome}: captação líquida ${fmtBRL(c.liquido)} (${c.diasUteis} d.u.), emissão CVM ${fmtBRL(volAtual)}.`)
  }
  // destaques de volume emitido por emissor/grupo (da própria semana) — nunca por gestora
  out.volumeEmitidoDestaques = {
    porGrupo: debPart.resumo.maioresPorGrupo,
    porEmissor: agrupaVolume(debPart.ofertas, o => o.emissor).slice(0, 5),
    volume12431: debPart.resumo.volume12431, volumeTradicional: debPart.resumo.volumeTradicional,
  }
  return { sintese, ...out }
}

// ═══════════════════════════════════════════════════════════════════════════
// buildSemanal — amarra as 3 partes
// ═══════════════════════════════════════════════════════════════════════════
function semanasAnteriores(id, n) {
  const out = []
  let cur = id
  for (let i = 0; i < n; i++) {
    const r = weekRange(cur)
    const prev = isoWeekId(new Date(new Date(r.start).getTime() - 3 * 864e5))
    out.push({ wid: prev, range: weekRange(prev) })
    cur = prev
  }
  return out
}
export function buildSemanal(id, src, helpers) {
  const range = weekRange(id)
  const semAnt = semanasAnteriores(id, 4)
  const volEmitWk = volumeEmitidoPorSemana(src)
  const debentures = buildDebentures(range, src)
  const secundario = buildSecundario(range, src, helpers, semAnt)
  const tecnico = buildTecnico(range, src, semAnt, debentures, volEmitWk, id)

  // status/cobertura (parcial se a fronteira crítica não fechou a sexta)
  const critAte = [tecnico['12431']?.captacaoBruta?.dataFonte, tecnico.trad?.captacaoBruta?.dataFonte, secundario.tendencia.dataFim].filter(Boolean).sort()[0] || null
  const { periodStatus, weekLabel } = helpers
  const status = periodStatus(range, critAte)
  const label = weekLabel(id, status, critAte)
  const mercadoMax = maxData(src.mercado, 'Data')
  const sourceDates = {
    fluxo12431: tecnico['12431']?.captacaoBruta?.dataFonte || null,
    fluxoTrad: tecnico.trad?.captacaoBruta?.dataFonte || null,
    anbima: secundario.tendencia.dataFim,
    mercado: mercadoMax,
    // capa datas de registro FUTURAS (a base tem pré-registros p/ datas à frente):
    // a "data da fonte" é a emissão mais recente já ocorrida (≤ mercado).
    debentures: maxData(src.debentures, 'Data de Registro CVM da Emissao', mercadoMax),
  }
  const alertas = []
  if (status === 'partial') alertas.push({ tipo: 'parcial', texto: `Semana em andamento — dados até ${critAte || '—'}.` })
  if (secundario.tendencia.semFronteira) alertas.push({ tipo: 'anbima-sem-fronteira', texto: 'Sem snapshot ANBIMA na fronteira da semana — tendência por ativo indisponível.' })
  if (debentures.inconsistencias.length) alertas.push({ tipo: 'emissao-volume', texto: `${debentures.inconsistencias.length} oferta(s) com volume incompleto — total sinalizado como parcial.` })

  return {
    periodo: 'weekly', formato: 'v2', id, label, status, de: range.start, ate: critAte || range.end,
    sourceDates, alertas,
    partes: { debentures, secundario, tecnico },
  }
}
function maxData(rows, col, cap) {
  let mx = ''
  for (const r of (rows || [])) { const d = isoOf(r[col]); if (d && (!cap || d <= cap) && d > mx) mx = d }
  return mx || null
}

export { fmtBRL, isoOf, isoWeekOf, spreadSnap, refSnap, digits, isYes, median, quantile, trimMean, sum, round, pctDelta, arrDe, TRADE_DESTAQUE, anbimaSpreadMap, buildDebentures, buildTendencia, volSerie }

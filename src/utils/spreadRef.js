// Conversao da taxa negociada do secundario (REUNE) para SPREAD sobre a curva de
// referencia -- mesma metodologia da coluna "Tx Anbima", agora aplicada trade a
// trade, usando a curva de titulos publicos da DATA do proprio trade (curva por
// dia). Se faltar a curva do dia ou o TPF de vencimento proximo, devolve null
// (o front mantem a taxa crua). O rotulo segue o Tx Anbima:
//   IPCA  -> "B{AA} +/- N bps"   spread real vs NTN-B de vencimento proximo
//   DI+   -> "CDI +/- X,XX%"      a taxa negociada JA e o spread (sem curva)
//   %DI   -> "CDI +/- X,XX%"      via LTN: taxaLTN * (P/100 - 1)  (aprox. linear,
//                                 igual ao Tx Anbima)
//   Pre   -> "DI +/- X,XX%"       fixo - taxaLTN de vencimento proximo
//   outros (IGP-M...) -> null

import { parseNum } from './format.js'

const MINUS = '−' // sinal de menos tipografico (igual ao resto do app)

// Classifica o papel para escolher a formula. Prefere o tipo da ANBIMA (o mais
// confiavel), com fallback pela string de indexador do cadastro.
export function classificarIndexadorSec(indexador, tipoTaxaAnbima) {
  const t = String(tipoTaxaAnbima || '').toUpperCase()
  if (t === 'IPCA_SPREAD') return 'IPCA'
  if (t === 'DI_SPREAD') return 'DI+'
  if (t === 'DI_PERCENTUAL') return '%DI'
  if (t === 'PREFIXADO') return 'PRE'
  const s = String(indexador || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (s.includes('ipca')) return 'IPCA'
  if (s.includes('%') && (s.includes('di') || s.includes('cdi'))) return '%DI'
  // "\bpre\b" (nao casa "spread") ou "prefix"/"fixad".
  if (/\bpre\b|prefix|fixad/.test(s)) return 'PRE'
  if (s.includes('di') || s.includes('cdi')) return 'DI+'
  return 'OUTRO'
}

// Aceita ISO (yyyy-mm-dd) e BR (dd/mm/yyyy) -> ms UTC (ou null).
function parseDataMs(v) {
  if (v == null) return null
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3])
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1])
  return null
}
function anoDe(v) { const ms = parseDataMs(v); return ms == null ? null : new Date(ms).getUTCFullYear() }

// TPF (da curva) de vencimento mais proximo do papel.
function refMaisProxima(curva, vencPapel) {
  const alvo = parseDataMs(vencPapel)
  if (alvo == null || !Array.isArray(curva) || !curva.length) return null
  let best = null, bestD = Infinity
  for (const p of curva) {
    const ms = parseDataMs(p.venc); if (ms == null) continue
    const d = Math.abs(ms - alvo)
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}

const dec2 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPctRef = (rot, v) => `${rot} ${v < 0 ? MINUS : '+'}${dec2(Math.abs(v))}%`

// Curva por data: Map ou objeto { [dataISO]: { ntnb:[{venc,taxa}], ltn:[{venc,taxa}] } }.
function curvaDaData(curvasPorData, data) {
  if (!curvasPorData) return null
  return (curvasPorData instanceof Map ? curvasPorData.get(data) : curvasPorData[data]) || null
}

// trade: { taxa, indexador, tipoTaxaAnbima?, vencimento, data }.
// Retorna { tipo, formatada, spreadNum, ref } ou null.
const ehTaxaAusente = v => {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return s === '' || s === '-' || s === '--' || s === '—' || s === 'n/d' || s === 'nd'
}

export function converterSpreadSec(trade, curvasPorData) {
  if (!trade || ehTaxaAusente(trade.taxa)) return null   // '-'/'--' viram 0 no parseNum; barra antes
  const taxa = parseNum(trade.taxa)
  if (taxa == null || isNaN(taxa)) return null
  const tipo = classificarIndexadorSec(trade.indexador, trade.tipoTaxaAnbima)

  // DI+ nao precisa de curva: a taxa negociada JA e' o spread sobre o DI.
  if (tipo === 'DI+') {
    return { tipo, formatada: fmtPctRef('CDI', taxa), spreadNum: taxa, ref: 'CDI' }
  }

  const curva = curvaDaData(curvasPorData, trade.data)
  if (!curva) return null

  if (tipo === 'IPCA') {
    const r = refMaisProxima(curva.ntnb, trade.vencimento)
    if (!r) return null
    const taxaRef = parseNum(r.taxa)
    if (taxaRef == null || isNaN(taxaRef)) return null
    const bps = Math.round((taxa - taxaRef) * 100)
    const cod = 'B' + String((anoDe(r.venc) || 0) % 100).padStart(2, '0')
    return {
      tipo,
      formatada: `${cod} ${bps < 0 ? MINUS : '+'}${Math.abs(bps)} bps`,
      spreadNum: bps,
      ref: `${cod} @ ${dec2(taxaRef)}%`,
    }
  }
  if (tipo === '%DI') {
    const r = refMaisProxima(curva.ltn, trade.vencimento)
    if (!r) return null
    const taxaRef = parseNum(r.taxa)
    if (taxaRef == null || isNaN(taxaRef)) return null
    const sp = taxaRef * (taxa / 100 - 1)
    return { tipo, formatada: fmtPctRef('CDI', sp), spreadNum: sp, ref: `LTN @ ${dec2(taxaRef)}%` }
  }
  if (tipo === 'PRE') {
    const r = refMaisProxima(curva.ltn, trade.vencimento)
    if (!r) return null
    const taxaRef = parseNum(r.taxa)
    if (taxaRef == null || isNaN(taxaRef)) return null
    const sp = taxa - taxaRef
    return { tipo, formatada: fmtPctRef('DI', sp), spreadNum: sp, ref: `LTN @ ${dec2(taxaRef)}%` }
  }
  return null
}

// Funções puras do "Resumo do Dia" — compartilhadas entre o app (browser) e o
// gerador de relatórios (tools/gerar-relatorios.mjs, Node). SEM React, sem
// import.meta: só lógica de diff/ordenação/ancoragem por data.
//
// Princípio central: comparar sempre a DATA DOS DADOS contra a data anterior
// disponível daquela fonte — nunca a data do calendário/navegador.

import { parseNum } from './format.js'

/** 'AAAA-MM-DD' (ou 'DD/MM/AAAA') → { key, date(local), label 'DD/MM/AAAA' } | null */
export function parseDia(str) {
  const s = String(str || '').trim()
  if (!s) return null
  let y, m, d
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] }
  else {
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (!br) return null
    d = +br[1]; m = +br[2]; y = +br[3]
  }
  const date = new Date(y, m - 1, d)   // construtor local — não desloca por fuso
  if (isNaN(date.getTime())) return null
  const p = n => String(n).padStart(2, '0')
  return { key: `${y}-${p(m)}-${p(d)}`, date, label: `${p(d)}/${p(m)}/${y}` }
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (ou o valor original se não parsear). */
export function fmtDia(key) {
  const p = parseDia(key)
  return p ? p.label : String(key || '—')
}

/**
 * Repara "mojibake" clássico: texto UTF-8 que foi lido como latin-1 (ex.:
 * "PrÃ©-Fixado" → "Pré-Fixado"). Conservador: só age se detectar o padrão
 * (Ã/Â seguidos de byte de continuação) E o re-decode UTF-8 for válido.
 * Usado no relatório pra não propagar erro de encoding de fontes (ex.: ANBIMA).
 */
export function repairText(s) {
  const str = String(s == null ? '' : s)
  if (!/[ÃÂ][-¿]/.test(str)) return str
  try {
    const bytes = Uint8Array.from([...str], c => c.charCodeAt(0) & 0xff)
    const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return dec
  } catch {
    return str
  }
}

/**
 * Diff entre dois conjuntos de linhas indexados por uma chave.
 * Retorna { added, removed, changed } — changed só quando `changed(a,b)` é true.
 * prevRows/currRows: arrays; keyFn: linha → string; changedFn(prev,curr)→bool (opcional).
 */
export function diffKeyed(prevRows, currRows, keyFn, changedFn = null) {
  const prev = new Map()
  for (const r of prevRows || []) { const k = keyFn(r); if (k != null && k !== '') prev.set(String(k), r) }
  const curr = new Map()
  for (const r of currRows || []) { const k = keyFn(r); if (k != null && k !== '') curr.set(String(k), r) }

  const added = []
  const changed = []
  for (const [k, r] of curr) {
    if (!prev.has(k)) added.push(r)
    else if (changedFn && changedFn(prev.get(k), r)) changed.push({ antes: prev.get(k), depois: r })
  }
  const removed = []
  for (const [k, r] of prev) { if (!curr.has(k)) removed.push(r) }
  return { added, removed, changed }
}

/**
 * Top-N por valor (desc por padrão). Ignora valores nulos/NaN.
 * valueFn: linha → número. dir: 'desc' (maiores) | 'asc' (menores).
 */
export function topMovers(rows, valueFn, n = 5, dir = 'desc') {
  const withVal = (rows || [])
    .map(r => ({ row: r, v: valueFn(r) }))
    .filter(x => x.v != null && !Number.isNaN(x.v))
  withVal.sort((a, b) => (dir === 'asc' ? a.v - b.v : b.v - a.v))
  return withVal.slice(0, n).map(x => x.row)
}

/**
 * Escolhe as N datas de relatório: os dias distintos mais recentes em que
 * ALGUMA fonte tem data de referência. perSourceDates = { fonte: [datas...] }.
 * Retorna array 'AAAA-MM-DD' desc (mais recente primeiro), no máximo n.
 */
export function pickReportDates(perSourceDates, n = 5) {
  const all = new Set()
  for (const k of Object.keys(perSourceDates || {})) {
    for (const d of perSourceDates[k] || []) {
      const p = parseDia(d)
      if (p) all.add(p.key)
    }
  }
  return [...all].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, n)
}

/**
 * Data anterior disponível de uma fonte, estritamente antes de `atual`, dentro
 * da lista de datas dela. Retorna 'AAAA-MM-DD' | null.
 */
export function previousDate(datesDaFonte, atual) {
  const keys = (datesDaFonte || [])
    .map(d => parseDia(d)).filter(Boolean).map(p => p.key)
    .filter(k => k < atual)
  if (!keys.length) return null
  keys.sort()
  return keys[keys.length - 1]
}

/**
 * A data de referência de uma fonte ≤ dataRelatorio (a mais recente dela que
 * não passa do dia do relatório). Retorna 'AAAA-MM-DD' | null.
 */
export function sourceDateFor(datesDaFonte, dataRelatorio) {
  const keys = (datesDaFonte || [])
    .map(d => parseDia(d)).filter(Boolean).map(p => p.key)
    .filter(k => k <= dataRelatorio)
  if (!keys.length) return null
  keys.sort()
  return keys[keys.length - 1]
}

/**
 * Monta o sumário executivo a partir das seções já calculadas: bullets curtos,
 * só do que tem conteúdo. Cada entrada = { texto, tom? }.
 */
export function summarize(sections) {
  const s = sections || {}
  const out = []
  const n = x => (Array.isArray(x) ? x.length : (x || 0))

  const novas = n(s.debentures?.novas)
  if (novas) out.push({ texto: `${novas} nova(s) debênture(s) cadastrada(s)`, tom: 'pos' })
  const saidas = n(s.debentures?.saidas)
  if (saidas) out.push({ texto: `${saidas} debênture(s) saíram da base`, tom: 'neg' })

  for (const seg of ['12431', 'trad']) {
    const c = s.captacao?.[seg]
    if (c && (c.captacao || c.resgate)) {
      const rotulo = seg === '12431' ? 'Incentivados' : 'Tradicional'
      out.push({ texto: `Captação líquida ${rotulo}: ${sinalMi(c.liquido)}`, tom: c.liquido >= 0 ? 'pos' : 'neg' })
    }
  }

  const topCap = s.gestores?.top12431Captacao?.[0] || s.gestores?.topTradCaptacao?.[0]
  if (topCap) out.push({ texto: `Maior captação: ${topCap.gestor} (${sinalMi(topCap.liquido)})`, tom: 'pos' })
  const topRes = s.gestores?.top12431Resgate?.[0] || s.gestores?.topTradResgate?.[0]
  if (topRes) out.push({ texto: `Maior resgate: ${topRes.gestor} (${sinalMi(topRes.liquido)})`, tom: 'neg' })

  const anbimaUp = n(s.anbima?.aberturas)
  const anbimaDown = n(s.anbima?.fechamentos)
  if (anbimaUp || anbimaDown) out.push({ texto: `ANBIMA: ${anbimaUp} abertura(s) e ${anbimaDown} fechamento(s) de spread (bps)` })

  const fNovos = n(s.fundos?.novos), fRem = n(s.fundos?.removidos)
  if (fNovos || fRem) out.push({ texto: `Fundos: +${fNovos} / -${fRem} no universo` })

  const alertas = n(s.alertas)
  if (alertas) out.push({ texto: `${alertas} alerta(s) de qualidade`, tom: 'warn' })

  return out
}

// Formatação curta em milhões, com sinal (só pro sumário; a UI usa fmtFluxo).
function sinalMi(v) {
  const n = typeof v === 'number' ? v : parseNum(v)
  if (!n) return 'R$ 0'
  const mi = n / 1e6
  const s = mi >= 0 ? '+' : '−'
  const abs = Math.abs(mi)
  const val = abs >= 1000 ? `${(abs / 1000).toFixed(1)} bi` : `${abs.toFixed(0)} mi`
  return `${s}R$ ${val}`
}

import { useState, useEffect } from 'react'
import { parseCSV } from '../utils/csv.js'

const BOOKS_URL = '/data/Books_Primario.csv'

// Books de mercado PRIMARIO (bookbuilding), gerados offline por
// tools/parsear-books.mjs -> public/data/Books_Primario.csv (1 linha por serie).
// Opcional e nao-bloqueante: se o arquivo nao existir (app antes da 1a rodada
// com essa base), o hook retorna um Map vazio e a secao do modal nao aparece.
//
// Retorna booksByGrupo: Map(Grupo -> [ book ]), book = { data, dataNum, rating,
// regime, coordenador, series:[...] }, ordenado do mais recente pro mais antigo.
export function useBooks() {
  const [booksByGrupo, setBooksByGrupo] = useState(() => new Map())

  useEffect(() => {
    let cancelled = false
    fetch(BOOKS_URL)
      .then(res => (res.ok ? res.text() : null))
      .then(txt => {
        if (cancelled || !txt) return
        const rows = parseCSV(txt)
        setBooksByGrupo(agruparPorGrupo(rows))
      })
      .catch(() => { if (!cancelled) setBooksByGrupo(new Map()) })
    return () => { cancelled = true }
  }, [])

  return { booksByGrupo }
}

const dnum = d => {
  const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? +(m[3] + m[2] + m[1]) : 0
}

// dedup de reposts + agrupa as series de cada book (mesma data) por Grupo
function agruparPorGrupo(rows) {
  const byGrupo = new Map()
  const seen = new Set()
  for (const r of rows) {
    const grupo = r.Grupo
    if (!grupo) continue // sem grupo casado: nao amarra a nenhuma debenture
    // dedup de reposts por chave normalizada (nao pelo raw, que varia por espaco)
    const k = [grupo, r.DataBook, r.Serie, r.Prazo, r.IndexadorFinal, r.SpreadFinalPct].join('|')
    if (seen.has(k)) continue
    seen.add(k)
    if (!byGrupo.has(grupo)) byGrupo.set(grupo, new Map())
    const books = byGrupo.get(grupo)
    if (!books.has(r.DataBook)) {
      books.set(r.DataBook, {
        data: r.DataBook, dataNum: dnum(r.DataBook),
        rating: r.Rating, regime: r.Regime, coordenador: r.Coordenador,
        series: [],
      })
    }
    books.get(r.DataBook).series.push(r)
  }
  // Map(grupo -> array de books ordenado desc por data)
  const out = new Map()
  for (const [grupo, books] of byGrupo) {
    out.set(grupo, [...books.values()].sort((a, b) => b.dataNum - a.dataNum))
  }
  return out
}

// pt-BR: 0.65 -> "0,65"
const pct = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sgn = n => (Number(n) >= 0 ? '+' : '')

// Taxa de saida/teto de uma serie -> string legivel.
// which = 'Final' | 'Teto'. Ex.: "CDI +0,65%", "B35 +0,20%", "IPCA +8,04%".
export function fmtBookTaxa(row, which = 'Final') {
  const idx = row['Indexador' + which]
  const spread = row['Spread' + which + 'Pct']
  if (spread === '' || spread == null) return which === 'Final' ? (row.TaxaFinalRaw || '—') : '—'
  if (idx === 'NTN-B') return `${row['Ntnb' + which] || 'NTN-B'} ${sgn(spread)}${pct(spread)}%`
  if (idx === '%CDI') return `${pct(spread)}% CDI`
  if (idx === 'CDI' || idx === 'IPCA') return `${idx} ${sgn(spread)}${pct(spread)}%`
  if (idx === 'Fixa') return `${pct(spread)}%`
  return `${sgn(spread)}${pct(spread)}%`
}

// Demanda: preferir ×over; senao volume em R$ mm. Zero/vazio -> '' (nao exibe).
export function fmtBookDemanda(row) {
  if (row.OverX !== '' && row.OverX != null && Number(row.OverX) > 0) {
    const x = Number(row.OverX).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return `${x}×`
  }
  if (row.DemandaMM !== '' && row.DemandaMM != null && Number(row.DemandaMM) > 0) {
    const v = Number(row.DemandaMM)
    return v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
      : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mm`
  }
  return ''
}

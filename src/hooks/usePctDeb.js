import { useState, useEffect } from 'react'
import { normCnpj } from '../utils/corte.js'

// Le public/data/Fundos_PctDeb.csv (CNPJ,Pct_Debentures) -> Map(cnpj -> pct).
// Gerado por selecionar-fundos.ps1 junto com o Universo_Candidatos.csv, mas
// enxuto de proposito (~56 KB p/ 2734 fundos): so' as duas colunas que o corte
// global precisa. Nome/gestor/PL o app ja' tem nas bases por fundo.
//
// Ausente/404 -> Map vazio. A UI trata isso escondendo o seletor de corte em
// vez de mostrar um filtro que nao filtra nada.
export function usePctDeb() {
  const [pctPorCnpj, setPct] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/data/Fundos_PctDeb.csv')
      .then(res => (res.ok ? res.text() : null))
      .then(txt => {
        if (cancelled) return
        if (!txt) { setPct(new Map()); return }
        const m = new Map()
        const linhas = txt.trim().split(/\r?\n/)
        for (let i = 1; i < linhas.length; i++) {
          const l = linhas[i]
          if (!l) continue
          const v = l.split(',')
          const cnpj = normCnpj(v[0])
          const pct = parseFloat(v[1])
          if (cnpj && !isNaN(pct)) m.set(cnpj, pct)
        }
        setPct(m)
      })
      .catch(() => { if (!cancelled) setPct(new Map()) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { pctPorCnpj, loading }
}

import { useState, useEffect } from 'react'

// Le public/data/Cronograma_Amortizacao.csv (Ticker,Data,FracaoPct,Fonte) ->
// Map(ticker -> [{ data:'yyyy-mm-dd', pct, fonte }]). E' o cronograma de
// amortizacao (vida inteira) das 4.670 debentures, gerado por
// gerar-cronograma-amortizacao.mjs pela cascata anbima->bullet->fixo->linear.
//
// Carrega SOB DEMANDA (`enabled`): so' quando a aba Debentures esta' ativa. ~1,6
// MB; o Vercel serve gzipado. 404 -> Map vazio (o grafico some, nao quebra).
export function useCronogramaAmort(enabled) {
  const [cronoMap, setMap] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || cronoMap) return
    let cancelled = false
    setLoading(true)
    fetch('/data/Cronograma_Amortizacao.csv')
      .then(res => (res.ok ? res.text() : null))
      .then(txt => {
        if (cancelled) return
        const m = new Map()
        if (txt) {
          const linhas = txt.trim().split(/\r?\n/)
          for (let i = 1; i < linhas.length; i++) {
            const l = linhas[i]
            if (!l) continue
            const c = l.split(',')      // sem aspas: ticker/data/pct/fonte nao tem virgula
            if (c.length < 4) continue
            const tk = c[0]
            let arr = m.get(tk)
            if (!arr) { arr = []; m.set(tk, arr) }
            arr.push({ data: c[1], pct: parseFloat(c[2]) || 0, fonte: c[3] })
          }
        }
        setMap(m)
      })
      .catch(() => { if (!cancelled) setMap(new Map()) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, cronoMap])

  return { cronoMap, loading }
}

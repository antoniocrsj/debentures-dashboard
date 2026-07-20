import { useState, useEffect } from 'react'
import { normCnpj } from '../utils/corte.js'

// Le public/data/Caixa_Potencial_Fundos_Historico.csv (Mes,CNPJ,Gestor,Segmento,
// Caixa,PL) -- uma linha por fundo/mes. E' o que permite o corte de %Deb agir no
// grafico de %PL em caixa: o historico agregado nao tem CNPJ, este tem.
//
// Carrega SOB DEMANDA (`enabled`): so' quando o corte sai do oficial. No corte
// oficial o app usa o historico agregado leve e nunca baixa este arquivo
// (~2,5 MB). Assim o carregamento padrao nao paga o custo.
export function useCaixaFundosHistorico(enabled) {
  const [rows, setRows] = useState(null)   // null = ainda nao carregado
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || rows) return            // ja' carregado ou desligado: nao refaz
    let cancelled = false
    setLoading(true)
    fetch('/data/Caixa_Potencial_Fundos_Historico.csv')
      .then(res => (res.ok ? res.text() : null))
      .then(txt => {
        if (cancelled) return
        if (!txt) { setRows([]); return }
        const linhas = txt.trim().split(/\r?\n/)
        const out = []
        for (let i = 1; i < linhas.length; i++) {
          const l = linhas[i]
          if (!l) continue
          // Gestor pode vir entre aspas (tem virgula); parse simples respeitando isso
          const c = splitCsvLine(l)
          if (c.length < 6) continue
          out.push({
            mes: c[0],
            cnpj: normCnpj(c[1]),
            gestor: c[2],
            segmento: c[3],
            caixa: parseFloat(c[4]) || 0,
            pl: parseFloat(c[5]) || 0,
          })
        }
        setRows(out)
      })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, rows])

  return { rows, loading }
}

// split de linha CSV com campos entre aspas (so' o Gestor pode ter virgula).
function splitCsvLine(l) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]
    if (ch === '"') {
      if (q && l[i + 1] === '"') { cur += '"'; i++ }
      else q = !q
    } else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

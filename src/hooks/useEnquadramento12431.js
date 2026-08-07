import { useState, useEffect } from 'react'

// Lê public/data/Enquadramento_12431.csv (1 linha/fundo) — gerado por
// tools/preparar-enquadramento-12431.mjs. Alimenta o gráfico "Enquadramento 12.431"
// da aba Técnico: compra necessária de debêntures 12.431 por fundo, hoje/6m/12m.
// Carrega SOB DEMANDA (`enabled`) — arquivo pequeno, mas segue o padrão do app.
export function useEnquadramento12431(enabled) {
  const [rows, setRows] = useState(null)
  const [serie, setSerie] = useState(null)          // série mensal TOTAL (do meta)
  const [serieGestora, setSerieGestora] = useState(null)   // série mensal por gestora
  const [demandaMovel, setDemandaMovel] = useState(null)   // demanda móvel +3m/+6m (histórico)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || rows) return
    let cancelled = false
    setLoading(true)
    // série mensal vem do meta (não trava se faltar)
    fetch('/data/Enquadramento_12431_meta.json')
      .then(res => (res.ok ? res.json() : null))
      .then(j => { if (!cancelled) { setSerie(j?.serieMensal || []); setSerieGestora(j?.serieMensalGestora || {}) } })
      .catch(() => { if (!cancelled) { setSerie([]); setSerieGestora({}) } })
    // demanda móvel a frente (+3m/+6m por mês-âncora) — arquivo próprio, não trava
    fetch('/data/Demanda_Movel_12431.json')
      .then(res => (res.ok ? res.json() : null))
      .then(j => { if (!cancelled) setDemandaMovel(j?.serie || []) })
      .catch(() => { if (!cancelled) setDemandaMovel([]) })
    fetch('/data/Enquadramento_12431.csv')
      .then(res => (res.ok ? res.text() : null))
      .then(txt => {
        if (cancelled) return
        if (!txt) { setRows([]); return }
        const linhas = txt.trim().split(/\r?\n/)
        const head = splitCsvLine(linhas[0])
        const idx = n => head.indexOf(n)
        const iC = idx('CNPJ'), iF = idx('Fundo'), iG = idx('Gestor'), iId = idx('idadeMeses'),
          iPr = idx('PL_ref'), iPa = idx('pctAtual'),
          iE0 = idx('Eleg_0m'), iE6 = idx('Eleg_6m'), iE12 = idx('Eleg_12m'),
          iX0 = idx('pctExig_0m'), iX6 = idx('pctExig_6m'), iX12 = idx('pctExig_12m'),
          iC0 = idx('Compra_0m'), iC6 = idx('Compra_6m'), iC12 = idx('Compra_12m'),
          iAe = idx('amortEstimada'), iSd = idx('semDataInicio'), iSc = idx('semCarteira'),
          iDm = idx('dataM'), iDh = idx('dataHoje')
        const N = v => parseFloat(v) || 0
        const out = []
        for (let i = 1; i < linhas.length; i++) {
          const c = splitCsvLine(linhas[i]); if (c.length < head.length) continue
          out.push({
            cnpj: c[iC], fundo: c[iF], gestor: c[iG], idadeMeses: N(c[iId]),
            plRef: N(c[iPr]), pctAtual: N(c[iPa]),
            eleg: { 0: N(c[iE0]), 6: N(c[iE6]), 12: N(c[iE12]) },
            pctExig: { 0: N(c[iX0]), 6: N(c[iX6]), 12: N(c[iX12]) },
            compra: { 0: N(c[iC0]), 6: N(c[iC6]), 12: N(c[iC12]) },
            amortEstimada: c[iAe] === '1', semDataInicio: c[iSd] === '1', semCarteira: c[iSc] === '1',
            dataM: c[iDm], dataHoje: c[iDh],
          })
        }
        setRows(out)
      })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, rows])

  return { rows, serie, serieGestora, demandaMovel, loading }
}

function splitCsvLine(l) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]
    if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur); return out
}

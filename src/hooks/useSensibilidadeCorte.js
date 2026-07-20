import { useState, useEffect } from 'react'

// Le public/data/Sensibilidade_Corte_Deb.json (gerado por
// tools/gerar-sensibilidade-corte.mjs, opt-in). Ausente/404 -> data=null (a UI
// mostra um estado "ainda nao gerado" em vez de quebrar) - mesmo padrao dos
// outros hooks de dado estatico deste app.
export function useSensibilidadeCorte() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    fetch('/data/Sensibilidade_Corte_Deb.json')
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  return { data, loading }
}

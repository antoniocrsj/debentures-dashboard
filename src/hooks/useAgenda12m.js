import { useState, useEffect } from 'react'

// Carrega o planejamento de Vencimentos 12m (juros + amortizacao), gerado
// offline por tools/gerar-agenda-12m.mjs -> public/data/Agenda_12m.json.
// Degrada com graca: se o arquivo nao existir (ainda nao rodou a agenda), o
// app mostra um estado vazio em vez de quebrar.
export function useAgenda12m() {
  const [state, setState] = useState({ loading: true, data: null })

  useEffect(() => {
    let alive = true
    fetch('/data/Agenda_12m.json')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (alive) setState({ loading: false, data }) })
      .catch(() => { if (alive) setState({ loading: false, data: null }) })
    return () => { alive = false }
  }, [])

  return state
}

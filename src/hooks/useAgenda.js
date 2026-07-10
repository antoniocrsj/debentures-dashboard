import { useState, useEffect } from 'react'
import { parseAgenda } from '../utils/agenda.js'

// Cache por ticker (vive enquanto a aba estiver aberta) — a agenda quase não muda,
// então não faz sentido rebuscar ao reabrir o mesmo papel.
const CACHE = new Map()

/**
 * Busca a agenda de eventos da ANBIMA sob demanda (endpoint dev /api/anbima-agenda)
 * e devolve o resumo já parseado (prazo, rótulo "Ny (a/b)", amortizações).
 * No app publicado (sem servidor dev) o endpoint não existe → `unavailable: true`.
 */
export function useAgenda(ticker, emissao, vencimento) {
  const [state, setState] = useState(() => ({
    loading: false, data: CACHE.get(ticker) || null, unavailable: false,
  }))

  useEffect(() => {
    if (!ticker) { setState({ loading: false, data: null, unavailable: false }); return }
    if (CACHE.has(ticker)) { setState({ loading: false, data: CACHE.get(ticker), unavailable: false }); return }

    let alive = true
    setState({ loading: true, data: null, unavailable: false })
    fetch(`/api/anbima-agenda?ticker=${encodeURIComponent(ticker)}`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        if (j.error) throw new Error(j.error)
        return j.content || []
      })
      .then(content => {
        if (!alive) return
        const parsed = parseAgenda(content, emissao, vencimento)
        CACHE.set(ticker, parsed)
        setState({ loading: false, data: parsed, unavailable: false })
      })
      .catch(() => {
        // endpoint ausente (produção) ou falha de rede → bloco indisponível, sem erro barulhento
        if (alive) setState({ loading: false, data: null, unavailable: true })
      })
    return () => { alive = false }
  }, [ticker, emissao, vencimento])

  return state
}

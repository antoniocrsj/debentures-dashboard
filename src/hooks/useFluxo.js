import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeFluxo } from '../utils/fluxo.js'

// ─────────────────────────────────────────────────────────────────────────────
//  ÚNICO ponto de configuração da ORIGEM dos dados de fluxo.
//  Hoje: arquivos estáticos em public/data/ (mock, gerados por tools/fluxo_semanal.py).
//  Para trocar por Google Apps Script / API no futuro, basta alterar FLUXO_SOURCES
//  (e, se preciso, a forma de fetch) — os componentes não mudam.
// ─────────────────────────────────────────────────────────────────────────────
export const FLUXO_SOURCES = {
  '12431': '/data/Fluxo_Semanal_12431.csv',
  'trad':  '/data/Fluxo_Semanal_Trad.csv',
}

// Vire false quando os CSVs REAIS substituírem os mocks em public/data/.
export const FLUXO_IS_MOCK = true

export const FLUXO_TIPOS = [
  { id: '12431', label: 'Incentivados (12.431)' },
  { id: 'trad',  label: 'Crédito Tradicional' },
]

/**
 * Carrega e normaliza a base de fluxo de um tipo de fundo.
 * Retorna { loading, error, rows, invalid, isMock, reload }.
 */
export function useFluxo(tipo) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], invalid: 0 })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const src = FLUXO_SOURCES[tipo]
    const id = ++reqId.current
    setState(s => ({ ...s, loading: true, error: null }))

    if (!src) {
      setState({ loading: false, error: `Tipo de fundo desconhecido: ${tipo}`, rows: [], invalid: 0 })
      return
    }

    fetch(src)
      .then(async res => {
        if (!res.ok) throw new Error(`Não foi possível carregar os dados (HTTP ${res.status}).`)
        const text = await res.text()
        const parsed = parseCSV(text)            // lança erro claro se vier HTML em vez de CSV
        const { rows, invalid } = normalizeFluxo(parsed)
        if (id === reqId.current) setState({ loading: false, error: null, rows, invalid })
      })
      .catch(err => {
        if (id === reqId.current) {
          setState({ loading: false, error: err.message || 'Erro ao carregar os dados.', rows: [], invalid: 0 })
        }
      })
  }, [tipo])

  useEffect(() => { load() }, [load])

  return { ...state, isMock: FLUXO_IS_MOCK, reload: load }
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeFluxo, normalizeMensal } from '../utils/fluxo.js'

export const FLUXO_SOURCES = {
  '12431': '/data/Fluxo_Semanal_12431.csv',
  trad: '/data/Fluxo_Semanal_Trad.csv',
}

export const FLUXO_SOURCES_MENSAL = {
  '12431': '/data/Fluxo_Mensal_12431.csv',
  trad: '/data/Fluxo_Mensal_Trad.csv',
}

export const FLUXO_META_URL = '/data/Fluxo_Meta.json'
export const FLUXO_IS_MOCK = false

export const FLUXO_TIPOS = [
  { id: '12431', label: 'Incentivados (12.431)' },
  { id: 'trad', label: 'Crédito Tradicional' },
]

export function useFluxo(tipo) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: [],
    invalid: 0,
    monthly: [],
    meta: null,
  })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const src = FLUXO_SOURCES[tipo]
    const srcMes = FLUXO_SOURCES_MENSAL[tipo]
    const id = ++reqId.current
    setState(s => ({ ...s, loading: true, error: null }))

    if (!src) {
      setState({
        loading: false,
        error: `Tipo de fundo desconhecido: ${tipo}`,
        rows: [],
        invalid: 0,
        monthly: [],
        meta: null,
      })
      return
    }

    const loadWeekly = fetch(src).then(async res => {
      if (!res.ok) throw new Error(`Nao foi possivel carregar os dados (HTTP ${res.status}).`)
      return normalizeFluxo(parseCSV(await res.text()))
    })

    const loadMonthly = srcMes
      ? fetch(srcMes)
          .then(async res => (res.ok ? normalizeMensal(parseCSV(await res.text())).rows : []))
          .catch(err => {
            console.error(`[useFluxo] base mensal indisponivel (${srcMes}):`, err)
            return []
          })
      : Promise.resolve([])

    const loadMeta = fetch(FLUXO_META_URL)
      .then(async res => (res.ok ? (await res.json()) : null))
      .catch(err => {
        console.error(`[useFluxo] meta indisponivel (${FLUXO_META_URL}):`, err)
        return null
      })

    Promise.all([loadWeekly, loadMonthly, loadMeta])
      .then(([{ rows, invalid }, monthly, meta]) => {
        if (id === reqId.current) {
          setState({ loading: false, error: null, rows, invalid, monthly, meta })
        }
      })
      .catch(err => {
        console.error(`[useFluxo] falha ao carregar ${src}:`, err)
        if (id === reqId.current) {
          setState({
            loading: false,
            error: err.message || 'Erro ao carregar os dados.',
            rows: [],
            invalid: 0,
            monthly: [],
            meta: null,
          })
        }
      })
  }, [tipo])

  useEffect(() => { load() }, [load])

  return { ...state, isMock: FLUXO_IS_MOCK, reload: load }
}

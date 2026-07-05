import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeFluxo, normalizeMensal, normalizeRentabilidade } from '../utils/fluxo.js'

export const FLUXO_SOURCES = {
  '12431': '/data/Fluxo_Semanal_12431.csv',
  trad: '/data/Fluxo_Semanal_Trad.csv',
}

export const FLUXO_SOURCES_MENSAL = {
  '12431': '/data/Fluxo_Mensal_12431.csv',
  trad: '/data/Fluxo_Mensal_Trad.csv',
}

export const FLUXO_SOURCES_RENT = {
  '12431': '/data/Fluxo_Rentabilidade_12431.csv',
  trad: '/data/Fluxo_Rentabilidade_Trad.csv',
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
    rentabilidade: new Map(),
  })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const src = FLUXO_SOURCES[tipo]
    const srcMes = FLUXO_SOURCES_MENSAL[tipo]
    const srcRent = FLUXO_SOURCES_RENT[tipo]
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
        rentabilidade: new Map(),
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

    // Rentabilidade (%CDI por gestor, janelas 1s/1m/3m/6m/12m) — opcional: se
    // faltar/quebrar, a Captação segue funcionando sem essas colunas.
    const loadRent = srcRent
      ? fetch(srcRent)
          .then(async res => (res.ok ? normalizeRentabilidade(parseCSV(await res.text())) : new Map()))
          .catch(err => {
            console.error(`[useFluxo] rentabilidade indisponivel (${srcRent}):`, err)
            return new Map()
          })
      : Promise.resolve(new Map())

    const loadMeta = fetch(FLUXO_META_URL)
      .then(async res => (res.ok ? (await res.json()) : null))
      .catch(err => {
        console.error(`[useFluxo] meta indisponivel (${FLUXO_META_URL}):`, err)
        return null
      })

    Promise.all([loadWeekly, loadMonthly, loadRent, loadMeta])
      .then(([{ rows, invalid }, monthly, rentabilidade, meta]) => {
        if (id === reqId.current) {
          setState({ loading: false, error: null, rows, invalid, monthly, meta, rentabilidade })
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
            rentabilidade: new Map(),
          })
        }
      })
  }, [tipo])

  useEffect(() => { load() }, [load])

  return { ...state, isMock: FLUXO_IS_MOCK, reload: load }
}

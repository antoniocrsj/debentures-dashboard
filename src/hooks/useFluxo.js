import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeFluxo, normalizeMensal, normalizeRentabilidade, normalizeFluxoFundos, normalizeFundosMeta, normalizeFechados } from '../utils/fluxo.js'

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

// Base semanal por fundo (flows que reagem ao período) + meta por fundo
// (nome + %CDI do próprio fundo). Alimentam a tabela de fundos de um gestor.
export const FLUXO_SOURCES_FUNDOS = {
  '12431': '/data/Fluxo_Semanal_Fundos_12431.csv',
  trad: '/data/Fluxo_Semanal_Fundos_Trad.csv',
}

export const FLUXO_SOURCES_FUNDOS_META = {
  '12431': '/data/Fluxo_Fundos_12431.csv',
  trad: '/data/Fluxo_Fundos_Trad.csv',
}

export const FLUXO_META_URL = '/data/Fluxo_Meta.json'
// Atributos de cadastro dos fundos (CVM), incl. Forma_Condominio (Aberto/Fechado).
// Arquivo único para os dois segmentos; usado para o filtro de fundos fechados.
export const FLUXO_ATRIBUTOS_URL = '/data/Fundos_Atributos.csv'
export const FLUXO_IS_MOCK = false

export const FLUXO_TIPOS = [
  { id: '12431', label: '12.431' },
  { id: 'trad', label: 'Tradicional' },
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
    fundosSemana: [],
    fundosMeta: new Map(),
    fechados: new Set(),
  })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const src = FLUXO_SOURCES[tipo]
    const srcMes = FLUXO_SOURCES_MENSAL[tipo]
    const srcRent = FLUXO_SOURCES_RENT[tipo]
    const srcFun = FLUXO_SOURCES_FUNDOS[tipo]
    const srcFunMeta = FLUXO_SOURCES_FUNDOS_META[tipo]
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
        fundosSemana: [],
        fundosMeta: new Map(),
        fechados: new Set(),
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

    // Fundos de um gestor (tabela que abre ao clicar numa gestora) — opcionais:
    // se faltarem/quebrarem, a Captação segue funcionando sem essa tabela.
    const loadFundos = srcFun
      ? fetch(srcFun)
          .then(async res => (res.ok ? normalizeFluxoFundos(parseCSV(await res.text())) : []))
          .catch(err => {
            console.error(`[useFluxo] base por fundo indisponivel (${srcFun}):`, err)
            return []
          })
      : Promise.resolve([])

    const loadFundosMeta = srcFunMeta
      ? fetch(srcFunMeta)
          .then(async res => (res.ok ? normalizeFundosMeta(parseCSV(await res.text())) : new Map()))
          .catch(err => {
            console.error(`[useFluxo] meta por fundo indisponivel (${srcFunMeta}):`, err)
            return new Map()
          })
      : Promise.resolve(new Map())

    // Fundos fechados (Forma_Condominio) — opcional: se faltar/quebrar, o filtro
    // de fundos fechados simplesmente não terá o que ocultar.
    const loadFechados = fetch(FLUXO_ATRIBUTOS_URL)
      .then(async res => (res.ok ? normalizeFechados(parseCSV(await res.text())) : new Set()))
      .catch(err => {
        console.error(`[useFluxo] atributos de fundos indisponiveis (${FLUXO_ATRIBUTOS_URL}):`, err)
        return new Set()
      })

    Promise.all([loadWeekly, loadMonthly, loadRent, loadMeta, loadFundos, loadFundosMeta, loadFechados])
      .then(([{ rows, invalid }, monthly, rentabilidade, meta, fundosSemana, fundosMeta, fechados]) => {
        if (id === reqId.current) {
          setState({ loading: false, error: null, rows, invalid, monthly, meta, rentabilidade, fundosSemana, fundosMeta, fechados })
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
            fundosSemana: [],
            fundosMeta: new Map(),
            fechados: new Set(),
          })
        }
      })
  }, [tipo])

  useEffect(() => { load() }, [load])

  return { ...state, isMock: FLUXO_IS_MOCK, reload: load }
}

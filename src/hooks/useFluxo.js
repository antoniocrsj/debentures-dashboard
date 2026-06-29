import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeFluxo, normalizeMensal } from '../utils/fluxo.js'

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

// Base MENSAL (por mês, agregada do diário). Mesma origem estática.
export const FLUXO_SOURCES_MENSAL = {
  '12431': '/data/Fluxo_Mensal_12431.csv',
  'trad':  '/data/Fluxo_Mensal_Trad.csv',
}

// Vire false quando os CSVs REAIS substituírem os mocks em public/data/.
export const FLUXO_IS_MOCK = false

export const FLUXO_TIPOS = [
  { id: '12431', label: 'Incentivados (12.431)' },
  { id: 'trad',  label: 'Crédito Tradicional' },
]

/**
 * Carrega e normaliza a base de fluxo de um tipo de fundo.
 * Retorna { loading, error, rows, invalid, isMock, reload }.
 */
export function useFluxo(tipo) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], invalid: 0, monthly: [] })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const src = FLUXO_SOURCES[tipo]
    const srcMes = FLUXO_SOURCES_MENSAL[tipo]
    const id = ++reqId.current
    setState(s => ({ ...s, loading: true, error: null }))

    if (!src) {
      setState({ loading: false, error: `Tipo de fundo desconhecido: ${tipo}`, rows: [], invalid: 0, monthly: [] })
      return
    }

    // Semanal = base principal (define loading/erro). Mensal = complementar
    // (se faltar, a tabela Meses só não aparece; o resto da Captação segue).
    const loadWeekly = fetch(src).then(async res => {
      if (!res.ok) throw new Error(`Não foi possível carregar os dados (HTTP ${res.status}).`)
      return normalizeFluxo(parseCSV(await res.text()))   // parseCSV lança se vier HTML
    })
    const loadMonthly = srcMes
      ? fetch(srcMes)
          .then(async res => (res.ok ? normalizeMensal(parseCSV(await res.text())).rows : []))
          .catch(err => { console.error(`[useFluxo] base mensal indisponível (${srcMes}):`, err); return [] })
      : Promise.resolve([])

    Promise.all([loadWeekly, loadMonthly])
      .then(([{ rows, invalid }, monthly]) => {
        if (id === reqId.current) setState({ loading: false, error: null, rows, invalid, monthly })
      })
      .catch(err => {
        console.error(`[useFluxo] falha ao carregar ${src}:`, err)   // tratamento de erro (mantido)
        if (id === reqId.current) {
          setState({ loading: false, error: err.message || 'Erro ao carregar os dados.', rows: [], invalid: 0, monthly: [] })
        }
      })
  }, [tipo])

  useEffect(() => { load() }, [load])

  return { ...state, isMock: FLUXO_IS_MOCK, reload: load }
}

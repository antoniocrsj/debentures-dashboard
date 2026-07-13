import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSV } from '../utils/csv.js'
import { normalizeCaixaFundos, normalizeCaixaGestores } from '../utils/caixa.js'

// Fontes geradas por tools/preparar-caixa-potencial.ps1.
export const CAIXA_FUNDOS_URL   = '/data/Caixa_Potencial_Fundos.csv'
export const CAIXA_GESTORES_URL = '/data/Caixa_Potencial_Gestores.csv'
export const CAIXA_META_URL     = '/data/Caixa_Potencial_Meta.json'

export function useCaixa() {
  const [state, setState] = useState({
    loading: true, error: null, fundos: [], gestores: [], meta: null,
  })
  const reqId = useRef(0)

  const load = useCallback(() => {
    const id = ++reqId.current
    setState(s => ({ ...s, loading: true, error: null }))

    const loadFundos = fetch(CAIXA_FUNDOS_URL).then(async res => {
      if (!res.ok) throw new Error(`Não foi possível carregar o Nível de Caixa (HTTP ${res.status}).`)
      return normalizeCaixaFundos(parseCSV(await res.text()))
    })

    // Gestores e meta sao opcionais: se faltarem, a secao segue com os fundos.
    const loadGestores = fetch(CAIXA_GESTORES_URL)
      .then(async res => (res.ok ? normalizeCaixaGestores(parseCSV(await res.text())) : []))
      .catch(err => { console.error(`[useCaixa] gestores indisponivel:`, err); return [] })

    const loadMeta = fetch(CAIXA_META_URL)
      .then(async res => (res.ok ? await res.json() : null))
      .catch(err => { console.error(`[useCaixa] meta indisponivel:`, err); return null })

    Promise.all([loadFundos, loadGestores, loadMeta])
      .then(([fundos, gestores, meta]) => {
        if (id === reqId.current) setState({ loading: false, error: null, fundos, gestores, meta })
      })
      .catch(err => {
        console.error(`[useCaixa] falha ao carregar:`, err)
        if (id === reqId.current) {
          setState({ loading: false, error: err.message || 'Erro ao carregar os dados.', fundos: [], gestores: [], meta: null })
        }
      })
  }, [])

  useEffect(() => { load() }, [load])

  return { ...state, reload: load }
}

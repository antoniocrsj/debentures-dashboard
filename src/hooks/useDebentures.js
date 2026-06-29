import { useState, useEffect } from 'react'
import { parseCSV } from '../utils/csv.js'
import { MOCK } from '../utils/mockData.js'

const USE_MOCK = false
const CACHE_TTL = 4 * 60 * 60 * 1000 // 4 horas

export const CADASTRO_URL =
  'https://script.google.com/macros/s/AKfycbxhTXC7FXkp9fEz0bw6Nnh_JDm4UVhRkqZF5zOW-Cb842RhFBikauGaWeChG0vQerPrBA/exec'
export const DEB_URL =
  'https://script.google.com/macros/s/AKfycbzW1aTN1zHAz40W3P9rNjk3sUf4sf4qDAqbt5QeA4e3Z4v8uGRCnlYtGXT-hBqwmaZo/exec'
export const BLC_DEFAULT_URL =
  'https://script.google.com/macros/s/AKfycbz8A8fAJTD7yVIQzufOUKE8x64BOruRBDmYE2DM0ierH7seKkDxSoHhARvmPO1lJC6f/exec'

// BLC tratado: arquivo estatico servido pelo proprio app (public/). Sem GAS, sem proxy.
const STATIC_BLC_URL = '/BLC_tratado.csv'
// Taxas ANBIMA (coluna Tx Anbima): tambem estatico em public/.
const STATIC_ANBIMA_URL = '/Anbima_Tx.csv'

async function fetchCSV(rawUrl) {
  const url = `/api/proxy?url=${encodeURIComponent(rawUrl)}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return parseCSV(await res.text())
}

// Le um CSV estatico direto (sem proxy), com cache-buster opcional
async function fetchStaticCSV(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${path}`)
  return parseCSV(await res.text())
}

function cacheKey() {
  return 'deb-cache-v4'  // v4: base ANBIMA com Duration (anos)
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null')
    if (c && Date.now() - c.ts < CACHE_TTL) return c.data
  } catch {}
  return null
}

function writeCache(data) {
  try {
    // Salva apenas o necessário — não salva objetos muito grandes
    localStorage.setItem(cacheKey(), JSON.stringify({ ts: Date.now(), data }))
  } catch {}
}

/**
 * Carrega dados com cache localStorage.
 * - Se houver cache válido: mostra imediatamente e atualiza em segundo plano
 * - Se não houver: mostra spinner até carregar
 * Retorna { loading, refreshing, error, raw, cachedAt }
 */
export function useDebentures(blcUrl) {
  const cached = readCache()
  const [state, setState] = useState({
    loading: !cached,
    refreshing: !!cached,
    error: null,
    raw: cached,
    cachedAt: cached ? JSON.parse(localStorage.getItem(cacheKey()) || 'null')?.ts : null,
  })

  useEffect(() => {
    let alive = true

    if (USE_MOCK) {
      setTimeout(() => {
        if (alive) setState({ loading: false, refreshing: false, error: null, raw: MOCK, cachedAt: null })
      }, 300)
      return () => { alive = false }
    }

    const fresh = readCache()
    setState(s => ({ ...s, loading: !fresh, refreshing: !!fresh, raw: fresh ?? s.raw }))

    Promise.all([
      fetchCSV(`${CADASTRO_URL}?sheet=emissores`),
      fetchCSV(`${CADASTRO_URL}?sheet=fundos`),
      fetchCSV(DEB_URL),
      fetchStaticCSV(STATIC_BLC_URL),
      // ANBIMA e opcional: se faltar/quebrar, a coluna Tx Anbima mostra — e o app segue.
      fetchStaticCSV(STATIC_ANBIMA_URL).catch(() => []),
    ])
      .then(([emissores, fundos, debentures, blc, anbima]) => {
        const raw = { emissores, fundos, debentures, blc, anbima }
        writeCache(raw)
        if (alive) setState({ loading: false, refreshing: false, error: null, raw, cachedAt: Date.now() })
      })
      .catch(err => {
        if (alive) setState(s => ({
          ...s,
          loading: false,
          refreshing: false,
          error: s.raw ? null : err.message, // se tem cache, não mostra erro
        }))
      })

    return () => { alive = false }
  }, [blcUrl])

  return state
}

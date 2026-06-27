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

async function fetchCSV(rawUrl) {
  const url = `/api/proxy?url=${encodeURIComponent(rawUrl)}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return parseCSV(await res.text())
}

function cacheKey(blcUrl) {
  return `deb-cache-${btoa(blcUrl).slice(0, 20)}`
}

function readCache(blcUrl) {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(blcUrl)) || 'null')
    if (c && Date.now() - c.ts < CACHE_TTL) return c.data
  } catch {}
  return null
}

function writeCache(blcUrl, data) {
  try {
    // Salva apenas o necessário — não salva objetos muito grandes
    localStorage.setItem(cacheKey(blcUrl), JSON.stringify({ ts: Date.now(), data }))
  } catch {}
}

/**
 * Carrega dados com cache localStorage.
 * - Se houver cache válido: mostra imediatamente e atualiza em segundo plano
 * - Se não houver: mostra spinner até carregar
 * Retorna { loading, refreshing, error, raw, cachedAt }
 */
export function useDebentures(blcUrl) {
  const cached = readCache(blcUrl)
  const [state, setState] = useState({
    loading: !cached,
    refreshing: !!cached,
    error: null,
    raw: cached,
    cachedAt: cached ? JSON.parse(localStorage.getItem(cacheKey(blcUrl)) || 'null')?.ts : null,
  })

  useEffect(() => {
    let alive = true

    if (USE_MOCK) {
      setTimeout(() => {
        if (alive) setState({ loading: false, refreshing: false, error: null, raw: MOCK, cachedAt: null })
      }, 300)
      return () => { alive = false }
    }

    const fresh = readCache(blcUrl)
    setState(s => ({ ...s, loading: !fresh, refreshing: !!fresh, raw: fresh ?? s.raw }))

    Promise.all([
      fetchCSV(`${CADASTRO_URL}?sheet=emissores`),
      fetchCSV(`${CADASTRO_URL}?sheet=fundos`),
      fetchCSV(DEB_URL),
      fetchCSV(blcUrl),
    ])
      .then(([emissores, fundos, debentures, blc]) => {
        const raw = { emissores, fundos, debentures, blc }
        writeCache(blcUrl, raw)
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

import { useState, useEffect } from 'react'
import { parseCSV } from '../utils/csv.js'

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
  const text = await res.text()
  return parseCSV(text)
}

/**
 * Fetches all four CSV sources in parallel.
 * Returns { loading, error, raw: { emissores, fundos, debentures, blc } }
 */
export function useDebentures(blcUrl) {
  const [state, setState] = useState({ loading: true, error: null, raw: null })

  useEffect(() => {
    let alive = true
    setState({ loading: true, error: null, raw: null })

    Promise.all([
      fetchCSV(`${CADASTRO_URL}?sheet=emissores`),
      fetchCSV(`${CADASTRO_URL}?sheet=fundos`),
      fetchCSV(DEB_URL),
      fetchCSV(blcUrl),
    ])
      .then(([emissores, fundos, debentures, blc]) => {
        if (alive) setState({ loading: false, error: null, raw: { emissores, fundos, debentures, blc } })
      })
      .catch(err => {
        if (alive) setState({ loading: false, error: err.message, raw: null })
      })

    return () => { alive = false }
  }, [blcUrl])

  return state
}

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

// Cadastro de emissores (CNPJ -> Grupo / Setor / Modulo): gerado por
// tools/preparar-emissores.ps1 a partir da Ana (fonte canonica). Estatico em
// public/; a planilha do Google (CADASTRO_URL) fica so' como fallback.
const STATIC_EMISSORES_URL = '/Emissores.csv'
// BLC tratado: arquivo estatico servido pelo proprio app (public/). Sem GAS, sem proxy.
const STATIC_BLC_URL = '/BLC_tratado.csv'
// Cadastro de debentures: gerado por tools/preparar-debentures.ps1 a partir do Debentures.com.br.
const STATIC_DEBENTURES_URL = '/Debentures.csv'
// Taxas ANBIMA (coluna Tx Anbima): tambem estatico em public/.
const STATIC_ANBIMA_URL = '/Anbima_Tx.csv'
// PL por gestor: gerado por preparar-fluxo.ps1 a partir do Informe Diario da CVM.
const STATIC_PL_GESTORES_URL = '/PL_Gestores.csv'
// Metadados de quando cada fonte foi gerada (nao o cache do navegador) — usados em App.jsx (dataFreshness).
const STATIC_DEBENTURES_META_URL = '/Debentures_meta.json'
const STATIC_BLC_META_URL = '/BLC_meta.json'
const STATIC_BLC_MATURIDADE_URL = '/BLC_maturidade.json'

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

async function fetchStaticJSON(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${path}`)
  return res.json()
}

function cacheKey() {
  return 'deb-cache-v6'  // v6: inclui metadados de geracao (Debentures_meta/BLC_meta)
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
      // Cadastro de emissores: estatico da Ana (fonte canonica), gerado por
      // tools/preparar-emissores.ps1. Fallback para a planilha do Google
      // (Cadastro_Emissores) so' se o estatico faltar/quebrar.
      fetchStaticCSV(STATIC_EMISSORES_URL).catch(() => fetchCSV(`${CADASTRO_URL}?sheet=Cadastro_Emissores&nocache=1`)),
      fetchStaticCSV(STATIC_DEBENTURES_URL).catch(() => fetchCSV(DEB_URL)),
      fetchStaticCSV(STATIC_BLC_URL),
      // ANBIMA e PL_Gestores sao opcionais: se faltar/quebrar, o app segue sem essas colunas.
      fetchStaticCSV(STATIC_ANBIMA_URL).catch(() => []),
      fetchStaticCSV(STATIC_PL_GESTORES_URL).catch(() => []),
      // Metadados de geracao das fontes estaticas — tambem opcionais.
      fetchStaticJSON(STATIC_DEBENTURES_META_URL).catch(() => null),
      fetchStaticJSON(STATIC_BLC_META_URL).catch(() => null),
      // Maturidade do CDA (selo de confiabilidade) — opcional.
      fetchStaticJSON(STATIC_BLC_MATURIDADE_URL).catch(() => null),
    ])
      .then(([emissores, debentures, blc, anbima, plGestores, debenturesMeta, blcMeta, blcMaturidade]) => {
        const raw = { emissores, debentures, blc, anbima, plGestores, debenturesMeta, blcMeta, blcMaturidade }
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

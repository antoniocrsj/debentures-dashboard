import { useState, useEffect, useCallback, useRef } from 'react'

// Central de relatorios: carrega os indices dos 3 modos (daily/weekly/monthly) e,
// sob demanda, o relatorio selecionado de cada modo. Cada modo mantem sua propria
// selecao. Nao-bloqueante: se um indice nao existir, aquele modo fica indisponivel
// (o modo Dia continua sendo o gatilho do botao de relogio, via useDailyReports).
//
// Compat: entradas do indice diario tem `date`; semanal/mensal tem `id`. Aqui
// normalizamos por `id = entry.id || entry.date`.
const MODES = ['daily', 'weekly', 'monthly']
const entryId = e => e.id || e.date

export function usePeriodReports() {
  const [indices, setIndices] = useState({ daily: null, weekly: null, monthly: null })
  const [mode, setMode] = useState('daily')
  const [selected, setSelected] = useState({ daily: null, weekly: null, monthly: null })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const cache = useRef(new Map())   // `${mode}:${id}` -> report JSON

  // Carrega os 3 indices no mount.
  useEffect(() => {
    let cancelled = false
    for (const m of MODES) {
      fetch(`/reports/${m}/index.json`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled) return
          const ok = data && Array.isArray(data.reports) && data.reports.length ? data : null
          setIndices(prev => ({ ...prev, [m]: ok }))
        })
        .catch(() => { if (!cancelled) setIndices(prev => ({ ...prev, [m]: null })) })
    }
    return () => { cancelled = true }
  }, [])

  const loadFor = useCallback(async (m, id) => {
    const idx = indices[m]
    const entry = idx?.reports?.find(r => entryId(r) === id)
    if (!entry) { setReport(null); return }
    const key = `${m}:${id}`
    if (cache.current.has(key)) { setReport(cache.current.get(key)); return }
    setLoading(true)
    try {
      const res = await fetch(`${entry.json}?t=${id}`)
      const json = res.ok ? await res.json() : null
      if (json) cache.current.set(key, json)
      setReport(json)
    } catch { setReport(null) } finally { setLoading(false) }
  }, [indices])

  // Ao trocar de modo (ou os indices chegarem), garante uma selecao: mantem a
  // do modo se houver, senao o mais recente. Carrega o relatorio correspondente.
  useEffect(() => {
    const idx = indices[mode]
    if (!idx) { setReport(null); return }
    let sel = selected[mode]
    if (!sel || !idx.reports.some(r => entryId(r) === sel)) sel = entryId(idx.reports[0])
    if (sel !== selected[mode]) setSelected(prev => ({ ...prev, [mode]: sel }))
    loadFor(mode, sel)
  }, [mode, indices, selected, loadFor])

  const select = useCallback(id => setSelected(prev => ({ ...prev, [mode]: id })), [mode])

  return {
    mode, setMode,
    index: indices[mode],
    available: { daily: !!indices.daily, weekly: !!indices.weekly, monthly: !!indices.monthly },
    hasAny: !!(indices.daily || indices.weekly || indices.monthly),
    hasDaily: !!indices.daily,
    selectedId: selected[mode],
    report, loading, select,
  }
}

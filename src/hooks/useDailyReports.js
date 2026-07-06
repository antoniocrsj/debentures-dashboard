import { useState, useEffect, useCallback } from 'react'

const INDEX_URL = '/reports/daily/index.json'

// Carrega o índice dos relatórios diários (Resumo do Dia) e, sob demanda, o
// relatório de uma data. Opcional/não-bloqueante: se o índice não existir ainda
// (app recém-publicado, antes da primeira geração), o botão simplesmente não
// aparece — igual ao padrão do useAtualizacaoResumo.
export function useDailyReports() {
  const [index, setIndex] = useState(null)   // { reports: [...] } | null
  const [report, setReport] = useState(null) // relatório da data selecionada
  const [loadingReport, setLoadingReport] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(INDEX_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled) setIndex(data && Array.isArray(data.reports) && data.reports.length ? data : null) })
      .catch(() => { if (!cancelled) setIndex(null) })
    return () => { cancelled = true }
  }, [])

  const loadReport = useCallback(async (date) => {
    const entry = index?.reports?.find(r => r.date === date)
    if (!entry) return
    setLoadingReport(true)
    try {
      const res = await fetch(`${entry.json}?t=${date}`)
      setReport(res.ok ? await res.json() : null)
    } catch {
      setReport(null)
    } finally {
      setLoadingReport(false)
    }
  }, [index])

  return { index, report, loadingReport, loadReport }
}

import { useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { useFluxo, FLUXO_TIPOS } from '../../hooks/useFluxo.js'
import {
  filterFluxo, aggregateByWeek, aggregateByGestor, computeCards,
  sortGestores, gestorOptions, startForMonths, periodBounds,
} from '../../utils/fluxo.js'
import FluxoFilters from './FluxoFilters.jsx'
import FluxoSummaryCards from './FluxoSummaryCards.jsx'
import FluxoTable from './FluxoTable.jsx'
import GestorFlowRanking from './GestorFlowRanking.jsx'

// Recharts só carrega quando a aba é aberta (preserva a carga inicial do app).
const FluxoChart = lazy(() => import('./FluxoChart.jsx'))

const INIT_PERIOD = { start: null, end: null, months: 12 }

export default function FluxoDashboard() {
  const [tipo, setTipo]     = useState('12431')
  const [gestor, setGestor] = useState('')
  const [period, setPeriod] = useState(INIT_PERIOD)
  const [rankBy, setRankBy] = useState('liquido')

  const { loading, error, rows, invalid, isMock, reload } = useFluxo(tipo)

  const gestores = useMemo(() => gestorOptions(rows), [rows])
  const bounds   = useMemo(() => periodBounds(rows), [rows])

  const effStart = useMemo(() => {
    if (period.start) return period.start
    if (period.months != null) return startForMonths(rows, period.months)
    return null
  }, [period, rows])
  const effEnd = period.end || bounds.max

  const filtered = useMemo(
    () => filterFluxo(rows, { gestor, start: effStart, end: effEnd }),
    [rows, gestor, effStart, effEnd]
  )
  const weekly = useMemo(() => aggregateByWeek(filtered), [filtered])
  const cards  = useMemo(() => computeCards(filtered), [filtered])
  const ranking = useMemo(
    () => (gestor ? [] : sortGestores(aggregateByGestor(filtered), rankBy)),
    [filtered, gestor, rankBy]
  )

  const changeTipo = useCallback(t => { setTipo(t); setGestor('') }, [])
  const clearFilters = useCallback(() => { setGestor(''); setPeriod(INIT_PERIOD) }, [])

  return (
    <section className="fluxo" aria-label="Captação dos fundos">
      <header className="fluxo-header">
        <h2 className="fluxo-title">Captação dos Fundos</h2>
        <p className="fluxo-subtitle">Fluxo semanal de fundos de crédito</p>
      </header>

      {isMock && (
        <div className="fluxo-mock-banner" role="status">
          ⚠️ Dados de exemplo (mock) — substitua os CSVs em <code>public/data/</code> pelos reais.
        </div>
      )}

      <FluxoFilters
        tipos={FLUXO_TIPOS}
        tipo={tipo}
        onTipo={changeTipo}
        gestores={gestores}
        gestor={gestor}
        onGestor={setGestor}
        period={period}
        onPeriod={setPeriod}
        onClear={clearFilters}
        disabled={loading}
      />

      {/* Estados */}
      {loading && (
        <div className="state-box">
          <div className="spinner" aria-label="Carregando" />
          <p>Carregando captações…</p>
        </div>
      )}

      {!loading && error && (
        <div className="state-box error">
          <span className="state-icon">⚠️</span>
          <p className="error-msg">Não foi possível carregar os dados de captação.</p>
          <small>{error}</small>
          <button className="btn-retry" onClick={reload}>Tentar novamente</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <span>Sem dados de captação</span>
          <small>O arquivo desta base está vazio ou não foi encontrado.</small>
        </div>
      )}

      {!loading && !error && rows.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <span>Nenhuma informação para os filtros</span>
          <small>Ajuste o gestor ou o período selecionado.</small>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <FluxoSummaryCards cards={cards} />

          <Suspense fallback={<div className="state-box"><div className="spinner" aria-label="Carregando gráfico" /></div>}>
            <FluxoChart weekly={weekly} />
          </Suspense>

          {!gestor && (
            <GestorFlowRanking ranking={ranking} rankBy={rankBy} onRankBy={setRankBy} />
          )}

          <FluxoTable weekly={weekly} />

          {invalid > 0 && (
            <p className="fluxo-note">{invalid} linha(s) ignorada(s) por dados inválidos.</p>
          )}
        </>
      )}
    </section>
  )
}

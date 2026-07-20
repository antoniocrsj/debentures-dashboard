import { useState, useMemo, useCallback, Suspense } from 'react'
import { useFluxo, FLUXO_TIPOS } from '../../hooks/useFluxo.js'
import {
  filterFluxo, aggregateByWeek, aggregateByGestor, computeCards,
  gestorOptions, startForMonths, periodBounds, fmtWeekFull, latestBaseDate,
  filterMensal, aggregateByMonth, mergeRentabilidade,
  filterFundos, aggregateByFundo, mergeFundos, excludeFechados,
} from '../../utils/fluxo.js'
import { lazyWithRetry } from '../../utils/lazyWithRetry.js'
import FluxoFilters from './FluxoFilters.jsx'
import FluxoSummaryCards from './FluxoSummaryCards.jsx'
import FluxoTable from './FluxoTable.jsx'
import FluxoMonthlyTable from './FluxoMonthlyTable.jsx'
import GestorFlowRanking from './GestorFlowRanking.jsx'
import FundoFlowTable from './FundoFlowTable.jsx'
import SensibilidadeCorte from './SensibilidadeCorte.jsx'

// Recharts só carrega ao abrir a aba (preserva a carga inicial do app).
// lazyWithRetry: re-tenta o import se o chunk do gráfico falhar.
const FluxoChart = lazyWithRetry(() => import('./FluxoChart.jsx'))

const DEFAULT_MONTHS = 12


export default function FluxoDashboard({ compact = false }) {
  const [tipo, setTipo]     = useState('12431')
  const [gestor, setGestor] = useState('')
  const [months, setMonths] = useState(DEFAULT_MONTHS)   // null = todo o histórico
  const [hideFechados, setHideFechados] = useState(false)  // ocultar fundos de condomínio fechado

  const { loading, error, rows, invalid, isMock, reload, monthly, meta, rentabilidade, fundosSemana, fundosMeta, fechados } = useFluxo(tipo)
  const tipoLabel = FLUXO_TIPOS.find(t => t.id === tipo)?.label ?? tipo

  const gestores = useMemo(() => gestorOptions(rows), [rows])
  const bounds   = useMemo(() => periodBounds(rows), [rows])


  const effStart = useMemo(() => (months == null ? null : startForMonths(rows, months)), [rows, months])
  const effEnd   = bounds.max

  // Base de cabeçalho (cards/semanas/ranking). Ao ocultar fechados, subtrai o
  // fluxo dos fundos de condomínio fechado de cada (semana, gestor) — a partir
  // da base por fundo — antes de qualquer agregação.
  const baseRows = useMemo(
    () => (hideFechados ? excludeFechados(rows, fundosSemana, fechados) : rows),
    [hideFechados, rows, fundosSemana, fechados]
  )
  const filtered = useMemo(
    () => filterFluxo(baseRows, { gestor, start: effStart, end: effEnd }),
    [baseRows, gestor, effStart, effEnd]
  )
  const weekly  = useMemo(() => aggregateByWeek(filtered), [filtered])
  const cards   = useMemo(() => {
    const base = computeCards(filtered)
    // Ao ocultar fechados, a contagem estática (lista curada) incluiria os fechados;
    // usa a contagem computada da base já filtrada.
    if (hideFechados) return base
    const metaTipo = meta?.[tipo]
    const staticFundos = gestor
      ? metaTipo?.porGestor?.[gestor]
      : metaTipo?.fundos
    return {
      ...base,
      numFundos: staticFundos ?? base.numFundos,
    }
  }, [filtered, meta, tipo, gestor, hideFechados])
  // Mensal: mesmo gestor/período da seção; agregação por mês (do diário), zero-fill.
  // Fim = último mês COM dado (dataMax, dentro do aggregate), não effEnd — este é a
  // semana-início da base semanal (ex.: 29/06), que escondia o mês corrente (julho)
  // mesmo havendo dado mensal dele. O período só limita o INÍCIO; o fim é "agora".
  const monthlyAgg = useMemo(
    () => aggregateByMonth(filterMensal(monthly, gestor), effStart, null, monthly),
    [monthly, gestor, effStart]
  )
  // Ranking com TODAS as gestoras SEMPRE (filtra so' por periodo, nao por
  // gestor): selecionar uma gestora nao pode esvaziar nem desmontar a tabela --
  // se ela sai do DOM, o grafico (flex) se estica pra direita e o layout pula
  // embaixo do cursor justo quando se quer ir trocando de gestora e comparar.
  const filteredTodasGestoras = useMemo(
    () => filterFluxo(baseRows, { gestor: '', start: effStart, end: effEnd }),
    [baseRows, effStart, effEnd]
  )
  const ranking = useMemo(
    () => mergeRentabilidade(aggregateByGestor(filteredTodasGestoras), rentabilidade),
    [filteredTodasGestoras, rentabilidade]
  )
  // Fundos do gestor selecionado: mesmo gestor/período da seção. Passa pela
  // MESMA via de cálculo do ranking (filtra + agrega), então soma o total do gestor.
  const fundosDoGestor = useMemo(
    () => (gestor
      ? mergeFundos(aggregateByFundo(filterFundos(fundosSemana, { gestor, start: effStart, end: effEnd })), fundosMeta, fechados)
      : []),
    [fundosSemana, fundosMeta, fechados, gestor, effStart, effEnd]
  )
  // Quantos dos fundos do gestor no período são fechados (para rótulo do filtro).
  const numFechadosGestor = useMemo(
    () => fundosDoGestor.reduce((n, f) => n + (f.fechado ? 1 : 0), 0),
    [fundosDoGestor]
  )
  // Aplica o filtro de fundos fechados na tabela de fundos do gestor.
  const fundosVisiveis = useMemo(
    () => (hideFechados ? fundosDoGestor.filter(f => !f.fechado) : fundosDoGestor),
    [fundosDoGestor, hideFechados]
  )

  // Período efetivo (datas reais usadas) e data de referência da base do segmento
  const periodLabel = weekly.length
    ? `Dados de ${fmtWeekFull(weekly[0].weekKey)} a ${fmtWeekFull(weekly[weekly.length - 1].weekKey)}`
    : ''
  const refDate = rows.length ? fmtWeekFull(latestBaseDate(rows)) : null

  const changeTipo   = useCallback(t => { setTipo(t); setGestor('') }, [])     // mantém o período
  const clearFilters = useCallback(() => { setGestor(''); setMonths(DEFAULT_MONTHS); setHideFechados(false) }, [])

  return (
    <section className="fluxo" aria-label="Captação dos fundos">
      <header className="fluxo-header">
        <h2 className="fluxo-title">Captação dos Fundos</h2>
        <p className="fluxo-subtitle">Fluxo semanal de fundos de crédito</p>
        {refDate && <p className="fluxo-ref">Base atualizada até {refDate}</p>}
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
        months={months}
        onMonths={setMonths}
        periodLabel={periodLabel}
        onClear={clearFilters}
        disabled={loading}
        defaultMonths={DEFAULT_MONTHS}
        compact={compact}
        hideFechados={hideFechados}
        onHideFechados={setHideFechados}
        fechadosDisponivel={fechados.size > 0}
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
          <p className="error-msg">Não foi possível carregar os dados de {tipoLabel}.</p>
          <small>{error}</small>
          <button className="btn-retry" onClick={reload}>Tentar novamente</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <span>Sem dados de captação</span>
          <small>A base de {tipoLabel} está vazia ou não foi encontrada.</small>
        </div>
      )}

      {!loading && !error && rows.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <span>Nenhuma informação para os filtros</span>
          <small>
            Não existem dados de {tipoLabel}
            {gestor ? ` para o gestor ${gestor}` : ''} no período selecionado.
          </small>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <FluxoSummaryCards cards={cards} />

          {/* Desktop: gráfico (mais estreito) à esquerda + ranking à direita.
              Mobile: empilhados (a classe vira bloco simples). */}
          <div className="fluxo-main-row">
            <Suspense fallback={<div className="state-box"><div className="spinner" aria-label="Carregando gráfico" /></div>}>
              <FluxoChart weekly={weekly} />
            </Suspense>

            {/* SEMPRE montado: selecionar so' filtra o grafico/cards e destaca a
                linha -- as outras gestoras continuam ali. Clicar na ativa desmarca. */}
            <GestorFlowRanking
              ranking={ranking}
              activeGestor={gestor}
              onSelect={g => setGestor(cur => (cur === g ? '' : g))}
            />
          </div>

          {/* Desktop: Semanas + Meses lado a lado (há espaço). Mobile: empilhadas. */}
          <div className="fluxo-tables-row">
            <FluxoTable weekly={weekly} />
            <FluxoMonthlyTable months={monthlyAgg} hideFechados={hideFechados} />
          </div>

          <SensibilidadeCorte tipo={tipo} />

          {/* Ao filtrar por um gestor: lista de fundos que o compõem, mesmas colunas do ranking. */}
          {gestor && (
            <FundoFlowTable
              fundos={fundosVisiveis}
              gestor={gestor}
              hideFechados={hideFechados}
              numFechados={numFechadosGestor}
            />
          )}

          {invalid > 0 && (
            <p className="fluxo-note">{invalid} linha(s) ignorada(s) por dados inválidos.</p>
          )}
        </>
      )}
    </section>
  )
}

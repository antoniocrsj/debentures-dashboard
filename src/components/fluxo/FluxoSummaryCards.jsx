import { fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

export default function FluxoSummaryCards({ cards }) {
  const liqPos = cards.liquido > 0
  const liqNeg = cards.liquido < 0

  return (
    <div className="fluxo-cards" aria-label="Indicadores do período">
      <Card label="Captação acumulada" value={fmtFluxo(cards.captacao)} />
      <Card label="Resgates acumulados" value={fmtFluxo(cards.resgate)} />

      {/* Líquido: sinal textual + ícone, não depende só de cor */}
      <div className={`fluxo-card fluxo-card-liquido${liqPos ? ' pos' : liqNeg ? ' neg' : ''}`}>
        <span className="fluxo-card-label">Captação líquida</span>
        <span className="fluxo-card-value">
          <span className="liq-arrow" aria-hidden="true">{liqPos ? '▲' : liqNeg ? '▼' : ''}</span>
          {fmtFluxoSigned(cards.liquido)}
        </span>
        <span className="sr-only">{liqPos ? 'positiva' : liqNeg ? 'negativa' : 'neutra'}</span>
      </div>

      <Card label="PL médio" value={fmtFluxo(cards.plMedio)} />
      <Card label="Nº de fundos (média/semana)" value={cards.numFundos ? String(cards.numFundos) : '—'} />
      <Card label="Última semana" value={cards.ultimaSemana ? cards.ultimaSemana.weekLabel : '—'} />
    </div>
  )
}

function Card({ label, value }) {
  return (
    <div className="fluxo-card">
      <span className="fluxo-card-label">{label}</span>
      <span className="fluxo-card-value">{value}</span>
    </div>
  )
}

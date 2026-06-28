import { fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

export default function FluxoSummaryCards({ cards }) {
  const liqPos = cards.liquido > 0
  const liqNeg = cards.liquido < 0

  return (
    <div className="fluxo-cards" aria-label="Indicadores do período">
      {/* Cap. Líquida: sinal textual + ícone, não depende só de cor */}
      <div className={`fluxo-card fluxo-card-liquido${liqPos ? ' pos' : liqNeg ? ' neg' : ''}`}>
        <span className="fluxo-card-label">Cap. Líquida</span>
        <span className="fluxo-card-value">
          <span className="liq-arrow" aria-hidden="true">{liqPos ? '▲' : liqNeg ? '▼' : ''}</span>
          {fmtFluxoSigned(cards.liquido)}
        </span>
        <span className="sr-only">{liqPos ? 'positiva' : liqNeg ? 'negativa' : 'neutra'}</span>
      </div>

      <Card label="Captação acumulada" value={fmtFluxo(cards.captacao)} />
      <Card label="Resgates acumulados" value={fmtFluxo(cards.resgate)} />

      <Card
        label="PL total médio"
        value={fmtFluxo(cards.plTotalMedio)}
        help="Média do patrimônio líquido total semanal no período selecionado"
      />
      <Card
        label="PL mais recente"
        value={fmtFluxo(cards.plRecente)}
        help="Patrimônio líquido total na semana mais recente disponível"
      />
      <Card label="Nº de fundos" sub="(média/semana)" value={cards.numFundos ? String(cards.numFundos) : '—'} />
    </div>
  )
}

function Card({ label, sub, value, help }) {
  return (
    <div className="fluxo-card" title={help || undefined}>
      <span className="fluxo-card-label">
        {label}{sub && <span className="fluxo-card-sub"> {sub}</span>}
        {help && <span className="fluxo-card-help" aria-hidden="true"> ⓘ</span>}
      </span>
      <span className="fluxo-card-value">{value}</span>
    </div>
  )
}

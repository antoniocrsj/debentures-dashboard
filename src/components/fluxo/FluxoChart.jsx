import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { toChartSeries, fmtDayMonthYY, fmtWeekFull, fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

// Paleta quente (identidade Luc), legível sobre o card claro
const COL_CAP = '#8c5e3a'  // captação — terracota
const COL_RES = '#9a8c7a'  // resgate — taupe/cinza quente
const COL_LIQ = '#2a2420'  // cap. líquida — carvão quente, alto contraste
const COL_ZERO = '#94a3b8' // linha do zero — cinza discreto mas visível

// Eixo Y compacto, sem "R$"
const axisFmt = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}bi`
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mi`
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mil`
  return String(v)
}

function FluxoTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">Semana de {fmtWeekFull(label)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_CAP }} />Captação: {fmtFluxoSigned(row.captacao)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_RES }} />Resgate: {fmtFluxoSigned(-row.resgate)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_LIQ }} />Cap. líquida: {fmtFluxoSigned(row.liquido)}</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">PL total: {fmtFluxo(row.plTotal)}</div>
    </div>
  )
}

export default function FluxoChart({ weekly }) {
  if (!weekly || !weekly.length) return null

  const data = toChartSeries(weekly)

  return (
    <div className="fluxo-chart" role="img" aria-label="Gráfico semanal de captação (acima de zero), resgate (abaixo de zero) e captação líquida">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8dfd2" vertical={false} />
          <XAxis
            dataKey="weekKey"
            tickFormatter={fmtDayMonthYY}
            interval="preserveStartEnd"
            minTickGap={44}
            tick={{ fontSize: 11 }}
            tickMargin={6}
          />
          <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11 }} width={44} />
          <ReferenceLine y={0} stroke={COL_ZERO} strokeWidth={1.25} />
          <Tooltip content={<FluxoTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="captacao" name="Captação" fill={COL_CAP} fillOpacity={0.72} radius={[2, 2, 0, 0]} maxBarSize={26} />
          <Bar dataKey="resgateNeg" name="Resgate" fill={COL_RES} fillOpacity={0.72} radius={[0, 0, 2, 2]} maxBarSize={26} />
          <Line dataKey="liquido" name="Cap. líquida" stroke={COL_LIQ} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

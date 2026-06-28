import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { fmtFluxo } from '../../utils/fluxo.js'

const COL_CAP = '#2563eb'  // captação (azul)
const COL_RES = '#f59e0b'  // resgate (âmbar) — fica abaixo de zero
const COL_LIQ = '#0f766e'  // líquido (teal)

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
      <div className="fluxo-tooltip-title">Semana de {label}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_CAP }} />Captação: {fmtFluxo(row.captacao)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_RES }} />Resgate: {fmtFluxo(row.resgate)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_LIQ }} />Líquido: {fmtFluxo(row.liquido)}</div>
    </div>
  )
}

export default function FluxoChart({ weekly }) {
  if (!weekly || !weekly.length) return null

  // resgate plotado negativo (abaixo de zero); guarda valor absoluto p/ tooltip
  const data = weekly.map(w => ({
    weekLabel: w.weekLabel,
    captacao: w.captacao,
    resgate: w.resgate,
    resgateNeg: -w.resgate,
    liquido: w.liquido,
  }))

  // não sobrecarregar o eixo X: ~8 rótulos
  const interval = data.length > 8 ? Math.floor(data.length / 8) : 0

  return (
    <div className="fluxo-chart" role="img" aria-label="Gráfico semanal de captação, resgate e fluxo líquido">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" vertical={false} />
          <XAxis dataKey="weekLabel" interval={interval} tick={{ fontSize: 11 }} tickMargin={6} />
          <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11 }} width={44} />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Tooltip content={<FluxoTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="captacao" name="Captação" fill={COL_CAP} radius={[2, 2, 0, 0]} maxBarSize={26} />
          <Bar dataKey="resgateNeg" name="Resgate" fill={COL_RES} radius={[0, 0, 2, 2]} maxBarSize={26} />
          <Line dataKey="liquido" name="Líquido" stroke={COL_LIQ} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

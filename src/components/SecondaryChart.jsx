import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// Serie temporal de TAXA do mercado secundario. Recebe a serie ja' agregada
// (uma media por pregao dos ativos filtrados): {data, txMin, txMed, txMax, n}.
// Recharts nao le var() -> catalogo Luc.
const COL_MED = '#8c5e3a'   // terracota: a media (linha principal)
const COL_RANGE = '#9a8c7a' // taupe: min/max (o range)
const COL_EIXO = '#2a2420'
const COL_GRID = '#e4d5c3'
const FZ = 9

function dataCurta(iso) {
  const [, m, d] = (iso || '').split('-')
  return (d && m) ? `${d}/${m}` : iso
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  const p = v => v?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{dataCurta(r.data)}{r.n > 1 ? ` · ${r.n} ativos` : ''}</div>
      <div className="fluxo-tooltip-row">Méd: {p(r.txMed)}%</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">mín {p(r.txMin)}% · máx {p(r.txMax)}%</div>
    </div>
  )
}

export default function SecondaryChart({ serie, titulo, nAtivos }) {
  if (!serie || !serie.length) return null
  const media = nAtivos > 1
  return (
    <div className="grafico-card sec-chart-card">
      <p className="tecnico-chart-label">
        <span className="sec-chart-tit">{titulo}</span>
        <span className="sec-chart-pts">
          {media ? `média de ${nAtivos} ativos · ` : ''}{serie.length} {serie.length === 1 ? 'pregão' : 'pregões'}
        </span>
      </p>
      <div className="sec-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COL_GRID} vertical={false} />
            <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fontSize: FZ, fill: COL_EIXO }}
                   tickMargin={4} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }} dx={-26} width={36}
                   domain={['auto', 'auto']} axisLine={false} tickLine={false}
                   tickFormatter={v => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: COL_RANGE, strokeDasharray: '3 3' }} />
            <Line type="monotone" dataKey="txMax" stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="txMed" stroke={COL_MED} strokeWidth={2} dot={{ r: 2.5, fill: COL_MED }} isAnimationActive={false} />
            <Line type="monotone" dataKey="txMin" stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

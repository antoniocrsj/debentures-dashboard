import {
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COL_VOLUME = '#8c5e3a'
const COL_CLARA = '#9a8c7a'
const COL_TRADES = COL_CLARA
const COL_EIXO = '#2a2420'
const COL_GRID = '#d8c9b8'
const FZ = 9

function dataCurta(iso) {
  const [, mes, dia] = (iso || '').split('-')
  return dia && mes ? `${dia}/${mes}` : iso
}

function fmtVolume(v) {
  if (!Number.isFinite(v)) return '-'
  if (Math.abs(v) >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mi`
  return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
}

function eixoVolume(v) {
  const umaCasa = valor => valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (v === 0) return '0,0'
  if (Math.abs(v) >= 1e9) return `${umaCasa(v / 1e9)} bi`
  if (Math.abs(v) >= 1e6) return `${umaCasa(v / 1e6)} mi`
  return `${umaCasa(v / 1e3)} mil`
}

function passoVolumeFlexivel(maiorVolume) {
  const passos = [
    1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
    100_000, 200_000, 500_000,
    1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000,
    50_000_000, 100_000_000, 200_000_000, 500_000_000,
  ]
  const passoIdeal = maiorVolume / 8
  return passos.find(passo => passo >= passoIdeal) || 500_000_000
}

function WeeklyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const ponto = payload[0]?.payload
  if (!ponto) return null

  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">
        {dataCurta(ponto.inicio)} a {dataCurta(ponto.fim)}
      </div>
      <div className="fluxo-tooltip-row">Volume: {fmtVolume(ponto.volume)}</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">
        Trades: {ponto.trades.toLocaleString('pt-BR')}
      </div>
    </div>
  )
}

export default function SecondaryWeeklyChart({ serie }) {
  if (!serie?.length) return null

  const maiorVolume = Math.max(...serie.map(ponto => ponto.volume || 0))
  const passoVolume = passoVolumeFlexivel(maiorVolume)
  const tetoVolume = Math.max(passoVolume, Math.ceil(maiorVolume / passoVolume) * passoVolume)
  const ticksVolume = Array.from(
    { length: Math.floor(tetoVolume / passoVolume) + 1 },
    (_, i) => i * passoVolume,
  )

  return (
    <div className="grafico-card sec-weekly-card" role="img" aria-label="Volume total e numero de trades por semana">
      <p className="tecnico-chart-label">
        <span className="sec-chart-tit">Volume e trades semanais</span>
        <span className="sec-weekly-legend" aria-hidden="true">
          <i className="volume" />Volume <i className="trades" />Trades
        </span>
      </p>
      <div className="sec-weekly-plot">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barGap={2}>
            <XAxis
              dataKey="inicio"
              tickFormatter={dataCurta}
              tick={{ fontSize: FZ, fill: COL_EIXO }}
              tickMargin={4}
              axisLine={{ stroke: COL_CLARA, strokeWidth: 1 }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              yAxisId="volume"
              tickFormatter={eixoVolume}
              ticks={ticksVolume}
              domain={[0, tetoVolume]}
              interval={0}
              allowDataOverflow
              tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }}
              dx={-30}
              width={40}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="trades"
              orientation="right"
              allowDecimals={false}
              tickFormatter={v => Math.round(v).toLocaleString('pt-BR')}
              tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'end' }}
              dx={26}
              width={34}
              axisLine={false}
              tickLine={false}
            />
            {ticksVolume.slice(1).map(valor => (
              <ReferenceLine
                key={valor}
                yAxisId="volume"
                y={valor}
                stroke={COL_GRID}
                strokeWidth={0.65}
                strokeDasharray="2 3"
                zIndex={-100}
              />
            ))}
            <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'rgba(140,94,58,.08)' }} />
            <Bar yAxisId="volume" dataKey="volume" fill={COL_VOLUME} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar yAxisId="trades" dataKey="trades" fill={COL_TRADES} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { parseNum } from '../utils/format.js'

// Serie temporal do REUNE para UMA debenture: evolucao de taxa (min/med/max) e
// PU medio ao longo dos dias negociados. Recharts nao le var() -> catalogo Luc.
const COL_MED = '#8c5e3a'   // terracota: a media (linha principal)
const COL_RANGE = '#9a8c7a' // taupe: min/max (o range do dia)
const COL_EIXO = '#2a2420'
const COL_GRID = '#f2ede5'
const FZ = 9

function dataCurta(iso) {
  const [, m, d] = (iso || '').split('-')
  return (d && m) ? `${d}/${m}` : iso
}

function ChartTooltip({ active, payload, modo }) {
  if (!active || !payload || !payload.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{dataCurta(r.data)}</div>
      {modo === 'taxa' ? (
        <>
          <div className="fluxo-tooltip-row">Méd: {r.txMed?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div>
          <div className="fluxo-tooltip-row fluxo-tooltip-pl">mín {r.txMin?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}% · máx {r.txMax?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</div>
        </>
      ) : (
        <div className="fluxo-tooltip-row">PU méd: {r.pu?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      )}
    </div>
  )
}

const MODOS = [
  { id: 'taxa', label: 'Taxa' },
  { id: 'pu',   label: 'PU' },
]

export default function SecondaryChart({ serie, ativo, grupo }) {
  const [modo, setModo] = useState('taxa')

  const dados = useMemo(() => (serie || [])
    .map(r => ({
      data: r.data,
      txMin: parseNum(r.taxaMin), txMed: parseNum(r.taxaMed), txMax: parseNum(r.taxaMax),
      pu: parseNum(r.puMed),
    }))
    .filter(d => d.data)
    .sort((a, b) => a.data.localeCompare(b.data)),
  [serie])

  if (!dados.length) return null

  return (
    <div className="grafico-card sec-chart-card">
      <p className="tecnico-chart-label">
        {ativo}{grupo && <span className="sec-chart-grupo"> · {grupo}</span>}
        <span className="sec-chart-pts">{dados.length} {dados.length === 1 ? 'pregão' : 'pregões'}</span>
        <span className="segmented tecnico-unidade" role="tablist" aria-label="Métrica do gráfico">
          {MODOS.map(m => (
            <button key={m.id} type="button" role="tab" aria-selected={modo === m.id}
              className={`segmented-btn${modo === m.id ? ' active' : ''}`}
              onClick={() => setModo(m.id)}>{m.label}</button>
          ))}
        </span>
      </p>
      <div className="sec-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COL_GRID} vertical={false} />
            <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fontSize: FZ, fill: COL_EIXO }}
                   tickMargin={4} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }} dx={-24} width={34}
                   domain={['auto', 'auto']} axisLine={false} tickLine={false}
                   tickFormatter={v => modo === 'taxa' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} />
            <Tooltip content={<ChartTooltip modo={modo} />} cursor={{ stroke: COL_RANGE, strokeDasharray: '3 3' }} />
            {modo === 'taxa' ? (
              <>
                <Line type="monotone" dataKey="txMax" stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="txMed" stroke={COL_MED} strokeWidth={2} dot={{ r: 2.5, fill: COL_MED }} isAnimationActive={false} />
                <Line type="monotone" dataKey="txMin" stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </>
            ) : (
              <Line type="monotone" dataKey="pu" stroke={COL_MED} strokeWidth={2} dot={{ r: 2.5, fill: COL_MED }} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

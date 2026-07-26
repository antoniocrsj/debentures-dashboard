import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// Serie temporal do mercado secundario. Por padrao mostra o SPREAD sobre a
// referencia (CDI+ p/ DI/%DI, DI+ p/ Pre, NTN-B+ em bps p/ IPCA) -- vem pronto
// de spreadRef. Se o foco nao tiver spread calculavel, cai no modo 'taxa' (rate
// cru). Recebe {pontos, modo, unidade, refLabel} desmembrado em props.
// Recharts nao le var() -> catalogo Luc.
const COL_MED = '#8c5e3a'   // terracota: a media (linha principal)
const COL_RANGE = '#9a8c7a' // taupe: min/max (o range)
const COL_EIXO = '#2a2420'
const COL_GRID = '#e4d5c3'
const FZ = 9
const MINUS = '−'           // menos tipografico (igual ao resto do app)

function dataCurta(iso) {
  const [, m, d] = (iso || '').split('-')
  return (d && m) ? `${d}/${m}` : iso
}

// Spread formatado conforme a unidade: bps -> inteiro; % -> 2 casas. Com sinal.
function fmtSpread(v, unidade) {
  if (v == null || isNaN(v)) return '-'
  const sinal = v < 0 ? MINUS : '+'
  if (unidade === 'bps') return `${sinal}${Math.abs(Math.round(v))} bps`
  return `${sinal}${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function ChartTooltip({ active, payload, modo, unidade, refLabel }) {
  if (!active || !payload || !payload.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  if (modo === 'spread') {
    return (
      <div className="fluxo-tooltip">
        <div className="fluxo-tooltip-title">{dataCurta(r.data)}{r.n > 1 ? ` · ${r.n} ativos` : ''}</div>
        <div className="fluxo-tooltip-row">{refLabel} {fmtSpread(r.spMed, unidade)}</div>
        {r.n > 1 && (
          <div className="fluxo-tooltip-row fluxo-tooltip-pl">
            faixa {fmtSpread(r.spMin, unidade)} · {fmtSpread(r.spMax, unidade)}
          </div>
        )}
      </div>
    )
  }
  const p = v => v?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{dataCurta(r.data)}{r.n > 1 ? ` · ${r.n} ativos` : ''}</div>
      <div className="fluxo-tooltip-row">Méd: {p(r.txMed)}%</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">mín {p(r.txMin)}% · máx {p(r.txMax)}%</div>
    </div>
  )
}

export default function SecondaryChart({ serie, titulo, nAtivos, modo = 'taxa', unidade, refLabel }) {
  if (!serie || !serie.length) return null
  const media = nAtivos > 1
  const spread = modo === 'spread'
  const kMed = spread ? 'spMed' : 'txMed'
  const kMin = spread ? 'spMin' : 'txMin'
  const kMax = spread ? 'spMax' : 'txMax'
  const yFmt = spread && unidade === 'bps'
    ? (v => (v < 0 ? MINUS : '') + Math.abs(Math.round(v)))
    : (v => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))
  const refTxt = spread ? `spread s/ ${refLabel}${unidade === 'bps' ? ' (bps)' : ''}` : null

  return (
    <div className="grafico-card sec-chart-card">
      <p className="tecnico-chart-label">
        <span className="sec-chart-tit">{titulo}</span>
        <span className="sec-chart-pts">
          {refTxt ? `${refTxt} · ` : ''}{media ? `média de ${nAtivos} ativos · ` : ''}{serie.length} {serie.length === 1 ? 'pregão' : 'pregões'}
        </span>
      </p>
      <div className="sec-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COL_GRID} vertical={false} />
            <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fontSize: FZ, fill: COL_EIXO }}
                   tickMargin={4} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }} dx={-26} width={36}
                   domain={['auto', 'auto']} axisLine={false} tickLine={false} tickFormatter={yFmt} />
            <Tooltip content={<ChartTooltip modo={modo} unidade={unidade} refLabel={refLabel} />} cursor={{ stroke: COL_RANGE, strokeDasharray: '3 3' }} />
            <Line type="monotone" dataKey={kMax} stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey={kMed} stroke={COL_MED} strokeWidth={2} dot={{ r: 2.5, fill: COL_MED }} isAnimationActive={false} />
            <Line type="monotone" dataKey={kMin} stroke={COL_RANGE} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

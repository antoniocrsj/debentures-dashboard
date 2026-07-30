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

// Ticks do eixo Y (= gridlines) em multiplos de 10 bps (0,10% no CDI), com no
// maximo 7 linhas. Em amplitudes maiores, sobe para 20/30/40/50 bps etc.
function gridTicks(lo, hi, unidade) {
  const nice = unidade === 'bps'
    ? [10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 5000]
    : [0.10, 0.20, 0.30, 0.40, 0.50, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00]
  const dec = unidade === 'bps' ? 0 : 2
  const f = 10 ** dec

  for (const step of nice) {
    const ticks = []
    for (let i = Math.ceil((lo - 1e-9) / step); i * step <= hi + 1e-9; i++) {
      ticks.push(Math.round(i * step * f) / f)
    }
    if (ticks.length <= 7) return ticks
  }
  return []
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

export default function SecondaryChart({ serie, titulo, modo = 'taxa', unidade, refLabel }) {
  if (!serie || !serie.length) return null
  const spread = modo === 'spread'
  const kMed = spread ? 'spMed' : 'txMed'
  const kMin = spread ? 'spMin' : 'txMin'
  const kMax = spread ? 'spMax' : 'txMax'
  const yFmt = spread && unidade === 'bps'
    ? (v => (v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
    : (v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

  // Eixo Y (modo spread): TRAVA uma janela de +/-30 bps (60 no total) centrada
  // nos dados, p/ a escala nao variar entre ativos. Se a amplitude passar de 60,
  // expande p/ nao cortar. CDI (spread nao-negativo) trava o piso em 0; IPCA/
  // NTN-B pode ir a negativo (NTN-B-). bps -> +/-30; CDI (%) -> +/-0,30.
  let yDomain = ['auto', 'auto']
  if (spread) {
    const vals = []
    for (const p of serie) {
      if (p[kMin] != null) vals.push(p[kMin])
      if (p[kMax] != null) vals.push(p[kMax])
      if (p[kMed] != null) vals.push(p[kMed])
    }
    if (vals.length) {
      const HALF = unidade === 'bps' ? 30 : 0.30   // meia-janela base: +/-30 bps
      const PAD = unidade === 'bps' ? 20 : 0.20     // folga do dado ao eixo qdo expande
      const lo0 = Math.min(...vals), hi0 = Math.max(...vals)
      const centro = (lo0 + hi0) / 2
      // Janela base +/-30. Se o dado extrapola (volatilidade > 60), expande DO
      // lado que estoura deixando PAD (20 bps) de folga -- o extremo nunca cola
      // no eixo/teto.
      let lo = lo0 < centro - HALF ? lo0 - PAD : centro - HALF
      const hi = hi0 > centro + HALF ? hi0 + PAD : centro + HALF
      if (unidade !== 'bps') lo = Math.max(0, lo)   // CDI/DI: nao existe spread negativo
      yDomain = [lo, hi]
    }
  }
  // Gridlines/ticks em multiplos de 10 bps/0,10 p.p., limitadas a 7 linhas.
  const yTicks = (spread && yDomain[0] !== 'auto') ? gridTicks(yDomain[0], yDomain[1], unidade) : undefined

  return (
    <div className="grafico-card sec-chart-card">
      <p className="tecnico-chart-label">
        <span className="sec-chart-tit">{titulo}</span>
      </p>
      <div className="sec-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COL_GRID} vertical={false} syncWithTicks />
            <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fontSize: FZ, fill: COL_EIXO }}
                   tickMargin={4} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }} dx={-26} width={36}
                   domain={yDomain} ticks={yTicks} interval={0} allowDataOverflow
                   axisLine={false} tickLine={false} tickFormatter={yFmt} />
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

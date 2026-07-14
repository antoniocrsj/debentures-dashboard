import { useMemo } from 'react'
import { fmtMes } from '../../utils/caixa.js'

// Grafico de linha (SVG, sem libs) da evolucao do % do PL em caixa, mes a mes.
// Reflete o recorte ativo: soma caixa e PL das linhas do historico que batem com
// (segmento, gestor) por mes e plota caixa/PL. Historico = flat series
// { mes:'yyyyMM', gestor, segmento, caixa, pl } gerado pelo preparar-caixa-potencial.
function pct1(x) { return `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }

export default function CaixaPctPLLine({ historico, segmento, gestor }) {
  const pts = useMemo(() => {
    const series = historico?.series
    if (!Array.isArray(series) || !series.length) return []
    const byMes = new Map()
    for (const r of series) {
      if (segmento && r.segmento !== segmento) continue
      if (gestor && r.gestor !== gestor) continue
      let o = byMes.get(r.mes)
      if (!o) { o = { caixa: 0, pl: 0 }; byMes.set(r.mes, o) }
      o.caixa += r.caixa || 0
      o.pl += r.pl || 0
    }
    const meses = historico.meses?.length ? historico.meses : [...byMes.keys()].sort()
    return meses
      .map(m => { const o = byMes.get(m); return { mes: m, pct: o && o.pl > 0 ? o.caixa / o.pl : null } })
      .filter(p => p.pct != null)
  }, [historico, segmento, gestor])

  const escopo = gestor || (segmento === '12431' ? 'Incentivados' : 'Tradicional')

  if (pts.length < 2) {
    return (
      <div className="caixa-trend">
        <div className="caixa-trend-head">
          <h3 className="fluxo-section-title">% do PL em caixa — evolução mensal</h3>
        </div>
        <div className="caixa-line-empty">
          {historico?.series?.length
            ? `Sem histórico suficiente para ${escopo} nesta janela.`
            : <>Sem histórico de %PL ainda. Rode <code>preparar-caixa-potencial.ps1</code> para gerar <code>Caixa_Potencial_Historico.json</code>.</>}
        </div>
      </div>
    )
  }

  // Geometria
  const W = 680, H = 240, padL = 42, padR = 14, padT = 16, padB = 30
  const iw = W - padL - padR, ih = H - padT - padB
  const maxV = Math.max(...pts.map(p => p.pct))
  const top = maxV > 0 ? maxV * 1.12 : 0.01     // headroom; base em 0
  const x = i => padL + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
  const y = v => padT + ih - (v / top) * ih
  const linePts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => (top * k) / ticks)
  const step = Math.max(1, Math.ceil(pts.length / 8))   // no max ~8 rotulos no eixo x
  const last = pts[pts.length - 1]

  return (
    <div className="caixa-trend">
      <div className="caixa-trend-head">
        <h3 className="fluxo-section-title">% do PL em caixa — evolução mensal</h3>
        <span className="fluxo-ranking-sub">
          {escopo} · caixa direto (disp.+títulos púb.+compromissadas) ÷ PL · atual <b>{pct1(last.pct)}</b>
        </span>
      </div>
      <svg className="caixa-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`% do PL em caixa por mês — ${escopo}`}>
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="caixa-line-grid" />
            <text x={padL - 6} y={y(v) + 3} className="caixa-line-ylabel" textAnchor="end">{pct1(v)}</text>
          </g>
        ))}
        <polyline className="caixa-line-path" points={linePts} fill="none" />
        {pts.map((p, i) => (
          <circle key={p.mes} cx={x(i)} cy={y(p.pct)} r="2.6" className="caixa-line-dot">
            <title>{`${fmtMes(p.mes)}: ${pct1(p.pct)}`}</title>
          </circle>
        ))}
        {pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? (
          <text key={'x' + p.mes} x={x(i)} y={H - 10} className="caixa-line-xlabel" textAnchor="middle">{fmtMes(p.mes)}</text>
        ) : null)}
      </svg>
    </div>
  )
}

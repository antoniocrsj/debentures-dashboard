import { useMemo, useRef, useState, useCallback } from 'react'
import { fmtMes } from '../../utils/caixa.js'

// Grafico de linha (SVG, sem libs) da evolucao do % do PL em caixa, mes a mes.
// Reflete o recorte ativo: soma caixa e PL das linhas do historico que batem com
// (segmento, gestor) por mes e plota caixa/PL. Historico = flat series
// { mes:'yyyyMM', gestor, segmento, caixa, pl } gerado pelo preparar-caixa-potencial.
//
// O SVG e' desenhado 1:1 (viewBox = largura REAL medida do container, via
// ResizeObserver) em vez de um viewBox fixo esticado por CSS. Sem isso, no
// compacto o viewBox de 680 era encolhido p/ ~340 (0,5x) e a fonte dos eixos
// aparecia pela metade (10px -> 5px, ilegivel). Assim 13px e' 13px em qualquer tela.
function pct1(x) { return `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }

const PAD = { l: 52, r: 16, t: 14, b: 34 }

export default function CaixaPctPLLine({ historico, segmento, gestor }) {
  // Mede largura E altura do container: a altura do card vem do CSS (como o
  // .fluxo-chart da Captacao: 350px no desktop / 300px no compacto) e o SVG
  // preenche o espaco que sobra. Assim o grafico acompanha o padrao da Captacao
  // sem numero magico no JS.
  const [{ W, H }, setBox] = useState({ W: 680, H: 260 })
  const roRef = useRef(null)
  // Callback ref (e nao useEffect+[]): o grafico so' monta DEPOIS que o historico
  // carrega -- na 1a montagem o componente esta' no estado vazio e o ref e' null,
  // entao um useEffect([]) anexaria o observer a nada e o viewBox ficaria preso
  // no valor inicial (fonte encolhendo de novo). O callback ref dispara no
  // momento exato em que o <div> do grafico entra/sai do DOM.
  const wrapRef = useCallback(node => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node || typeof ResizeObserver === 'undefined') return
    const read = (w, h) => setBox({ W: Math.max(260, Math.round(w) || 680), H: Math.max(160, Math.round(h) || 260) })
    const r = node.getBoundingClientRect()
    read(r.width, r.height)
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect
      if (cr) read(cr.width, cr.height)
    })
    ro.observe(node)
    roRef.current = ro
  }, [])

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

  // Geometria (em px reais: W vem medido do container)
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const maxV = Math.max(...pts.map(p => p.pct))
  const top = maxV > 0 ? maxV * 1.12 : 0.01     // headroom; base em 0
  const x = i => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
  const y = v => PAD.t + ih - (v / top) * ih
  const linePts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const yTicks = Array.from({ length: 5 }, (_, k) => (top * k) / 4)
  // Rotulos do eixo X conforme a largura real (~1 a cada 76px) -> nao empilha no compacto.
  const maxLabels = Math.max(3, Math.floor(iw / 76))
  const step = Math.max(1, Math.ceil(pts.length / maxLabels))

  return (
    <div className="caixa-trend">
      <div className="caixa-trend-head">
        <h3 className="fluxo-section-title">% do PL em caixa — evolução mensal</h3>
      </div>
      <div className="caixa-line-wrap" ref={wrapRef}>
        <svg className="caixa-line" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
             role="img" aria-label={`% do PL em caixa por mês — ${escopo}`}>
          {yTicks.map((v, k) => (
            <g key={k}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="caixa-line-grid" />
              <text x={PAD.l - 8} y={y(v) + 4} className="caixa-line-ylabel" textAnchor="end">{pct1(v)}</text>
            </g>
          ))}
          <polyline className="caixa-line-path" points={linePts} fill="none" />
          {pts.map((p, i) => (
            <circle key={p.mes} cx={x(i)} cy={y(p.pct)} r="3" className="caixa-line-dot">
              <title>{`${fmtMes(p.mes)}: ${pct1(p.pct)}`}</title>
            </circle>
          ))}
          {pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? (
            <text key={'x' + p.mes} x={x(i)} y={H - 12} className="caixa-line-xlabel" textAnchor="middle">{fmtMes(p.mes)}</text>
          ) : null)}
        </svg>
      </div>
    </div>
  )
}

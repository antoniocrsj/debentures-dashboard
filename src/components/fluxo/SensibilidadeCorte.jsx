import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { fmtBRL } from '../../utils/format.js'
import { useSensibilidadeCorte } from '../../hooks/useSensibilidadeCorte.js'

// Sensibilidade de corte de %Deb: varre o piso de "% do PL em debentures"
// exigido pra um fundo entrar no universo (hoje o corte oficial e' 15%, ver
// selecionar-fundos.ps1 -LimiarPct) e mostra como a captacao REAL responderia
// a um corte diferente, de 10% a 80%. Le o JSON pre-computado (nao recalcula
// no navegador) por tools/gerar-sensibilidade-corte.mjs.

const JANELAS = [
  { id: 'total', label: 'Total' },
  { id: '12m', label: '12m' },
  { id: '6m', label: '6m' },
]
const CORTE_ATUAL = 15   // -LimiarPct de selecionar-fundos.ps1 (curadoria oficial hoje)
const PAD = { l: 56, r: 20, t: 14, b: 30 }

function niceStep(raw) {
  if (!(raw > 0)) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}
function fmtCompacto(v) {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (a >= 1e3) return `${s}${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `${s}${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

export default function SensibilidadeCorte({ tipo }) {
  const { data, loading } = useSensibilidadeCorte()
  const [janela, setJanela] = useState('total')
  const [corte, setCorte] = useState(CORTE_ATUAL)

  const pontos = data?.porSegmento?.[tipo]?.[janela] || null

  // Se o segmento/janela mudar e o corte atual nao existir mais na grade (nao
  // deveria acontecer, grade e' fixa 10-80, mas protege contra JSON antigo/parcial).
  useEffect(() => {
    if (pontos && pontos.length && !pontos.some(p => p.corte === corte)) {
      setCorte(pontos[0].corte)
    }
  }, [pontos, corte])

  const [{ W, H }, setBox] = useState({ W: 640, H: 220 })
  const roRef = useRef(null)
  const wrapRef = useCallback(node => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node || typeof ResizeObserver === 'undefined') return
    const read = (w, h) => setBox({ W: Math.max(260, Math.round(w) || 640), H: Math.max(140, Math.round(h) || 220) })
    const r = node.getBoundingClientRect()
    read(r.width, r.height)
    const ro = new ResizeObserver(entries => { const cr = entries[0]?.contentRect; if (cr) read(cr.width, cr.height) })
    ro.observe(node)
    roRef.current = ro
  }, [])

  const chart = useMemo(() => {
    if (!pontos || pontos.length < 2) return null
    const xs = pontos.map(p => p.corte)
    const ys = pontos.map(p => p.liquido)
    const minX = xs[0], maxX = xs[xs.length - 1]
    const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys)
    const step = niceStep((maxY - minY) / 4 || 1)
    const ticks = []
    for (let v = Math.ceil(minY / step) * step; v <= maxY + 1e-6; v += step) ticks.push(Math.round(v))
    const x = c => PAD.l + ((c - minX) / (maxX - minX || 1)) * (W - PAD.l - PAD.r)
    const y = v => H - PAD.b - ((v - minY) / (maxY - minY || 1)) * (H - PAD.t - PAD.b)
    const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.corte)},${y(p.liquido)}`).join(' ')
    const selecionado = pontos.find(p => p.corte === corte) || pontos[0]
    return { x, y, ticks, path, selecionado, y0: y(0) }
  }, [pontos, corte, W, H])

  if (loading) return null
  if (!data) {
    return (
      <div className="fluxo-sens-empty">
        Sensibilidade de corte ainda não gerada. Rode <code>selecionar-fundos.ps1</code> e depois{' '}
        <code>preparar-fluxo.ps1 -IncluirCandidatos</code> (ou <code>atualizar-tudo.ps1 -Sensibilidade</code>).
      </div>
    )
  }
  if (!pontos || !pontos.length) return null

  const sel = pontos.find(p => p.corte === corte) || pontos[0]

  return (
    <div className="fluxo-sens">
      <div className="fluxo-sens-head">
        <h3 className="fluxo-section-title">Sensibilidade de corte (% do PL em debêntures)</h3>
        <div className="segmented caixa-periodo fluxo-sens-janela" role="tablist" aria-label="Janela de tempo">
          {JANELAS.map(j => (
            <button key={j.id} type="button" role="tab" aria-selected={janela === j.id}
              className={`segmented-btn${janela === j.id ? ' active' : ''}`}
              onClick={() => setJanela(j.id)}>{j.label}</button>
          ))}
        </div>
      </div>
      <p className="fluxo-sens-sub">
        O corte oficial hoje é <strong>{CORTE_ATUAL}%</strong>. Arraste para ver como a captação responderia a um
        corte diferente — dados reais do universo candidato, não estimativa.
      </p>

      <div className="fluxo-sens-slider-row">
        <input
          type="range" min={pontos[0].corte} max={pontos[pontos.length - 1].corte} step={1}
          value={sel.corte} onChange={e => setCorte(Number(e.target.value))}
          className="fluxo-sens-slider" aria-label="Corte de %Deb"
        />
        <span className="fluxo-sens-slider-val">{sel.corte}%</span>
      </div>

      <div className="fluxo-cards fluxo-sens-cards">
        <div className="fluxo-card"><span className="fluxo-card-label">Fundos no corte</span><span className="fluxo-card-value">{sel.numFundos}</span></div>
        <div className="fluxo-card"><span className="fluxo-card-label">PL</span><span className="fluxo-card-value">{fmtBRL(sel.pl)}</span></div>
        <div className="fluxo-card"><span className="fluxo-card-label">Captação</span><span className="fluxo-card-value">{fmtBRL(sel.captacao)}</span></div>
        <div className="fluxo-card"><span className="fluxo-card-label">Resgate</span><span className="fluxo-card-value">{fmtBRL(sel.resgate)}</span></div>
        <div className={`fluxo-card fluxo-card-liquido ${sel.liquido >= 0 ? 'pos' : 'neg'}`}>
          <span className="fluxo-card-label">Líquido</span><span className="fluxo-card-value">{fmtBRL(sel.liquido)}</span>
        </div>
      </div>

      {chart && (
        <div className="caixa-line-wrap fluxo-sens-chart-wrap" ref={wrapRef}>
          <svg className="caixa-line" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {chart.ticks.map(v => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={chart.y(v)} y2={chart.y(v)} className="caixa-line-grid" />
                <text x={PAD.l - 8} y={chart.y(v) + 4} className="caixa-line-ylabel" textAnchor="end">{fmtCompacto(v)}</text>
              </g>
            ))}
            <line x1={PAD.l} x2={W - PAD.r} y1={chart.y0} y2={chart.y0} className="fluxo-sens-zero" />
            <line x1={chart.x(CORTE_ATUAL)} x2={chart.x(CORTE_ATUAL)} y1={PAD.t} y2={H - PAD.b} className="fluxo-sens-ref" />
            <text x={chart.x(CORTE_ATUAL)} y={PAD.t - 2} className="fluxo-sens-ref-label" textAnchor="middle">corte atual</text>
            <path d={chart.path} className="caixa-line-path" fill="none" />
            <circle cx={chart.x(sel.corte)} cy={chart.y(sel.liquido)} r="5" className="caixa-line-dot" />
            <text x={PAD.l} y={H - 10} className="caixa-line-xlabel" textAnchor="start">{pontos[0].corte}%</text>
            <text x={W - PAD.r} y={H - 10} className="caixa-line-xlabel" textAnchor="end">{pontos[pontos.length - 1].corte}%</text>
          </svg>
        </div>
      )}
      <p className="fluxo-sens-foot">Universo candidato — {tipo === '12431' ? '12.431' : 'Tradicional'}, ancorado em {data.anchorKey}.</p>
    </div>
  )
}

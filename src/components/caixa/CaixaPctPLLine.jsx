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

// Passo "redondo" (1/2/5 x 10^n) p/ os rotulos do eixo cairem em valores limpos.
function niceStep(raw) {
  if (!(raw > 0)) return 0.01
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

// r=26: o rotulo do ULTIMO mes e' centrado em x = W - PAD.r; com r=16 metade de
// "jun/26" (~20px) vazava do viewBox e o mes aparecia cortado.
const PAD_LARGO = { l: 52, r: 20, t: 14, b: 52 }   /* b maior: rotulo vertical ocupa altura */
// Grafico ESTREITO (ex.: as celulas de ~300px do grid da aba Tecnico): o PAD
// largo comia 26% da largura so' com rotulo de eixo, e o LBL_W de 46px fazia a
// regua achar que so' cabiam 4 meses numa janela de 6 -- resultado: "mar/26
// jun/26" e nenhuma ideia de QUANDO a curva se moveu. Aqui a folga encolhe e o
// rotulo passa a ser medido pelo que ele realmente ocupa (~34px a 11px).
const PAD_ESTREITO = { l: 28, r: 10, t: 8, b: 42 }   /* b maior: rotulo vertical ocupa altura */   /* card compacto da Tecnica: cada px de folga sai da curva */
const W_ESTREITO = 460

// Janelas de tempo do grafico (meses recentes; 'total' = serie inteira).
const PERIODOS = [
  { id: 'total', label: 'Total', n: 0 },
  { id: '12m', label: '12m', n: 12 },
  { id: '6m', label: '6m', n: 6 },
]

// `periodo` (prop): quando informado, o grafico fica CONTROLADO por fora (usado
// pela aba Tecnico, que sincroniza este grafico com o periodo da Captacao) e o
// seletor Total/12m/6m interno some -- evita 2 filtros de tempo divergentes na
// mesma tela. Sem a prop, comportamento igual a antes (Caixa sozinha): estado
// e botoes proprios.
export default function CaixaPctPLLine({ historico, segmento, gestor, periodo: periodoProp }) {
  const [periodoState, setPeriodoState] = useState('total')
  const controlled = periodoProp != null
  const periodo = controlled ? periodoProp : periodoState
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
    // Piso de altura 160 -> 70: o 160 vinha de quando este grafico so' existia na
    // aba Caixa, alto. No card compacto da Tecnica a area util e' ~80px, e o piso
    // fazia o SVG desenhar 160 dentro dela -- metade da curva ficava cortada, sem
    // erro nenhum no console. 70 ainda garante eixo + linha legiveis.
    const read = (w, h) => setBox({ W: Math.max(260, Math.round(w) || 680), H: Math.max(70, Math.round(h) || 260) })
    const r = node.getBoundingClientRect()
    read(r.width, r.height)
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect
      if (cr) read(cr.width, cr.height)
    })
    ro.observe(node)
    roRef.current = ro
  }, [])

  const ptsAll = useMemo(() => {
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

  // Recorte da janela de tempo (12m/6m = ultimos N meses disponiveis).
  const pts = useMemo(() => {
    const n = PERIODOS.find(p => p.id === periodo)?.n || 0
    return n > 0 ? ptsAll.slice(-n) : ptsAll
  }, [ptsAll, periodo])

  const escopo = gestor || (segmento === '12431' ? '12.431' : 'Tradicional')
  const Periodos = controlled ? null : (
    <div className="segmented caixa-periodo" role="tablist" aria-label="Período do gráfico">
      {PERIODOS.map(p => (
        <button key={p.id} type="button" role="tab" aria-selected={periodo === p.id}
          className={`segmented-btn${periodo === p.id ? ' active' : ''}`}
          onClick={() => setPeriodoState(p.id)}>{p.label}</button>
      ))}
    </div>
  )

  if (ptsAll.length < 2) {
    return (
      <div className="caixa-trend">
        <div className="caixa-trend-head">
          {!controlled && <h3 className="fluxo-section-title">% do PL em caixa — evolução mensal</h3>}
          {Periodos}
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
  const estreito = W < W_ESTREITO
  const PAD = estreito ? PAD_ESTREITO : PAD_LARGO
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b

  // Escala Y ADAPTATIVA (nao comeca em 0): a serie varia poucos pontos (ex.: 26%
  // a 31%), entao um eixo 0-35% jogava tudo numa faixa de ~15% da altura e a
  // linha virava reta. Aqui a janela acompanha os dados, com folga proporcional
  // e limites arredondados p/ rotulos limpos. Janela MINIMA de 4pp evita
  // transformar ruido em montanha quando a serie e' quase plana. Base fora do
  // zero e' leitura padrao p/ serie temporal de razao -- e' um grafico de LINHA
  // (sem area preenchida), que nao sugere magnitude a partir do zero.
  const vals = pts.map(p => p.pct)
  const dMin = Math.min(...vals), dMax = Math.max(...vals)
  const span = Math.max(dMax - dMin, 0.04)
  const pad = span * 0.25
  const yStep = niceStep((span + 2 * pad) / 4)
  const lo = Math.max(0, Math.floor((dMin - pad) / yStep) * yStep)
  const hi = Math.ceil((dMax + pad) / yStep) * yStep
  const nTicks = Math.max(1, Math.round((hi - lo) / yStep))
  const x = i => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
  const y = v => PAD.t + ih - ((v - lo) / (hi - lo)) * ih
  const linePts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const yTicks = Array.from({ length: nTicks + 1 }, (_, k) => lo + k * yStep)
  // Rotulos do eixo X: so' FINS DE TRIMESTRE (mar/jun/set/dez) + o mes mais
  // recente. Com 42 meses sao 14 trimestres, que nao cabem -- entao a regua
  // rareia (de 2 em 2, 4 em 4...) conforme a largura, mas sempre caindo em fim
  // de trimestre, nunca em mes quebrado. O rareamento conta A PARTIR DO ULTIMO
  // trimestre p/ a ponta recente ficar sempre ancorada.
  const LBL_W = estreito ? 34 : 46
  const last = pts.length - 1
  const cabe = Math.max(2, Math.floor(iw / LBL_W))
  let idx
  if (pts.length <= cabe) {
    // Janela CURTA (ex.: 6m na aba Tecnico): todos os meses cabem, entao mostra
    // todos. A regua de fim-de-trimestre foi pensada p/ 42 meses; aplicada a 6
    // ela rendia so' "mar/26 jun/26" -- dois rotulos p/ uma curva inteira, que
    // nao deixa ler QUANDO a coisa aconteceu. Densidade tem que seguir a
    // janela, nao um calendario fixo.
    idx = pts.map((_, i) => i)
  } else {
    // Serie longa: ancora em fins de trimestre (mar/jun/set/dez) p/ o rotulo
    // nunca cair em mes quebrado, rareando conforme a largura.
    const tri = pts.map((p, i) => ({ i, m: +String(p.mes).slice(4, 6) }))
                   .filter(o => o.m % 3 === 0).map(o => o.i)
    if (!tri.length) {
      idx = [last]
    } else {
      const salto = Math.max(1, Math.ceil(tri.length / cabe))
      idx = tri.filter((_, k) => (tri.length - 1 - k) % salto === 0)
      // o ultimo mes entra sempre; se o trimestre anterior ficaria colado, ele cede a vez
      if (!idx.includes(last)) idx = idx.filter(i => x(last) - x(i) > LBL_W).concat(last)
    }
  }
  const showX = new Set(idx)

  return (
    <div className="caixa-trend">
      {/* Titulo interno so' quando o grafico e' dono da propria caixa (aba Caixa).
          Na Tecnica o card ja' se chama "Caixa" -- este h3 virava um SEGUNDO
          titulo do mesmo grafico, roubando altura do desenho. Mesmo criterio
          que ja' esconde o seletor de periodo interno. */}
      <div className="caixa-trend-head">
        {!controlled && <h3 className="fluxo-section-title">% do PL em caixa — evolução mensal</h3>}
        {Periodos}
      </div>
      <div className="caixa-line-wrap" ref={wrapRef}>
        <svg className="caixa-line" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
             role="img" aria-label={`% do PL em caixa por mês — ${escopo}`}>
          {yTicks.map((v, k) => (
            <g key={k}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="caixa-line-grid" />
              <text x={2} y={y(v) - 3} className="caixa-line-ylabel" textAnchor="start">{pct1(v)}</text>
            </g>
          ))}
          <polyline className="caixa-line-path" points={linePts} fill="none" />
          {/* Pontos INVISIVEIS (fill:transparent no CSS): somem da vista, mas
              continuam sendo o alvo do tooltip de cada mes. r=5 p/ dar area de
              hover confortavel sem aparecer. */}
          {pts.map((p, i) => (
            <circle key={p.mes} cx={x(i)} cy={y(p.pct)} r="5" className="caixa-line-dot">
              <title>{`${fmtMes(p.mes)}: ${pct1(p.pct)}`}</title>
            </circle>
          ))}
          {/* Rotulos de data na VERTICAL: na horizontal, "jan/26 fev/26..." se
              encostava no rotulo do eixo Y e nos vizinhos. Girado -90 o rotulo
              ocupa altura em vez de largura, entao cabem todos os meses sem
              colidir. textAnchor=end + o pivo no proprio ponto mantem o texto
              terminando na base do eixo. */}
          {pts.map((p, i) => showX.has(i) ? (
            <text key={'x' + p.mes} x={x(i)} y={H - PAD.b + 6} className="caixa-line-xlabel"
                  textAnchor="end" transform={`rotate(-90 ${x(i)} ${H - PAD.b + 6})`}>{fmtMes(p.mes)}</text>
          ) : null)}
        </svg>
      </div>
    </div>
  )
}

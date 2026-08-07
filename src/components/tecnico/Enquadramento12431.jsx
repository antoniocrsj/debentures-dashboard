import { useMemo, useState, useEffect } from 'react'
import { Bar, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// Enquadramento 12.431 (aba Técnico) — RANKING por gestora (à esquerda, filtra tudo)
// + CINCO gráficos empilhados, todos no MESMO eixo x (spine jan/24 → dez/27):
//   1. Gap                     — variação do estoque do gap (barra c/ sinal) + nível (linha)
//   2. PL Ref (Fim da Carência)— PL_ref que cruza 6m/24m no mês (barras empilhadas)
//   3. PL Ref (Por Idade)      — PL_ref por faixa 0-6/6-24/>24m (3 linhas)
//   4. Projeção Gap            — demanda a frente +3/+6/+12m por mês-âncora
//   5. Captação líquida        — captação líquida por faixa de idade (barras empilhadas)
// Metade REAL (jan/24 → mar/26) vem do Demanda_Movel; projeção congelada (mar/26 →
// dez/27) vem do serieMensal. Captação é real (Informe Diário, jan/24 → ago/26).
// Modelo em MODELO_Enquadramento_12431.md. Recharts não lê var() -> paleta Luc.
const T = '#8c5e3a', T_CLARO = '#c8a883', T_SEL = '#5f3d22', CARVAO = '#2a2420', MUTED = '#8a7d6c', GRID = '#e4d5c3'
const BACKLOG = '#6f4a2e'   // 1ª barra da série (nível inicial do estoque, não fluxo)
const NEG = '#b08968'       // captação/variação negativa (bege escuro)
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = ym => { const [y, m] = (ym || '').split('-'); return m ? `${MESES[+m - 1]}/${y.slice(2)}` : ym }
// Enumera 'AAAA-MM' de a até b (inclusive). Spine comum dos 5 gráficos.
function enumMonths(a, b) {
  const out = []; let [y, m] = a.split('-').map(Number); const [ey, em] = b.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

const fmtRs = v => {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
  if (a >= 1e6) return `R$ ${Math.round(v / 1e6).toLocaleString('pt-BR')} mi`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
const fmtRsEixo = v => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(0)}bi` : `${Math.round(v / 1e6)}mi`)
const pct0 = v => `${Math.round(v * 100)}%`

// Eixo x compartilhado: rótulos inclinados, 1 a cada 3 meses.
const eixoX = <XAxis dataKey="lbl" tick={{ fontSize: 9, fill: CARVAO }} angle={-45} textAnchor="end" height={38} axisLine={false} tickLine={false} interval={2} />

function MesTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.hist ? ' · real' : ' · projetado'}</div>
      <div className="fluxo-tooltip-row">{r.novo < 0 ? 'Redução do gap' : 'Demanda nova'}: <b>{fmtRs(r.novo)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">Estoque do gap: {fmtRs(r.stock)}</div>
    </div>
  )
}
function AnivTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.hist ? ' · real' : ' · projetado'}</div>
      <div className="fluxo-tooltip-row">6m (carência→67%): <b>{fmtRs(r.t6)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">24m (67%→85%): {fmtRs(r.t24)}</div>
    </div>
  )
}
function BucketsTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.hist ? ' · real' : ' · projetado'}</div>
      <div className="fluxo-tooltip-row">&gt;24m (85%): <b>{fmtRs(r.b3)}</b></div>
      <div className="fluxo-tooltip-row">6–24m (67%): <b>{fmtRs(r.b2)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">0–6m (carência): {fmtRs(r.b1)}</div>
    </div>
  )
}
function MovTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r || r.c12 == null) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">âncora {mesLabel(r.mes)}</div>
      <div className="fluxo-tooltip-row">próx. 12m: <b>{fmtRs(r.c12)}</b>{r.n12 != null ? ` · ${r.n12} fundos` : ''}</div>
      <div className="fluxo-tooltip-row">próx. 6m: <b>{fmtRs(r.c6)}</b>{r.n6 != null ? ` · ${r.n6} fundos` : ''}</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">próx. 3m: {fmtRs(r.c3)}{r.n3 != null ? ` · ${r.n3} fundos` : ''}</div>
    </div>
  )
}
function CapTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r || r.cap1 == null) return null
  const tot = (r.cap1 || 0) + (r.cap2 || 0) + (r.cap3 || 0)
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}</div>
      <div className="fluxo-tooltip-row">&gt;24m: <b>{fmtRs(r.cap3)}</b></div>
      <div className="fluxo-tooltip-row">6–24m: <b>{fmtRs(r.cap2)}</b></div>
      <div className="fluxo-tooltip-row">0–6m: <b>{fmtRs(r.cap1)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">líquida total: {fmtRs(tot)}</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, serie, serieGestora, serieAniv, serieBuckets, demandaMovel, captacao, gestor }) {
  const [sel, setSel] = useState(null)   // gestora selecionada (filtra tabela + todos os gráficos)
  useEffect(() => { setSel(gestor || null) }, [gestor])

  const base = useMemo(() => (rows ? rows.filter(r => !r.semCarteira && r.plRef > 0) : null), [rows])
  const hojeMes = rows?.[0]?.dataHoje?.slice(0, 7) || null

  // Tabela por gestora: compra necessária somada, nos horizontes de 6 e 12 meses.
  const gestoras = useMemo(() => {
    if (!base) return null
    const g = {}
    for (const r of base) {
      const k = r.gestor || '—'; const o = g[k] || (g[k] = { nome: k, c6: 0, c12: 0 })
      o.c6 += Math.max(0, r.compra[6]); o.c12 += Math.max(0, r.compra[12])
    }
    const lista = Object.values(g).filter(o => o.c6 > 0 || o.c12 > 0).sort((a, b) => b.c6 - a.c6)
    return { lista, algumEstimado: base.some(r => r.amortEstimada) }
  }, [base])

  const fundos = useMemo(() => {
    if (!base || !sel) return null
    const lista = base.filter(r => (r.gestor || '—') === sel).sort((a, b) => b.compra[6] - a.compra[6])
    return { lista, soma6: lista.reduce((s, r) => s + Math.max(0, r.compra[6]), 0), nDes: lista.filter(r => r.compra[6] > 0).length }
  }, [base, sel])

  // ---- DADOS DOS 5 GRÁFICOS, todos no mesmo spine jan/24 → dez/27 ---------------
  // Histórico REAL (mes < M): Demanda_Movel (c0, t6/t24, b1/b2/b3). Projeção
  // congelada (mes >= M): serieMensal (compra, trig6/trig24, b1/b2/b3). Captação:
  // Informe Diário por mês (subconjunto do spine). Filtra por gestora em tudo.
  const charts = useMemo(() => {
    if (!serie?.length) return null
    const mov = demandaMovel?.serie || []
    const cap = captacao?.serie || []
    const M = serie[0].mes                                   // 1º mês projetado (= BLC fechado)
    const startMes = mov.length ? mov[0].mes : M
    const endMes = serie[serie.length - 1].mes
    const spine = enumMonths(startMes, endMes)

    // séries por gestora (índice-alinhadas com o pai)
    const gMov = sel ? (demandaMovel?.serieGestora?.[sel] || null) : null
    const gAnivH = sel ? (demandaMovel?.serieAnivGestora?.[sel] || null) : null
    const gBktH = sel ? (demandaMovel?.serieBucketGestora?.[sel] || null) : null
    const gProj = sel ? (serieGestora?.[sel] || null) : null
    const gAnivP = sel ? (serieAniv?.[sel] || null) : null
    const gBktP = sel ? (serieBuckets?.[sel] || null) : null
    const gCap = sel ? (captacao?.serieGestora?.[sel] || null) : null
    const zeroSel = !!sel   // gestora sem série numa fonte -> zeros (não some do eixo)

    const movBy = new Map(); mov.forEach((p, i) => movBy.set(p.mes, { p, i }))
    const projBy = new Map(); serie.forEach((p, i) => projBy.set(p.mes, { p, i }))
    const capBy = new Map(); cap.forEach((p, i) => capBy.set(p.mes, { p, i }))

    // nível do estoque do gap por mês (hist c0 / proj compra), p/ a variação (barra)
    const stockOf = mes => {
      if (mes < M) { const e = movBy.get(mes); if (!e) return null; return gMov ? (gMov[e.i]?.c0 ?? 0) : e.p.c0 }
      const e = projBy.get(mes); if (!e) return null; return gProj ? (gProj[e.i] ?? 0) : (zeroSel ? 0 : e.p.compra)
    }
    const stocks = spine.map(stockOf)

    const data = spine.map((mes, idx) => {
      const hist = mes < M
      const eMov = movBy.get(mes), eProj = projBy.get(mes), eCap = capBy.get(mes)
      const stock = stocks[idx], prev = idx > 0 ? stocks[idx - 1] : null
      const novo = stock == null ? null : (prev == null ? stock : stock - prev)
      // aniversário (t6/t24)
      let t6 = null, t24 = null
      if (hist && eMov) { t6 = gAnivH ? (gAnivH[eMov.i]?.t6 ?? 0) : eMov.p.t6; t24 = gAnivH ? (gAnivH[eMov.i]?.t24 ?? 0) : eMov.p.t24 }
      else if (!hist && eProj) { t6 = gAnivP ? (gAnivP[eProj.i]?.t6 ?? 0) : eProj.p.trig6; t24 = gAnivP ? (gAnivP[eProj.i]?.t24 ?? 0) : eProj.p.trig24 }
      // buckets (b1/b2/b3)
      let b1 = null, b2 = null, b3 = null
      if (hist && eMov) { const s = gBktH ? gBktH[eMov.i] : eMov.p; b1 = s?.b1 ?? 0; b2 = s?.b2 ?? 0; b3 = s?.b3 ?? 0 }
      else if (!hist && eProj) { const s = gBktP ? gBktP[eProj.i] : eProj.p; b1 = s?.b1 ?? 0; b2 = s?.b2 ?? 0; b3 = s?.b3 ?? 0 }
      // móvel a frente (+3/+6/+12) — só onde há âncora real (jan/24..M)
      let c3 = null, c6 = null, c12 = null, n3 = null, n6 = null, n12 = null
      if (eMov) { const s = gMov ? gMov[eMov.i] : eMov.p; c3 = s?.c3 ?? 0; c6 = s?.c6 ?? 0; c12 = s?.c12 ?? 0; if (!gMov) { n3 = eMov.p.n3; n6 = eMov.p.n6; n12 = eMov.p.n12 } }
      // captação líquida por faixa (real, jul/25..ago/26)
      let cap1 = null, cap2 = null, cap3 = null
      if (eCap) { const s = gCap ? gCap[eCap.i] : eCap.p; cap1 = s?.cap1 ?? 0; cap2 = s?.cap2 ?? 0; cap3 = s?.cap3 ?? 0 }
      return {
        mes, lbl: mesLabel(mes), hist, futuro: hojeMes ? mes > hojeMes : false, backlog: idx === 0,
        stock, novo, t6, t24, b1, b2, b3, c3, c6, c12, n3, n6, n12, cap1, cap2, cap3,
      }
    })
    const hojeP = data.find(x => x.mes === hojeMes) || data[data.length - 1]
    const hasCap = data.some(x => x.cap1 != null)
    const hasMov = data.some(x => x.c12 != null)
    return { data, M, mBLC: mesLabel(M), hojeAcum: hojeP?.stock, fimAcum: data[data.length - 1]?.stock, fimLbl: data[data.length - 1]?.lbl, hasCap, hasMov }
  }, [serie, serieGestora, serieAniv, serieBuckets, demandaMovel, captacao, sel, hojeMes])

  const toggleSel = g => { if (g) setSel(s => (s === g ? null : g)) }
  const sufixo = sel ? ` · ${sel}` : ''

  return (
    <>
      {/* Coluna ESQUERDA: ranking por gestora (clicar filtra os 5 gráficos) */}
      <div className="grafico-card enq-card-ranking">
        <p className="tecnico-chart-label">Enquadramento 12.431{sel ? ` · ${sel}` : ''}</p>
        <div className="enq-ranking-scroll">
        {!gestoras ? <div className="caixa-line-empty">Carregando enquadramento…</div>
          : gestoras.lista.length === 0 ? <div className="caixa-line-empty">Todas as gestoras enquadradas.</div>
            : (
              <table className="enq-table enq-gestora-table">
                <thead><tr><th>Gestora</th><th className="num">6m</th><th className="num">12m</th></tr></thead>
                <tbody>
                  {gestoras.lista.map((g, i) => (
                    <tr key={i} className={sel === g.nome ? 'sel' : ''} onClick={() => toggleSel(g.nome)}>
                      <td className="enq-fnome" title={g.nome}>{g.nome}</td>
                      <td className="num">{g.c6 > 0 ? fmtRs(g.c6) : '—'}</td>
                      <td className="num">{g.c12 > 0 ? fmtRs(g.c12) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

        {fundos && (
          <div className="enq-fundos">
            <div className="enq-fundos-head">
              <b>{sel}</b>
              <span>{fundos.nDes} desenquadrado{fundos.nDes === 1 ? '' : 's'} · faltam {fmtRs(fundos.soma6)} (6m)</span>
              <button type="button" className="enq-close" onClick={() => setSel(null)}>Fechar</button>
            </div>
            <div className="enq-table-wrap">
              <table className="enq-table">
                <thead><tr><th>Fundo</th><th className="num">Idade</th><th className="num">% atual</th><th className="num">6m</th><th className="num">12m</th></tr></thead>
                <tbody>
                  {fundos.lista.map((f, i) => (
                    <tr key={i} className={f.compra[6] > 0 ? '' : 'enq-ok'}>
                      <td className="enq-fnome" title={f.fundo}>{f.fundo}</td>
                      <td className="num">{f.idadeMeses}m</td>
                      <td className="num">{pct0(f.pctAtual)}</td>
                      <td className="num">{f.compra[6] > 0 ? fmtRs(f.compra[6]) : '—'}</td>
                      <td className="num">{f.compra[12] > 0 ? fmtRs(f.compra[12]) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Coluna DIREITA: 5 gráficos empilhados, mesmo eixo x (jan/24 → dez/27) */}
      <div className="enq-charts-stack">
        {/* 1. Gap — variação do estoque (barra c/ sinal) + nível (linha) */}
        <div className="grafico-card enq-chart">
          <p className="tecnico-chart-label">
            Gap{sufixo}
            {charts && <span className="grafico-kpi"><b>{fmtRs(charts.hojeAcum)}</b><em>estoque hoje → {fmtRs(charts.fimAcum)} em {charts.fimLbl}</em></span>}
          </p>
          {!charts ? <div className="caixa-line-empty">Série indisponível.</div> : (
            <div className="enq-plot">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  {eixoX}
                  <YAxis yAxisId="flow" tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: T }} axisLine={false} tickLine={false} width={36} />
                  <YAxis yAxisId="acum" orientation="right" tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: CARVAO }} axisLine={false} tickLine={false} width={38} />
                  <Tooltip content={<MesTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                  <Bar yAxisId="flow" dataKey="novo" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                    {charts.data.map((p, i) => <Cell key={i} fill={p.backlog ? BACKLOG : (p.novo < 0 ? MUTED : (p.futuro ? T : T_CLARO))} />)}
                  </Bar>
                  <Line yAxisId="acum" type="monotone" dataKey="stock" stroke={CARVAO} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 2. PL Ref (Fim da Carência) — cruza 6m/24m no mês */}
        <div className="grafico-card enq-chart">
          <p className="tecnico-chart-label">
            PL Ref (Fim da Carência){sufixo}
            <span className="enq-mov-leg">
              <span><i style={{ background: T_CLARO }} />6m</span>
              <span><i style={{ background: T_SEL }} />24m</span>
            </span>
          </p>
          {!charts ? <div className="caixa-line-empty">Série indisponível.</div> : (
            <div className="enq-plot">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  {eixoX}
                  <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: CARVAO }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<AnivTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                  <Bar dataKey="t6" stackId="a" fill={T_CLARO} isAnimationActive={false} />
                  <Bar dataKey="t24" stackId="a" fill={T_SEL} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 3. PL Ref (Por Idade) — 0-6/6-24/>24m */}
        <div className="grafico-card enq-chart">
          <p className="tecnico-chart-label">
            PL Ref (Por Idade){sufixo}
            <span className="enq-mov-leg">
              <span><i style={{ background: T_CLARO }} />0–6m</span>
              <span><i style={{ background: T }} />6–24m</span>
              <span><i style={{ background: CARVAO }} />&gt;24m</span>
            </span>
          </p>
          {!charts ? <div className="caixa-line-empty">Série indisponível.</div> : (
            <div className="enq-plot">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  {eixoX}
                  <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: CARVAO }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<BucketsTip />} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} />
                  <Line type="monotone" dataKey="b3" stroke={CARVAO} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="b2" stroke={T} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="b1" stroke={T_CLARO} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 4. Projeção Gap — demanda a frente +3/+6/+12m por âncora (jan/24..mar/26) */}
        <div className="grafico-card enq-chart">
          <p className="tecnico-chart-label">
            Projeção Gap{sufixo}
            <span className="enq-mov-leg">
              <span><i style={{ background: T }} />12m</span>
              <span><i style={{ background: T_SEL }} />6m</span>
              <span><i style={{ background: MUTED }} />3m</span>
            </span>
          </p>
          {!charts ? <div className="caixa-line-empty">Série indisponível.</div> : (
            <div className="enq-plot">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  {eixoX}
                  <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: CARVAO }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<MovTip />} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="c12" stroke={T} strokeWidth={1.8} fill="rgba(140,94,58,0.10)" dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="c6" stroke={T_SEL} strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="c3" stroke={MUTED} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 5. Captação líquida — por faixa de idade (barras empilhadas, c/ sinal) */}
        <div className="grafico-card enq-chart">
          <p className="tecnico-chart-label">
            Captação líquida{sufixo}
            <span className="enq-mov-leg">
              <span><i style={{ background: T_CLARO }} />0–6m</span>
              <span><i style={{ background: T }} />6–24m</span>
              <span><i style={{ background: CARVAO }} />&gt;24m</span>
            </span>
          </p>
          {!charts ? <div className="caixa-line-empty">Série indisponível.</div>
            : !charts.hasCap ? <div className="caixa-line-empty">Captação indisponível (Informe Diário).</div> : (
            <div className="enq-plot">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} stackOffset="sign">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  {eixoX}
                  {/* piso fixo em -15 bi (pedido do usuário); teto auto pelo maior empilhado */}
                  <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 9, fill: CARVAO }} axisLine={false} tickLine={false} width={36} domain={[-15e9, 'dataMax']} />
                  <Tooltip content={<CapTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                  <Bar dataKey="cap1" stackId="c" fill={T_CLARO} isAnimationActive={false} />
                  <Bar dataKey="cap2" stackId="c" fill={T} isAnimationActive={false} />
                  <Bar dataKey="cap3" stackId="c" fill={CARVAO} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <p className="enq-nota">
          Todos no mesmo eixo (jan/24 → dez/27). <b>Real</b> (jan/24 → {charts?.mBLC || 'M'}): carteira 12.431 de cada mês (CDA).
          <b> Projeção</b> ({charts?.mBLC || 'M'} → dez/27): carteira <b>congelada</b> — só a idade avança (fundos param de comprar → o gap cresce a teto).
          <b> Gap</b>: linha = estoque do gap (o que falta comprar); barras = variação no mês (negativa/clara quando encolhe).
          <b> PL Ref (Carência/Idade)</b>: PL de referência (não o PL total) que cruza o degrau / por faixa de idade.
          <b> Projeção Gap</b>: em cada âncora, a compra necessária nos próximos 3/6/12m (sem amortização) — só há âncora real até {charts?.mBLC || 'M'}.
          <b> Captação líquida</b>: aportes − resgates por faixa (Informe Diário, jan/24 → ago/26; só o futuro fica vazio).
          {gestoras?.algumEstimado ? ' Amortização de alguns papéis estimada.' : ''} Idade da 1ª cota (piso jan/23 → coorte pré-2023 cruza 24m junto em jan/25).
        </p>
      </div>
    </>
  )
}

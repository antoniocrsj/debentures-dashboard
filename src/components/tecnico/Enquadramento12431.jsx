import { useMemo, useState, useEffect } from 'react'
import { Bar, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// Enquadramento 12.431 (aba Técnico) — DOIS gráficos:
//  1. Ranking da compra necessária consolidado por GESTORA (clicar numa barra
//     filtra a tabela de fundos E o gráfico mensal).
//  2. Demanda MENSAL: barras = demanda NOVA por mês (fluxo) + linha do ACUMULADO,
//     a partir de M (com degraus 6m/24m e amortização; PL constante).
// Modelo em MODELO_Enquadramento_12431.md. Recharts não lê var() -> paleta Luc.
const T = '#8c5e3a', T_CLARO = '#c8a883', T_SEL = '#5f3d22', CARVAO = '#2a2420', MUTED = '#8a7d6c', GRID = '#e4d5c3'
const BACKLOG = '#6f4a2e'   // 1ª barra (mês M) = backlog pré-existente (estoque, não fluxo)
const HORIZONTES = [{ id: 6, label: '6m' }, { id: 12, label: '12m' }]
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = ym => { const [y, m] = (ym || '').split('-'); return m ? `${MESES[+m - 1]}/${y.slice(2)}` : ym }

const fmtRs = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
  if (a >= 1e6) return `R$ ${Math.round(v / 1e6).toLocaleString('pt-BR')} mi`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
const fmtRsEixo = v => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(0)}bi` : `${Math.round(v / 1e6)}mi`)
const pct0 = v => `${Math.round(v * 100)}%`
const short = nome => { const s = String(nome || ''); return s.length > 15 ? s.slice(0, 14) + '…' : s }

function RankTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{r.nome}</div>
      <div className="fluxo-tooltip-row">Compra: <b>{fmtRs(r.compraH)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{r.sub} · clique p/ filtrar</div>
    </div>
  )
}
function MesTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.backlog ? ' · backlog' : (r.futuro ? ' · projetado' : '')}</div>
      <div className="fluxo-tooltip-row">{r.backlog ? 'Backlog pré-existente' : (r.novo < 0 ? 'Redução do gap' : 'Demanda nova')}: <b>{fmtRs(r.novo)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">Estoque do gap: {fmtRs(r.acum)}</div>
    </div>
  )
}
function MovTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">âncora {mesLabel(r.mes)}</div>
      <div className="fluxo-tooltip-row">próx. 12m: <b>{fmtRs(r.c12)}</b>{r.n12 != null ? ` · ${r.n12} fundos` : ''}</div>
      <div className="fluxo-tooltip-row">próx. 6m: <b>{fmtRs(r.c6)}</b>{r.n6 != null ? ` · ${r.n6} fundos` : ''}</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">próx. 3m: {fmtRs(r.c3)}{r.n3 != null ? ` · ${r.n3} fundos` : ''}</div>
    </div>
  )
}
function AnivTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.futuro ? ' · projetado' : ''}</div>
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
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}</div>
      <div className="fluxo-tooltip-row">&gt;24m (85%): <b>{fmtRs(r.b3)}</b></div>
      <div className="fluxo-tooltip-row">6–24m (67%): <b>{fmtRs(r.b2)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">0–6m (carência): {fmtRs(r.b1)}</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, serie, serieGestora, serieAniv, serieBuckets, demandaMovel, gestor }) {
  const [sel, setSel] = useState(null)   // gestora selecionada (filtra tabela + mensal)
  useEffect(() => { setSel(gestor || null) }, [gestor])

  const base = useMemo(() => (rows ? rows.filter(r => !r.semCarteira && r.plRef > 0) : null), [rows])
  const hojeMes = rows?.[0]?.dataHoje?.slice(0, 7) || null
  const dataM = rows?.[0]?.dataM || null                                    // 'AAAAMM' do BLC fechado
  const mBLC = dataM ? mesLabel(`${dataM.slice(0, 4)}-${dataM.slice(4, 6)}`) : null

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

  // Mensal: barras = demanda NOVA por mês (fluxo), linha = acumulado. Reflete a
  // gestora selecionada (série própria) ou o TOTAL.
  const mensal = useMemo(() => {
    if (!serie?.length) return null
    const firstProj = serie[0].mes   // 1º mês projetado (= M, mar/26)
    // HISTÓRICO (jan/25..M-1): estoque REAL do gap por mês (carteira real de cada
    // mês, do demanda-movel c0). PROJEÇÃO (M..dez/27): estoque projetado (carteira
    // congelada em M, do serieMensal). A linha do tempo emenda no mês M.
    const histSerie = (demandaMovel?.serie || []).filter(p => p.mes < firstProj)
    const gHist = sel ? demandaMovel?.serieGestora?.[sel] : null
    const gProj = sel ? (serieGestora?.[sel] || serie.map(() => 0)) : null
    const stock = [
      ...histSerie.map((p, i) => ({ mes: p.mes, v: gHist ? (gHist[i]?.c0 || 0) : p.c0, hist: true })),
      ...serie.map((p, i) => ({ mes: p.mes, v: gProj ? gProj[i] : p.compra, hist: false })),
    ]
    const data = stock.map((r, i) => ({
      mes: r.mes, lbl: mesLabel(r.mes), futuro: hojeMes ? r.mes > hojeMes : false,
      backlog: i === 0, hist: r.hist,                     // 1ª barra (jan/25) = nível inicial
      novo: i === 0 ? r.v : (r.v - stock[i - 1].v),       // variação do estoque do gap (pode ser negativa)
      acum: r.v,
    }))
    const hojeP = data.find(x => x.mes === hojeMes) || data[data.length - 1]
    return { data, hojeAcum: hojeP.acum, fimAcum: data[data.length - 1].acum, fimLbl: data[data.length - 1].lbl }
  }, [serie, serieGestora, demandaMovel, sel, hojeMes])

  // PL de referência que FAZ ANIVERSÁRIO no mês (gatilho de alocação): 6m
  // (carência→67%) e 24m (67%→85%). Mesma linha do tempo da série mensal; filtra
  // por gestora. Total vem do próprio serie (trig6/trig24); por gestora, de serieAniv.
  const aniv = useMemo(() => {
    if (!serie?.length) return null
    const g = sel ? serieAniv?.[sel] : null
    const data = serie.map((p, i) => {
      const s = g ? (g[i] || { t6: 0, t24: 0 }) : { t6: p.trig6, t24: p.trig24 }
      return { mes: p.mes, lbl: mesLabel(p.mes), futuro: hojeMes ? p.mes > hojeMes : false, t6: s.t6 || 0, t24: s.t24 || 0 }
    })
    return { data }
  }, [serie, serieAniv, sel, hojeMes])

  // PL de referência por FAIXA de idade ao longo da série: 0-6m (carência), 6-24m
  // (67%), >24m (85%). Mostra o PL migrando pelas faixas. Filtra por gestora.
  const buckets = useMemo(() => {
    if (!serie?.length) return null
    const g = sel ? serieBuckets?.[sel] : null
    const data = serie.map((p, i) => {
      const s = g ? (g[i] || { b1: 0, b2: 0, b3: 0 }) : { b1: p.b1, b2: p.b2, b3: p.b3 }
      return { mes: p.mes, lbl: mesLabel(p.mes), b1: s.b1 || 0, b2: s.b2 || 0, b3: s.b3 || 0 }
    })
    return { data }
  }, [serie, serieBuckets, sel])

  // Demanda MÓVEL a frente: por mês-âncora, quanto os fundos precisavam comprar em
  // +3m/+6m (carteira real do mês, sem amortização). Indicador antecedente — não
  // filtra por gestora (é visão de mercado). c0 = foto do mês (referência).
  const mov = useMemo(() => {
    const smov = demandaMovel?.serie
    if (!smov?.length) return null
    // gestora selecionada -> série própria (zeros se a gestora não tem demanda); senão TOTAL
    const g = sel ? (demandaMovel.serieGestora?.[sel] || smov.map(() => ({ c3: 0, c6: 0, c12: 0 }))) : null
    const data = smov.map((p, i) => {
      const s = g ? (g[i] || { c3: 0, c6: 0, c12: 0 }) : p
      return { mes: p.mes, lbl: mesLabel(p.mes), c3: s.c3, c6: s.c6, c12: s.c12, n3: g ? null : p.n3, n6: g ? null : p.n6, n12: g ? null : p.n12 }
    })
    return { data, last: data[data.length - 1] }
  }, [demandaMovel, sel])

  const toggleSel = g => { if (g) setSel(s => (s === g ? null : g)) }

  return (
    <>
      {/* Gráfico 1: tabela por gestora (compra necessária em 6m e 12m) */}
      <div className="grafico-card enq-card-ranking">
        <p className="tecnico-chart-label">Enquadramento 12.431</p>
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

      {/* Gráfico 2: demanda mensal (fluxo + acumulado) */}
      <div className="grafico-card enq-card-mensal">
        <p className="tecnico-chart-label">
          Demanda mensal{sel ? ` · ${sel}` : ''}
          {mensal && <span className="grafico-kpi"><b>{fmtRs(mensal.hojeAcum)}</b><em>acum. hoje → {fmtRs(mensal.fimAcum)} em {mensal.fimLbl}</em></span>}
        </p>
        {!mensal ? <div className="caixa-line-empty">Série mensal indisponível.</div> : (
          <div className="enq-plot enq-plot-mensal">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mensal.data} margin={{ top: 8, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="lbl" tick={{ fontSize: 9, fill: CARVAO }} angle={-45} textAnchor="end" height={40} axisLine={false} tickLine={false} interval={2} />
                {/* Eixo ESQUERDO = fluxo mensal (barras); DIREITO = acumulado (linha).
                    Escalas separadas: senão as torres somem sob o acumulado, que é ~5x maior. */}
                <YAxis yAxisId="flow" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: T }} axisLine={false} tickLine={false} width={38} />
                <YAxis yAxisId="acum" orientation="right" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<MesTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                <Bar yAxisId="flow" dataKey="novo" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                  {mensal.data.map((p, i) => <Cell key={i} fill={p.backlog ? BACKLOG : (p.novo < 0 ? MUTED : (p.futuro ? T : T_CLARO))} />)}
                </Bar>
                <Line yAxisId="acum" type="monotone" dataKey="acum" stroke={CARVAO} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Gráfico 2b: PL que faz aniversário (gatilho de alocação 6m/24m) — mesmo eixo x do mensal */}
      {aniv && (
        <div className="grafico-card enq-card-aniv">
          <p className="tecnico-chart-label">
            PL que faz aniversário{sel ? ` · ${sel}` : ''}
            <span className="enq-mov-leg">
              <span><i style={{ background: T_CLARO }} />6m</span>
              <span><i style={{ background: T_SEL }} />24m</span>
            </span>
          </p>
          <div className="enq-plot enq-plot-aniv">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={aniv.data} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="lbl" tick={{ fontSize: 9, fill: CARVAO }} angle={-45} textAnchor="end" height={40} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<AnivTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                <Bar dataKey="t6" stackId="a" fill={T_CLARO} isAnimationActive={false} />
                <Bar dataKey="t24" stackId="a" fill={T_SEL} isAnimationActive={false} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Gráfico 2c: PL de referência por faixa de idade (0-6/6-24/>24) — mesmo eixo x do mensal */}
      {buckets && (
        <div className="grafico-card enq-card-buckets">
          <p className="tecnico-chart-label">
            PL de referência por idade{sel ? ` · ${sel}` : ''}
            <span className="enq-mov-leg">
              <span><i style={{ background: T_CLARO }} />0–6m</span>
              <span><i style={{ background: T }} />6–24m</span>
              <span><i style={{ background: CARVAO }} />&gt;24m</span>
            </span>
          </p>
          <div className="enq-plot enq-plot-buckets">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={buckets.data} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="lbl" tick={{ fontSize: 9, fill: CARVAO }} angle={-45} textAnchor="end" height={40} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<BucketsTip />} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} />
                <Line type="monotone" dataKey="b3" stroke={CARVAO} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="b2" stroke={T} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="b1" stroke={T_CLARO} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Gráfico 3: demanda MÓVEL a frente (+3m/+6m por mês-âncora) — histórico */}
      {mov && (
        <div className="grafico-card enq-card-movel">
          <p className="tecnico-chart-label">
            Demanda móvel a frente{sel ? ` · ${sel}` : ''}
            <span className="enq-mov-leg">
              <span><i style={{ background: T }} />12m</span>
              <span><i style={{ background: T_SEL }} />6m</span>
              <span><i style={{ background: MUTED }} />3m</span>
            </span>
          </p>
          <div className="enq-plot enq-plot-movel">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mov.data} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="lbl" tick={{ fontSize: 9, fill: CARVAO }} angle={-45} textAnchor="end" height={40} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<MovTip />} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="c12" stroke={T} strokeWidth={2} fill="rgba(140,94,58,0.10)" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="c6" stroke={T_SEL} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="c3" stroke={MUTED} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="enq-nota">
        Tabela: compra p/ atingir o mínimo (carência até 6m · 67% dos 6-24m · 85% após 24m) por gestora, nos horizontes de
        6 e 12 meses (clique numa linha p/ filtrar a tabela de fundos e o mensal). Mensal: <b>linha</b> = estoque do gap (o que
        falta comprar no total); <b>barras</b> = variação no mês (negativa/clara quando o gap encolhe). <b>Jan/25 até {mBLC || 'M'}</b> = histórico
        real (carteira de cada mês); de {mBLC || 'M'} em diante = projeção com a carteira <b>congelada</b> (fundos param de comprar → o gap cresce). Barras claras até hoje, escuras projetado.
        Partindo da última carteira do CDA; elegíveis = só debêntures 12.431 (não capta cotas de FI-Infra){gestoras?.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto.
        {mov && <> Móvel a frente: em cada mês-âncora, quanto os fundos precisavam comprar nos próximos <b>3m</b>/<b>6m</b>/<b>12m</b> (carteira real do mês, sem amortização) — indicador antecedente de demanda por incentivadas. Média mensal; âncora até o CDA maduro.</>}
      </p>
    </>
  )
}

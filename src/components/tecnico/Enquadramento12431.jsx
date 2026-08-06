import { useMemo, useState, useEffect } from 'react'
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'

// Enquadramento 12.431 (aba Técnico) — DOIS gráficos:
//  1. Ranking da compra necessária consolidado por GESTORA (clicar numa barra
//     filtra a tabela de fundos E o gráfico mensal).
//  2. Demanda MENSAL: barras = demanda NOVA por mês (fluxo) + linha do ACUMULADO,
//     a partir de M (com degraus 6m/24m e amortização; PL constante).
// Modelo em MODELO_Enquadramento_12431.md. Recharts não lê var() -> paleta Luc.
const T = '#8c5e3a', T_CLARO = '#c8a883', T_SEL = '#5f3d22', CARVAO = '#2a2420', MUTED = '#8a7d6c', GRID = '#e4d5c3'
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
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.futuro ? ' · projetado' : ''}</div>
      <div className="fluxo-tooltip-row">Demanda nova: <b>{fmtRs(r.novo)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">Acumulado: {fmtRs(r.acum)}</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, serie, serieGestora, gestor }) {
  const [h, setH] = useState(6)
  const [sel, setSel] = useState(null)   // gestora selecionada (filtra tabela + mensal)
  useEffect(() => { setSel(gestor || null) }, [gestor])

  const base = useMemo(() => (rows ? rows.filter(r => !r.semCarteira && r.plRef > 0) : null), [rows])
  const hojeMes = rows?.[0]?.dataHoje?.slice(0, 7) || null
  const dataM = rows?.[0]?.dataM || null                                    // 'AAAAMM' do BLC fechado
  const mBLC = dataM ? mesLabel(`${dataM.slice(0, 4)}-${dataM.slice(4, 6)}`) : null

  const d = useMemo(() => {
    if (!base) return null
    const enquad = base.filter(r => r.compra[h] <= 0).length
    const totalCompra = base.reduce((s, r) => s + Math.max(0, r.compra[h]), 0)
    const g = {}
    for (const r of base) {
      if (r.compra[h] <= 0) continue
      const k = r.gestor || '—'; const o = g[k] || (g[k] = { c: 0, n: 0 })
      o.c += r.compra[h]; o.n++
    }
    const top = Object.entries(g).map(([k, o]) => ({ nome: k, rot: short(k), compraH: o.c, sub: `${o.n} fundo${o.n > 1 ? 's' : ''} desenquadrado${o.n > 1 ? 's' : ''}` }))
      .sort((a, b) => b.compraH - a.compraH).slice(0, 20)
    return { universo: base.length, enquad, totalCompra, top, algumEstimado: base.some(r => r.amortEstimada) }
  }, [base, h])

  const fundos = useMemo(() => {
    if (!base || !sel) return null
    const lista = base.filter(r => (r.gestor || '—') === sel).sort((a, b) => b.compra[h] - a.compra[h])
    return { lista, soma: lista.reduce((s, r) => s + Math.max(0, r.compra[h]), 0), nDes: lista.filter(r => r.compra[h] > 0).length }
  }, [base, sel, h])

  // Mensal: barras = demanda NOVA por mês (fluxo), linha = acumulado. Reflete a
  // gestora selecionada (série própria) ou o TOTAL.
  const mensal = useMemo(() => {
    if (!serie?.length) return null
    const stock = sel ? (serieGestora?.[sel] || serie.map(() => 0)) : serie.map(p => p.compra)
    const data = serie.map((p, i) => ({
      mes: p.mes, lbl: mesLabel(p.mes), futuro: hojeMes ? p.mes > hojeMes : false,
      novo: i === 0 ? stock[0] : Math.max(0, stock[i] - stock[i - 1]),
      acum: stock[i],
    }))
    const hojeP = data.find(x => x.mes === hojeMes) || data[0]
    return { data, hojeAcum: hojeP.acum, fimAcum: data[data.length - 1].acum, fimLbl: data[data.length - 1].lbl }
  }, [serie, serieGestora, sel, hojeMes])

  const clickBar = e => { const g = e?.nome ?? e?.payload?.nome; if (g) setSel(s => (s === g ? null : g)) }

  return (
    <>
      {/* Gráfico 1: ranking por gestora */}
      <div className="grafico-card enq-card-ranking">
        <p className="tecnico-chart-label">
          Enquadramento 12.431
          {d && <span className="grafico-kpi"><b>{d.enquad} de {d.universo}</b><em>enquadrados{d.top.length > 0 ? ` · faltam ${fmtRs(d.totalCompra)}` : ''}</em></span>}
          <span className="segmented tecnico-unidade" role="tablist" aria-label="Horizonte da projeção">
            {HORIZONTES.map(o => (
              <button key={o.id} type="button" role="tab" aria-selected={h === o.id}
                className={`segmented-btn${h === o.id ? ' active' : ''}`} onClick={() => setH(o.id)}>{o.label}</button>
            ))}
          </span>
        </p>
        <div className="enq-ranking-scroll">
        {!d ? <div className="caixa-line-empty">Carregando enquadramento…</div>
          : !d.universo ? <div className="caixa-line-empty">Sem fundos 12.431 no filtro atual.</div>
            : d.top.length === 0 ? <div className="caixa-line-empty">Todas as gestoras enquadradas no horizonte de {h} meses.</div>
              : (
                <div className="enq-plot" style={{ height: d.top.length * 26 + 24 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.top} layout="vertical" margin={{ top: 2, right: 40, bottom: 2, left: 2 }}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tickFormatter={fmtRsEixo} tick={{ fontSize: 9.5, fill: CARVAO }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="rot" width={108} tick={{ fontSize: 9.5, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} />
                      <Tooltip content={<RankTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                      <Bar dataKey="compraH" radius={[0, 3, 3, 0]} isAnimationActive={false} cursor="pointer" onClick={clickBar}>
                        {d.top.map((e, i) => <Cell key={i} fill={sel === e.nome ? T_SEL : T} />)}
                        <LabelList dataKey="compraH" position="right" formatter={fmtRsEixo} style={{ fontSize: 9, fill: MUTED }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

        {fundos && (
          <div className="enq-fundos">
            <div className="enq-fundos-head">
              <b>{sel}</b>
              <span>{fundos.nDes} desenquadrado{fundos.nDes === 1 ? '' : 's'} · faltam {fmtRs(fundos.soma)}</span>
              <button type="button" className="enq-close" onClick={() => setSel(null)}>Fechar</button>
            </div>
            <div className="enq-table-wrap">
              <table className="enq-table">
                <thead><tr><th>Fundo</th><th className="num">Idade</th><th className="num">% atual</th><th className="num">Exigido</th><th className="num">Compra {h}m</th></tr></thead>
                <tbody>
                  {fundos.lista.map((f, i) => (
                    <tr key={i} className={f.compra[h] > 0 ? '' : 'enq-ok'}>
                      <td className="enq-fnome" title={f.fundo}>{f.fundo}</td>
                      <td className="num">{f.idadeMeses}m</td>
                      <td className="num">{pct0(f.pctAtual)}</td>
                      <td className="num">{pct0(f.pctExig[h])}</td>
                      <td className="num">{f.compra[h] > 0 ? fmtRs(f.compra[h]) : '—'}</td>
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
                <XAxis dataKey="lbl" tick={{ fontSize: 9.5, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} minTickGap={2} />
                {/* Eixo ESQUERDO = fluxo mensal (barras); DIREITO = acumulado (linha).
                    Escalas separadas: senão as torres somem sob o acumulado, que é ~5x maior. */}
                <YAxis yAxisId="flow" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: T }} axisLine={false} tickLine={false} width={38} />
                <YAxis yAxisId="acum" orientation="right" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<MesTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                <Bar yAxisId="flow" dataKey="novo" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                  {mensal.data.map((p, i) => <Cell key={i} fill={p.futuro ? T : T_CLARO} />)}
                </Bar>
                <Line yAxisId="acum" type="monotone" dataKey="acum" stroke={CARVAO} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="enq-nota">
        Ranking: compra p/ atingir o mínimo (carência até 6m · 67% dos 6-24m · 85% após 24m) em {h} meses, por gestora
        (clique numa barra p/ filtrar a tabela e o mensal). Mensal: <b>barras</b> = demanda NOVA por mês; <b>linha</b> =
        acumulado, a partir de {mesLabel(serie?.[0]?.mes)}{mBLC ? ` (1º mês após o BLC fechado de ${mBLC})` : ''} — barras claras até hoje, escuras projetado.
        Partindo da última carteira do CDA; elegíveis = só debêntures 12.431 (não capta cotas de FI-Infra){d?.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto.
      </p>
    </>
  )
}

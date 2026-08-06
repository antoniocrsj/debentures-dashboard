import { useMemo, useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'

// Enquadramento 12.431 (aba Técnico). Duas vistas:
//  - Gestoras: ranking da compra necessária consolidado por gestora; clicar numa
//    barra abre a tabela dos fundos que a compõem.
//  - Mensal: série da demanda TOTAL (compra necessária) mês a mês a partir de M,
//    com o degrau 67->85% e a amortização da carteira agindo (PL constante).
// Modelo em MODELO_Enquadramento_12431.md. Recharts não lê var() -> paleta Luc.
const T = '#8c5e3a', T_CLARO = '#c8a883', CARVAO = '#2a2420', MUTED = '#8a7d6c', GRID = '#e4d5c3'
const HORIZONTES = [{ id: 6, label: '6m' }, { id: 12, label: '12m' }]
const VISTAS = [{ id: 'gestoras', label: 'Gestoras' }, { id: 'mensal', label: 'Mensal' }]
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
const short = nome => { const s = String(nome || ''); return s.length > 28 ? s.slice(0, 27) + '…' : s }

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{r.nome}</div>
      <div className="fluxo-tooltip-row">Compra: <b>{fmtRs(r.compraH)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{r.sub} · clique p/ ver os fundos</div>
    </div>
  )
}
function MesTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload; if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{mesLabel(r.mes)}{r.futuro ? ' · projetado' : ''}</div>
      <div className="fluxo-tooltip-row">Demanda: <b>{fmtRs(r.compra)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{r.nDesenq} fundos desenquadrados</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, serie, gestor }) {
  const [h, setH] = useState(6)
  const [vista, setVista] = useState('gestoras')
  const [sel, setSel] = useState(null)   // gestora com a tabela de fundos aberta
  useEffect(() => { setSel(gestor || null) }, [gestor])

  const base = useMemo(() => (rows ? rows.filter(r => !r.semCarteira && r.plRef > 0) : null), [rows])
  const hojeMes = rows?.[0]?.dataHoje?.slice(0, 7) || null

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

  const serieData = useMemo(() => (serie || []).map(p => ({ ...p, lbl: mesLabel(p.mes), futuro: hojeMes ? p.mes > hojeMes : false })), [serie, hojeMes])
  const serieKpi = useMemo(() => {
    if (!serieData.length) return null
    const hoje = serieData.find(p => p.mes === hojeMes) || serieData[0]
    const fim = serieData[serieData.length - 1]
    return { hoje: hoje.compra, fim: fim.compra, fimLbl: fim.lbl }
  }, [serieData, hojeMes])

  const fundos = useMemo(() => {
    if (!base || !sel) return null
    const lista = base.filter(r => (r.gestor || '—') === sel).sort((a, b) => b.compra[h] - a.compra[h])
    return { lista, soma: lista.reduce((s, r) => s + Math.max(0, r.compra[h]), 0), nDes: lista.filter(r => r.compra[h] > 0).length }
  }, [base, sel, h])

  const clickBar = e => { const g = e?.nome ?? e?.payload?.nome; if (g) setSel(s => (s === g ? null : g)) }

  return (
    <>
      <p className="tecnico-chart-label">
        Enquadramento 12.431
        {vista === 'gestoras' && d && (
          <span className="grafico-kpi"><b>{d.enquad} de {d.universo}</b><em>enquadrados{d.top.length > 0 ? ` · faltam ${fmtRs(d.totalCompra)}` : ''}</em></span>
        )}
        {vista === 'mensal' && serieKpi && (
          <span className="grafico-kpi"><b>{fmtRs(serieKpi.hoje)}</b><em>hoje → {fmtRs(serieKpi.fim)} em {serieKpi.fimLbl}</em></span>
        )}
        <span className="segmented tecnico-unidade" role="tablist" aria-label="Vista do enquadramento">
          {VISTAS.map(o => (
            <button key={o.id} type="button" role="tab" aria-selected={vista === o.id}
              className={`segmented-btn${vista === o.id ? ' active' : ''}`} onClick={() => setVista(o.id)}>{o.label}</button>
          ))}
        </span>
        {vista === 'gestoras' && (
          <span className="segmented tecnico-unidade" role="tablist" aria-label="Horizonte da projeção">
            {HORIZONTES.map(o => (
              <button key={o.id} type="button" role="tab" aria-selected={h === o.id}
                className={`segmented-btn${h === o.id ? ' active' : ''}`} onClick={() => setH(o.id)}>{o.label}</button>
            ))}
          </span>
        )}
      </p>

      {vista === 'mensal' ? (
        !serieData.length ? <div className="caixa-line-empty">Série mensal indisponível.</div> : (
          <div className="enq-plot" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serieData} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="lbl" tick={{ fontSize: 9.5, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} minTickGap={2} />
                <YAxis tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<MesTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                <Bar dataKey="compra" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                  {serieData.map((p, i) => <Cell key={i} fill={p.futuro ? T : T_CLARO} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      ) : (
        !d ? <div className="caixa-line-empty">Carregando enquadramento…</div>
          : !d.universo ? <div className="caixa-line-empty">Sem fundos 12.431 no filtro atual.</div>
            : d.top.length === 0 ? <div className="caixa-line-empty">Todas as gestoras enquadradas no horizonte de {h} meses.</div>
              : (
                <div className="enq-plot" style={{ height: d.top.length * 26 + 24 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.top} layout="vertical" margin={{ top: 2, right: 64, bottom: 2, left: 4 }}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="rot" width={168} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} />
                      <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                      <Bar dataKey="compraH" fill={T} radius={[0, 3, 3, 0]} isAnimationActive={false} cursor="pointer" onClick={clickBar}>
                        <LabelList dataKey="compraH" position="right" formatter={fmtRs} style={{ fontSize: 10, fill: MUTED }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
      )}

      {vista === 'gestoras' && fundos && (
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

      <p className="enq-nota">
        {vista === 'mensal'
          ? <>Demanda TOTAL de compra de debêntures 12.431 a cada mês a partir de M ({mesLabel(serie?.[0]?.mes)}), com os degraus da regra (carência até 6m · 67% dos 6-24m · 85% após 24m) e a amortização da carteira agindo (PL constante). Barras claras = até hoje; escuras = projetado. </>
          : <>Compra p/ atingir o mínimo (carência até 6m · 67% dos 6-24m · 85% após 24m) em {h} meses, consolidada por gestora (clique numa barra p/ abrir os fundos). </>}
        Partindo da última carteira do CDA; elegíveis = só debêntures 12.431 (não capta cotas de FI-Infra){d?.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto. Feeders sem carteira direta ficam de fora.
      </p>
    </>
  )
}

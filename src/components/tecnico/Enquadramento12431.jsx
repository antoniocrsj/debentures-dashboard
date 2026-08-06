import { useMemo, useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

// Ranking de COMPRA NECESSÁRIA de debêntures 12.431 (aba Técnico), CONSOLIDADO
// POR GESTORA. Clicar numa barra abre a TABELA dos fundos que compõem a gestora.
// Modelo em MODELO_Enquadramento_12431.md. Exclui fundos sem carteira 12.431
// (feeders/look-through). Recharts não lê var() -> paleta Luc hardcoded.
const T = '#8c5e3a', CARVAO = '#2a2420', MUTED = '#8a7d6c', GRID = '#e4d5c3'
const HORIZONTES = [{ id: 6, label: '6m' }, { id: 12, label: '12m' }]

const fmtRs = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
  if (a >= 1e6) return `R$ ${Math.round(v / 1e6).toLocaleString('pt-BR')} mi`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
const fmtRsEixo = v => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}bi` : `${Math.round(v / 1e6)}mi`)
const pct0 = v => `${Math.round(v * 100)}%`
function short(nome) {
  const s = String(nome || '')
  return s.length > 28 ? s.slice(0, 27) + '…' : s
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{r.nome}</div>
      <div className="fluxo-tooltip-row">Compra: <b>{fmtRs(r.compraH)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{r.sub} · clique p/ ver os fundos</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, gestor }) {
  const [h, setH] = useState(6)
  const [sel, setSel] = useState(null)   // gestora com a tabela de fundos aberta
  // Selecionar uma gestora na tabela de gestores também abre os fundos dela aqui.
  useEffect(() => { setSel(gestor || null) }, [gestor])

  const base = useMemo(() => (rows ? rows.filter(r => !r.semCarteira && r.plRef > 0) : null), [rows])

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

  const clickBar = e => { const g = e?.nome ?? e?.payload?.nome; if (g) setSel(s => (s === g ? null : g)) }

  return (
    <>
      <p className="tecnico-chart-label">
        Enquadramento 12.431
        {d && (
          <span className="grafico-kpi">
            <b>{d.enquad} de {d.universo}</b>
            <em>enquadrados{d.top.length > 0 ? ` · faltam ${fmtRs(d.totalCompra)}` : ''}</em>
          </span>
        )}
        <span className="segmented tecnico-unidade" role="tablist" aria-label="Horizonte da projeção">
          {HORIZONTES.map(o => (
            <button key={o.id} type="button" role="tab" aria-selected={h === o.id}
              className={`segmented-btn${h === o.id ? ' active' : ''}`} onClick={() => setH(o.id)}>{o.label}</button>
          ))}
        </span>
      </p>

      {!d ? <div className="caixa-line-empty">Carregando enquadramento…</div>
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

      <p className="enq-nota">
        Compra de debêntures 12.431 p/ atingir o mínimo (67%&lt;24m / 85%) em {h} meses, consolidada por gestora
        (clique numa barra p/ abrir os fundos), partindo da última carteira do CDA (PL observado até hoje, constante
        depois). Elegíveis = só debêntures 12.431 (não capta cotas de FI-Infra){d?.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto. Feeders sem carteira direta ficam de fora.
      </p>
    </>
  )
}

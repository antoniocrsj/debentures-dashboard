import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

// Ranking de COMPRA NECESSÁRIA de debêntures 12.431 (aba Técnico), CONSOLIDADO
// POR GESTORA por padrão; com uma gestora selecionada, mostra os fundos dela.
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
  let s = String(nome || '').replace(/\s+(FIF|FUNDO|CLASSE|INVESTIMENTO|RESP(ONSABILIDADE)?|LIMITADA|EM\s+INFRA|CI|RENDA\s+FIXA|LONGO\s+PRAZO).*$/i, '').trim()
  if (!s) s = String(nome || '')
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
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{r.sub}</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, gestor }) {
  const [h, setH] = useState(6)

  const d = useMemo(() => {
    if (!rows) return null
    const base = rows.filter(r => !r.semCarteira && r.plRef > 0)
    const enquad = base.filter(r => r.compra[h] <= 0).length
    const totalCompra = base.reduce((s, r) => s + Math.max(0, r.compra[h]), 0)
    let top
    if (gestor) {
      // gestora selecionada -> os fundos dela (drill)
      top = base.filter(r => r.gestor === gestor && r.compra[h] > 0)
        .map(r => ({ nome: r.fundo, rot: short(r.fundo), compraH: r.compra[h], sub: `${pct0(r.pctAtual)} → exigido ${pct0(r.pctExig[h])} · idade ${r.idadeMeses}m` }))
        .sort((a, b) => b.compraH - a.compraH).slice(0, 20)
    } else {
      // consolidado por GESTORA (soma da compra dos fundos de cada gestora)
      const g = {}
      for (const r of base) {
        if (r.compra[h] <= 0) continue
        const k = r.gestor || '—'; const o = g[k] || (g[k] = { c: 0, n: 0 })
        o.c += r.compra[h]; o.n++
      }
      top = Object.entries(g).map(([k, o]) => ({ nome: k, rot: short(k), compraH: o.c, sub: `${o.n} fundo${o.n > 1 ? 's' : ''} desenquadrado${o.n > 1 ? 's' : ''}` }))
        .sort((a, b) => b.compraH - a.compraH).slice(0, 20)
    }
    return { universo: base.length, enquad, totalCompra, top, algumEstimado: base.some(r => r.amortEstimada), porGestora: !gestor }
  }, [rows, gestor, h])

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
        : d.top.length === 0
          ? <div className="caixa-line-empty">{gestor ? 'Fundos da gestora' : 'Todos'} enquadrados no horizonte de {h} meses.</div>
          : (
            <div className="enq-plot" style={{ height: d.top.length * 26 + 24 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.top} layout="vertical" margin={{ top: 2, right: 64, bottom: 2, left: 4 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="rot" width={168} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                  <Bar dataKey="compraH" fill={T} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    <LabelList dataKey="compraH" position="right" formatter={fmtRs} style={{ fontSize: 10, fill: MUTED }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

      <p className="enq-nota">
        Compra de debêntures 12.431 p/ atingir o mínimo (67%&lt;24m / 85%) em {h} meses, {d?.porGestora ? 'consolidada por gestora' : 'por fundo'}, partindo da última carteira do CDA (PL observado até hoje, constante depois). Elegíveis = só debêntures 12.431 (não capta cotas de FI-Infra){d?.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto. Feeders sem carteira direta ficam de fora.
      </p>
    </>
  )
}

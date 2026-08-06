import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'

// Ranking de COMPRA NECESSÁRIA de debêntures 12.431 por fundo (aba Técnico).
// Modelo em MODELO_Enquadramento_12431.md. Dado do hook useEnquadramento12431.
// Exclui fundos sem carteira 12.431 medível (feeders/look-through). Recharts não
// lê var() -> paleta Luc hardcoded.
const T = '#8c5e3a'        // terracota (barra/destaque)
const CARVAO = '#2a2420'
const MUTED = '#8a7d6c'
const GRID = '#e4d5c3'
const HORIZONTES = [{ id: 6, label: '6m' }, { id: 12, label: '12m' }]

const fmtRs = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
  if (a >= 1e6) return `R$ ${Math.round(v / 1e6).toLocaleString('pt-BR')} mi`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
const fmtRsEixo = v => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}bi` : `${Math.round(v / 1e6)}mi`)
const pct0 = v => `${Math.round(v * 100)}%`
// nome curto p/ o eixo (remove caudas comuns, corta em ~26)
function short(nome) {
  let s = String(nome || '').replace(/\s+(FIF|FUNDO|CLASSE|INVESTIMENTO|RESP(ONSABILIDADE)?|LIMITADA|EM\s+INFRA|CI|RENDA\s+FIXA|LONGO\s+PRAZO).*$/i, '').trim()
  if (!s) s = String(nome || '')
  return s.length > 26 ? s.slice(0, 25) + '…' : s
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{r.fundo}</div>
      <div className="fluxo-tooltip-row">Compra: <b>{fmtRs(r.compraH)}</b></div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">{pct0(r.pctAtual)} → exigido {pct0(r.pctExigH)} · idade {r.idadeMeses}m</div>
    </div>
  )
}

export default function Enquadramento12431({ rows, gestor }) {
  const [h, setH] = useState(6)

  const d = useMemo(() => {
    if (!rows) return null
    let fs = rows.filter(r => !r.semCarteira && r.plRef > 0)
    if (gestor) fs = fs.filter(r => r.gestor === gestor)
    const desenq = fs.filter(r => r.compra[h] > 0)
      .map(r => ({ fundo: r.fundo, short: short(r.fundo), compraH: r.compra[h], pctAtual: r.pctAtual, pctExigH: r.pctExig[h], idadeMeses: r.idadeMeses }))
      .sort((a, b) => b.compraH - a.compraH)
    return {
      universo: fs.length, enquad: fs.length - desenq.length,
      totalCompra: desenq.reduce((s, r) => s + r.compraH, 0),
      top: desenq.slice(0, 20),
      algumEstimado: fs.some(r => r.amortEstimada),
    }
  }, [rows, gestor, h])

  if (!rows) return <div className="caixa-line-empty">Carregando enquadramento…</div>
  if (!d.universo) return <div className="caixa-line-empty">Sem fundos 12.431 no filtro atual.</div>

  return (
    <>
      <div className="enq-head">
        <span className="enq-placar">
          <b>{d.enquad}</b> de {d.universo} enquadrados
          {d.top.length > 0 && <em> · faltam {fmtRs(d.totalCompra)}</em>}
        </span>
        <span className="segmented tecnico-unidade" role="tablist" aria-label="Horizonte da projeção">
          {HORIZONTES.map(o => (
            <button key={o.id} type="button" role="tab" aria-selected={h === o.id}
              className={`segmented-btn${h === o.id ? ' active' : ''}`} onClick={() => setH(o.id)}>{o.label}</button>
          ))}
        </span>
      </div>

      {d.top.length === 0
        ? <div className="caixa-line-empty">Todos os fundos enquadrados no horizonte de {h} meses.</div>
        : (
          <div className="enq-plot" style={{ height: d.top.length * 26 + 24 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.top} layout="vertical" margin={{ top: 2, right: 64, bottom: 2, left: 4 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tickFormatter={fmtRsEixo} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="short" width={148} tick={{ fontSize: 10, fill: CARVAO }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(140,94,58,0.06)' }} />
                <Bar dataKey="compraH" fill={T} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                  {d.top.map((_, i) => <Cell key={i} />)}
                  <LabelList dataKey="compraH" position="right" formatter={fmtRs} style={{ fontSize: 10, fill: MUTED }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

      <p className="enq-nota">
        Compra de debêntures 12.431 p/ atingir o mínimo (67%&lt;24m/85%) em {h} meses, partindo da última carteira
        do CDA (PL observado até hoje, constante depois). Elegíveis = só debêntures 12.431 (não capta cotas de
        FI-Infra){d.algumEstimado ? '; amortização de alguns papéis estimada' : ''} → valor é um teto. Feeders sem
        carteira direta ficam de fora.
      </p>
    </>
  )
}

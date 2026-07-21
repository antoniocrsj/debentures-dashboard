import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { amortPorAno, ATE_ANO } from '../utils/amortizacao.js'

// Grafico de VENCIMENTOS (amortizacao de principal) por ano, do conjunto de
// debentures FILTRADO na aba Debentures -- reage a todos os filtros da pagina.
// Fica ao lado das tabelas Gestor/Grupo.
//
// CATALOGO (Recharts nao le var()): terracota barra, carvao eixo, bege grade.
const COL_BARRA = '#8c5e3a'
const COL_ESTIM = '#9a8c7a'   // taupe: ano com parte ESTIMADA (linear) -- distingue do real
const COL_EIXO = '#2a2420'
const COL_GRID = '#f2ede5'
const FZ = 9


const fmtBi = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}bi`
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mi`
  return String(Math.round(v))
}
const fmtBRL = v => 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

function AmortTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const r = payload[0]?.payload
  if (!r) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">{r.ano}</div>
      <div className="fluxo-tooltip-row">Amortização: {fmtBRL(r.valor)}</div>
      {r.estimado && <div className="fluxo-tooltip-row fluxo-tooltip-pl">inclui estimativa (linear)</div>}
    </div>
  )
}

const MODOS = [
  { id: 'mercado', label: 'Mercado', campo: 'volumeEmitido' },
  { id: 'carteira', label: 'Carteira', campo: 'alocacao' },
]

export default function AmortChart({ assets, cronoMap, loading, onFilter, anoAtivo }) {
  // Mercado = volume em mercado (qtd x VNA); Carteira = posicao real (alocacao,
  // ja' ajustada por gestor pelo App quando ha' filtro de gestora).
  const [modo, setModo] = useState('mercado')
  const campo = MODOS.find(m => m.id === modo)?.campo || 'volumeEmitido'
  const dados = useMemo(() => {
    const base = amortPorAno(assets, cronoMap, { ateAno: ATE_ANO, campo })
    return base.map(d => ({
      ...d,
      anoCurto: d.ano.length > 4 ? d.ano : `'${d.ano.slice(2)}`,   // 2026 -> '26 ; "2035+" fica
      estimado: d.fontes.has('linear'),
    }))
  }, [assets, cronoMap, campo])

  const totalRotulo = useMemo(() => {
    const t = dados.reduce((s, d) => s + d.valor, 0)
    return t > 0 ? 'R$ ' + fmtBi(t) : null
  }, [dados])

  return (
    <div className="grafico-card amort-card">
      <p className="tecnico-chart-label">
        Vencimentos
        {totalRotulo && (
          <span className="grafico-kpi"><b>{totalRotulo}</b><em>a vencer</em></span>
        )}
        <span className="segmented tecnico-unidade amort-modo" role="tablist" aria-label="Base do valor">
          {MODOS.map(m => (
            <button key={m.id} type="button" role="tab" aria-selected={modo === m.id}
              className={`segmented-btn${modo === m.id ? ' active' : ''}`}
              onClick={() => setModo(m.id)}>{m.label}</button>
          ))}
        </span>
      </p>
      {loading && !cronoMap
        ? <div className="caixa-line-empty">Carregando cronograma…</div>
        : !dados.length
          ? <div className="caixa-line-empty">Sem cronograma de amortização para o filtro atual.</div>
          : (
            <div className="amort-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COL_GRID} vertical={false} />
                  <XAxis dataKey="anoCurto" tick={{ fontSize: FZ, fill: COL_EIXO }} tickMargin={3}
                         axisLine={false} tickLine={false} interval={0} />
                  <YAxis tickFormatter={fmtBi} tick={{ fontSize: FZ, fill: COL_EIXO, textAnchor: 'start' }}
                         dx={-22} width={32} axisLine={false} tickLine={false} />
                  <Tooltip content={<AmortTooltip />} cursor={{ fill: 'rgba(140,94,58,.08)' }} />
                  <Bar dataKey="valor" radius={[2, 2, 0, 0]} maxBarSize={38}
                       cursor={onFilter ? 'pointer' : undefined}
                       onClick={onFilter ? (e => e && onFilter('anoVenc', e.ano === anoAtivo ? '' : e.ano)) : undefined}>
                    {dados.map((d, i) => {
                      const base = d.estimado ? COL_ESTIM : COL_BARRA
                      // com um ano selecionado, os demais desbotam p/ destacar o clicado
                      const fill = anoAtivo && d.ano !== anoAtivo ? 'rgba(140,94,58,.28)' : base
                      return <Cell key={i} fill={fill} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
    </div>
  )
}

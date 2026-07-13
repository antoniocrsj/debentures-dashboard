import { useState, useMemo } from 'react'
import { fmtBRL } from '../../utils/format.js'
import TableWrap from '../TableWrap.jsx'

// Planejamento de VENCIMENTOS 12m com foco AGREGADO: quanto de caixa (juros +
// amortizacao) entra por mes, e como qualificar esse fluxo por fundo (gestor),
// emissor, grupo economico ou ativo. Duas perspectivas: Carteira dos fundos
// monitorados / Mercado inteiro. Amortizacao = R$ preciso (agenda ANBIMA);
// juros = R$ ESTIMADO pelo cupom. Dados: public/data/Agenda_12m.json.

function pctFmt(x) {
  if (x == null || isNaN(x)) return '—'
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function Empty() {
  return (
    <div className="venc-empty">
      <p><strong>Sem dados de vencimentos ainda.</strong></p>
      <p>
        Rode <code>preparar-agenda.ps1</code> (baixa as agendas de eventos da ANBIMA)
        e depois <code>gerar-agenda-12m.mjs</code> para gerar <code>Agenda_12m.json</code>.
      </p>
    </div>
  )
}

// Dimensoes de qualificacao do fluxo. "Por fundo" (gestor) so existe na carteira.
const DIMS = [
  { id: 'gestor', label: 'Por fundo', carteiraOnly: true },
  { id: 'emissor', label: 'Por emissor' },
  { id: 'grupo', label: 'Por grupo' },
  { id: 'ativo', label: 'Por ativo' },
]

export default function VencimentosDashboard({ data, compact }) {
  const [persp, setPersp] = useState('carteira')   // 'carteira' | 'mercado'
  const [dim, setDim] = useState('gestor')          // gestor | emissor | grupo | ativo
  const [soInc, setSoInc] = useState(false)         // filtra a tabela de ativos: so incentivadas

  const meses = data?.meses || []
  // "Por fundo" nao se aplica ao mercado -> cai para emissor nesse caso.
  const effDim = dim === 'gestor' && persp === 'mercado' ? 'emissor' : dim

  const maxTotal = useMemo(
    () => Math.max(1, ...meses.map(m => (m[persp]?.total || 0))),
    [meses, persp]
  )
  const totalPeriodo = meses.reduce((s, m) => s + (m[persp]?.total || 0), 0)
  const totJuros = meses.reduce((s, m) => s + (m[persp]?.juros || 0), 0)
  const totAmort = meses.reduce((s, m) => s + (m[persp]?.amort || 0), 0)

  // Linhas do ranking agregado (gestor/emissor/grupo) para a perspectiva atual.
  const rankRows = useMemo(() => {
    if (effDim === 'gestor') {
      return (data?.porGestor || []).map(o => ({ nome: o.nome, juros: o.juros, amort: o.amort, total: o.total }))
    }
    const src = effDim === 'emissor' ? data?.porEmissor : effDim === 'grupo' ? data?.porGrupo : null
    if (!src) return null
    return src
      .map(o => ({ nome: o.nome, juros: o[persp].juros, amort: o[persp].amort, total: o[persp].total }))
      .filter(o => o.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [effDim, persp, data])

  // Linhas da tabela por ativo (colunas mais ricas).
  const ativoRows = useMemo(() => {
    return (data?.ativos || [])
      .filter(a => !soInc || a.incentivada)
      .map(a => ({ ...a, j: a[persp]?.juros || 0, am: a[persp]?.amort || 0 }))
      .map(a => ({ ...a, tot: a.j + a.am }))
      .filter(a => a.tot > 0)
      .sort((a, b) => b.tot - a.tot)
  }, [data, persp, soInc])

  const semAgendas = !data || !meses.length || (data.cobertura && data.cobertura.comAgenda === 0)
  if (semAgendas) return <Empty />

  const prem = data.premissas || {}
  const cdiFonte = prem.cdiFonte && prem.cdiFonte !== 'default' ? ` (${prem.cdiFonte})` : ''
  const premLabel = `CDI ${pctFmt((prem.cdi || 0) * 100)}${cdiFonte} · VNA indexado +${pctFmt((prem.inflacaoVna || 0) * 100)} a.a.`
  const dimLabel = DIMS.find(d => d.id === effDim)?.label || ''

  const rankTable = (
    <table className="venc-table">
      <thead>
        <tr>
          <th>{effDim === 'gestor' ? 'Fundo (gestor)' : effDim === 'emissor' ? 'Emissor' : 'Grupo'}</th>
          <th className="num">Juros<span className="venc-est">est.</span></th>
          <th className="num">Amort.</th>
          <th className="num">Total 12m</th>
        </tr>
      </thead>
      <tbody>
        {(rankRows || []).map(r => (
          <tr key={r.nome}>
            <td className="venc-nome">{r.nome}</td>
            <td className="num">{r.juros ? fmtBRL(r.juros) : '—'}</td>
            <td className="num">{r.amort ? fmtBRL(r.amort) : '—'}</td>
            <td className="num venc-tot">{fmtBRL(r.total)}</td>
          </tr>
        ))}
        {!rankRows?.length && <tr><td colSpan={4} className="venc-norows">Sem eventos nesta janela.</td></tr>}
      </tbody>
    </table>
  )

  const ativoTable = (
    <table className="venc-table">
      <thead>
        <tr>
          <th>Ativo</th>
          <th className="hide-compact">Emissor</th>
          <th className="hide-compact">Grupo</th>
          <th>Prazo</th>
          <th className="num">Juros<span className="venc-est">est.</span></th>
          <th className="num">Amort.</th>
          <th className="num">Total 12m</th>
        </tr>
      </thead>
      <tbody>
        {ativoRows.map(a => (
          <tr key={a.ticker}>
            <td>
              <span className="venc-tk">{a.ticker}</span>
              {a.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            <td className="hide-compact venc-nome">{a.emissor || '—'}</td>
            <td className="hide-compact venc-nome">{a.grupo || '—'}</td>
            <td>{a.prazo || '—'}</td>
            <td className="num">{a.j ? fmtBRL(a.j) : '—'}</td>
            <td className="num">{a.am ? fmtBRL(a.am) : '—'}</td>
            <td className="num venc-tot">{fmtBRL(a.tot)}</td>
          </tr>
        ))}
        {!ativoRows.length && <tr><td colSpan={7} className="venc-norows">Nenhum evento nos proximos 12 meses.</td></tr>}
      </tbody>
    </table>
  )

  const tabela = effDim === 'ativo' ? ativoTable : rankTable

  return (
    <div className={`venc${compact ? ' compact' : ''}`}>
      <div className="venc-head">
        <div className="venc-titles">
          <h2>Vencimentos 12 meses</h2>
          <p className="venc-sub">
            Caixa (juros + amortizacao) que entra{data.refDate ? ` a partir de ${data.refDate}` : ''}.
            {' '}Juros <strong>estimados pelo cupom</strong> ({premLabel}); amortizacao com valor preciso da agenda.
          </p>
        </div>
        <div className="venc-toggle" role="tablist" aria-label="Perspectiva">
          <button role="tab" aria-selected={persp === 'carteira'}
            className={`venc-btn${persp === 'carteira' ? ' active' : ''}`}
            onClick={() => setPersp('carteira')}>Carteira</button>
          <button role="tab" aria-selected={persp === 'mercado'}
            className={`venc-btn${persp === 'mercado' ? ' active' : ''}`}
            onClick={() => setPersp('mercado')}>Mercado</button>
        </div>
      </div>

      <div className="venc-cards">
        <div className="venc-card">
          <span className="venc-card-lbl">{persp === 'carteira' ? 'Entra nos fundos (12m)' : 'Mercado (12m)'}</span>
          <span className="venc-card-val">{fmtBRL(totalPeriodo)}</span>
        </div>
        <div className="venc-card">
          <span className="venc-card-lbl">Juros (est.)</span>
          <span className="venc-card-val venc-juros-ink">{fmtBRL(totJuros)}</span>
        </div>
        <div className="venc-card">
          <span className="venc-card-lbl">Amortizacao</span>
          <span className="venc-card-val venc-amort-ink">{fmtBRL(totAmort)}</span>
        </div>
      </div>

      <div className="venc-chart" role="img" aria-label="Vencimentos por mes">
        {meses.map(m => {
          const v = m[persp] || { juros: 0, amort: 0, total: 0 }
          const hJ = (v.juros / maxTotal) * 100
          const hA = (v.amort / maxTotal) * 100
          return (
            <div className="venc-col" key={m.mes} title={`${m.label}: ${fmtBRL(v.total)}`}>
              <div className="venc-bar-val">{v.total ? fmtBRL(v.total) : ''}</div>
              <div className="venc-bar-wrap">
                <div className="venc-seg venc-seg-juros" style={{ height: `${hJ}%` }} />
                <div className="venc-seg venc-seg-amort" style={{ height: `${hA}%` }} />
              </div>
              <div className="venc-bar-lbl">{m.label}</div>
            </div>
          )
        })}
      </div>
      <div className="venc-legend">
        <span><i className="venc-dot venc-seg-juros" /> Juros (estimado)</span>
        <span><i className="venc-dot venc-seg-amort" /> Amortizacao</span>
      </div>

      {/* Seletor de dimensao: como qualificar o fluxo */}
      <div className="venc-dims" role="tablist" aria-label="Qualificar o fluxo">
        {DIMS.filter(d => !(d.carteiraOnly && persp === 'mercado')).map(d => (
          <button key={d.id} role="tab" aria-selected={effDim === d.id}
            className={`venc-dim-btn${effDim === d.id ? ' active' : ''}`}
            onClick={() => setDim(d.id)}>{d.label}</button>
        ))}
        {effDim === 'ativo' && (
          <label className="venc-only-inc">
            <input type="checkbox" checked={soInc} onChange={e => setSoInc(e.target.checked)} />
            So incentivadas (12.431)
          </label>
        )}
      </div>

      {compact ? tabela : <TableWrap title={`Vencimentos 12 meses — ${dimLabel}`}>{tabela}</TableWrap>}

      {data.cobertura && (
        <p className="venc-foot">
          Cobertura: {data.cobertura.comAgenda} ativos com agenda de {data.cobertura.universo} no universo
          {data.cobertura.semCache ? ` · ${data.cobertura.semCache} sem agenda em cache (rode preparar-agenda.ps1)` : ''}.
        </p>
      )}
    </div>
  )
}

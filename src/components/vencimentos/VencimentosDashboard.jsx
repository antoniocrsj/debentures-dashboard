import { useState, useMemo } from 'react'
import { fmtBRL, parseNum } from '../../utils/format.js'
import TableWrap from '../TableWrap.jsx'

// Planejamento de VENCIMENTOS 12m com foco AGREGADO + INVESTIGACAO:
//   - quanto de caixa (juros + amortizacao) entra por mes;
//   - qualificar o fluxo por fundo (gestor), emissor, grupo ou ativo;
//   - drill-down: clicar num MES filtra os rankings; clicar numa LINHA abre o
//     cronograma daquela entidade (evento a evento: data, ativo, tipo, R$).
// O dado granular vive em data.ativos[].eventos (gerar-agenda-12m.mjs); o corte
// por gestor cruza com o BLC (raw.blc) que o app ja carrega para as Debentures.
// Amortizacao = R$ preciso (agenda ANBIMA); juros = R$ ESTIMADO pelo cupom.

function pctFmt(x) {
  if (x == null || isNaN(x)) return '—'
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
function fmtDia(d) {
  // 'yyyy-mm-dd' -> 'dd/mm/yy'
  const s = String(d || '')
  return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : s
}
const SEM_GRUPO = '(sem classificacao)'

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
const DIM_NOME = { gestor: 'Fundo', emissor: 'Emissor', grupo: 'Grupo', ativo: 'Ativo' }

export default function VencimentosDashboard({ data, blc, compact }) {
  const [persp, setPerspRaw] = useState('carteira')  // 'carteira' | 'mercado'
  const [dim, setDim] = useState('gestor')            // gestor | emissor | grupo | ativo
  const [selMes, setSelMes] = useState(null)          // 'yyyy-MM' | null
  const [selEnt, setSelEnt] = useState(null)          // { dim, nome } | null
  const [seg, setSeg] = useState('todos')             // 'todos' | '12431' | 'trad'

  const meses = data?.meses || []
  const effDim = dim === 'gestor' && persp === 'mercado' ? 'emissor' : dim
  // Filtro por tipo de debenture (Lei 12.431). Age no grafico, cards e rankings.
  const matchSeg = a => seg === 'todos' || (seg === '12431' ? !!a.incentivada : !a.incentivada)
  const filtrando = seg !== 'todos'

  // Mercado nao tem corte por gestor: trocar de perspectiva com um fundo
  // selecionado derrubaria a conta -> limpa a selecao nesse caso.
  const setPersp = p => {
    setPerspRaw(p)
    if (p === 'mercado' && selEnt?.dim === 'gestor') setSelEnt(null)
  }

  // Quem carrega cada ticker (BLC ja carregado pelo app): ticker -> {total, rows}.
  const gestoresPorTicker = useMemo(() => {
    const m = new Map()
    for (const r of blc || []) {
      const tk = String(r.CD_ATIVO || '').trim().toUpperCase()
      const v = parseNum(r.VL_ALOCADO)
      if (!tk || v <= 0) continue
      let o = m.get(tk)
      if (!o) { o = { total: 0, rows: [] }; m.set(tk, o) }
      o.total += v
      o.rows.push({ g: String(r.GESTOR || '').trim() || '(sem gestor)', v })
    }
    return m
  }, [blc])

  // Eventos individuais achatados (cada um com referencia ao ativo).
  const eventos = useMemo(() => {
    const out = []
    for (const a of data?.ativos || []) for (const e of a.eventos || []) out.push({ ...e, a })
    return out
  }, [data])

  const matchEnt = (a, ent) => {
    if (!ent) return true
    if (ent.dim === 'gestor') {
      const o = gestoresPorTicker.get(a.ticker)
      return !!o && o.rows.some(r => r.g === ent.nome)
    }
    if (ent.dim === 'emissor') return (a.emissor || '') === ent.nome
    if (ent.dim === 'grupo') return (a.grupo || SEM_GRUPO) === ent.nome
    return a.ticker === ent.nome
  }
  // Valor do evento na visao atual; p/ um gestor especifico, a fatia proporcional
  // ao que ele carrega do ticker (mesma proporcionalidade do gerador).
  const evVal = (ev, ent) => {
    if (ent?.dim === 'gestor') {
      const o = gestoresPorTicker.get(ev.a.ticker)
      if (!o || !o.total || !ev.ct) return 0
      const r = o.rows.find(x => x.g === ent.nome)
      return r ? ev.ct * (r.v / o.total) : 0
    }
    return persp === 'carteira' ? ev.ct : ev.mc
  }

  // Meses exibidos (cards + grafico): precomputado quando nada esta filtrado;
  // recomputado dos eventos quando ha entidade selecionada ou filtro 12.431.
  const mesesView = useMemo(() => {
    if (!selEnt && !filtrando) return meses.map(m => ({ mes: m.mes, label: m.label, ...m[persp] }))
    const buckets = new Map(meses.map(m => [m.mes, { mes: m.mes, label: m.label, juros: 0, amort: 0, total: 0 }]))
    for (const ev of eventos) {
      if (!matchSeg(ev.a)) continue
      if (!matchEnt(ev.a, selEnt)) continue
      const b = buckets.get(ev.d.slice(0, 7))
      if (!b) continue
      const v = evVal(ev, selEnt)
      if (ev.t === 'J') b.juros += v; else b.amort += v
      b.total += v
    }
    return [...buckets.values()]
  }, [meses, persp, selEnt, seg, eventos, gestoresPorTicker])

  const maxTotal = Math.max(1, ...mesesView.map(m => m.total))
  const totJuros = mesesView.reduce((s, m) => s + m.juros, 0)
  const totAmort = mesesView.reduce((s, m) => s + m.amort, 0)
  const totalPeriodo = totJuros + totAmort

  // Rankings (sem entidade selecionada), respeitando o filtro de mes.
  const rankRows = useMemo(() => {
    if (selEnt) return []
    // Sem filtro de mes/segmento, o ranking por gestor precomputado e completo.
    if (effDim === 'gestor' && !selMes && !filtrando && data?.porGestor?.length) return data.porGestor
    const m = new Map()
    for (const ev of eventos) {
      if (!matchSeg(ev.a)) continue
      if (selMes && ev.d.slice(0, 7) !== selMes) continue
      if (effDim === 'gestor') {
        if (!ev.ct) continue
        const o = gestoresPorTicker.get(ev.a.ticker)
        if (!o || !o.total) continue
        for (const r of o.rows) {
          const v = ev.ct * (r.v / o.total)
          let x = m.get(r.g)
          if (!x) { x = { nome: r.g, juros: 0, amort: 0 }; m.set(r.g, x) }
          if (ev.t === 'J') x.juros += v; else x.amort += v
        }
        continue
      }
      const v = persp === 'carteira' ? ev.ct : ev.mc
      if (!v) continue
      const k = effDim === 'emissor' ? (ev.a.emissor || '(sem emissor)')
        : effDim === 'grupo' ? (ev.a.grupo || SEM_GRUPO)
        : ev.a.ticker
      let x = m.get(k)
      if (!x) { x = { nome: k, juros: 0, amort: 0, a: ev.a }; m.set(k, x) }
      if (ev.t === 'J') x.juros += v; else x.amort += v
    }
    return [...m.values()]
      .map(x => ({ ...x, total: x.juros + x.amort }))
      .filter(x => x.total > 0.5)
      .sort((a, b) => b.total - a.total)
  }, [selEnt, effDim, selMes, persp, seg, eventos, gestoresPorTicker, data])

  // Cronograma da entidade selecionada (evento a evento, em ordem de data).
  const crono = useMemo(() => {
    if (!selEnt) return []
    return eventos
      .filter(ev => matchEnt(ev.a, selEnt))
      .filter(ev => matchSeg(ev.a))
      .filter(ev => !selMes || ev.d.slice(0, 7) === selMes)
      .map(ev => ({ ...ev, v: evVal(ev, selEnt) }))
      .filter(ev => ev.v > 0.5)
      .sort((x, y) => (x.d < y.d ? -1 : 1))
  }, [selEnt, selMes, persp, seg, eventos, gestoresPorTicker])

  const semAgendas = !data || !meses.length || (data.cobertura && data.cobertura.comAgenda === 0)
  if (semAgendas) return <Empty />

  const prem = data.premissas || {}
  const cdiFonte = prem.cdiFonte && prem.cdiFonte !== 'default' ? ` (${prem.cdiFonte})` : ''
  const premLabel = `CDI ${pctFmt((prem.cdi || 0) * 100)}${cdiFonte} · VNA indexado +${pctFmt((prem.inflacaoVna || 0) * 100)} a.a.`
  const mesLabelSel = selMes ? (meses.find(m => m.mes === selMes)?.label || selMes) : null

  const rankTable = (
    <table className="venc-table">
      <thead>
        <tr>
          <th>{effDim === 'gestor' ? 'Fundo (gestor)' : DIM_NOME[effDim]}</th>
          {effDim === 'ativo' && <th className="hide-compact">Emissor</th>}
          {effDim === 'ativo' && <th className="hide-compact">Grupo</th>}
          <th className="num">Juros<span className="venc-est">est.</span></th>
          <th className="num">Amort.</th>
          <th className="num">Total {mesLabelSel || '12m'}</th>
        </tr>
      </thead>
      <tbody>
        {rankRows.map(r => (
          <tr key={r.nome} className="venc-row-click" title="Ver cronograma"
              onClick={() => setSelEnt({ dim: effDim, nome: r.nome })}>
            <td className="venc-nome">
              {effDim === 'ativo' ? <span className="venc-tk">{r.nome}</span> : r.nome}
              {effDim === 'ativo' && r.a?.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            {effDim === 'ativo' && <td className="hide-compact venc-nome">{r.a?.emissor || '—'}</td>}
            {effDim === 'ativo' && <td className="hide-compact venc-nome">{r.a?.grupo || '—'}</td>}
            <td className="num">{r.juros > 0.5 ? fmtBRL(r.juros) : '—'}</td>
            <td className="num">{r.amort > 0.5 ? fmtBRL(r.amort) : '—'}</td>
            <td className="num venc-tot">{fmtBRL(r.total)}</td>
          </tr>
        ))}
        {!rankRows.length && (
          <tr><td colSpan={effDim === 'ativo' ? 6 : 4} className="venc-norows">Sem eventos {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
      </tbody>
    </table>
  )

  const cronoTable = (
    <table className="venc-table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Ativo</th>
          <th className="hide-compact">Emissor</th>
          <th>Evento</th>
          <th className="num">R$</th>
        </tr>
      </thead>
      <tbody>
        {crono.map((ev, i) => (
          <tr key={`${ev.a.ticker}-${ev.d}-${ev.t}-${i}`}>
            <td>{fmtDia(ev.d)}</td>
            <td>
              <span className="venc-tk">{ev.a.ticker}</span>
              {ev.a.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            <td className="hide-compact venc-nome">{ev.a.emissor || '—'}</td>
            <td>
              {ev.t === 'J'
                ? <>Juros<span className="venc-est">est.</span></>
                : `Amortização${ev.pct != null ? ` (${ev.pct.toLocaleString('pt-BR')}%)` : ''}`}
            </td>
            <td className="num venc-tot">{fmtBRL(ev.v)}</td>
          </tr>
        ))}
        {!crono.length && (
          <tr><td colSpan={5} className="venc-norows">Sem eventos {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
      </tbody>
    </table>
  )

  const tabela = selEnt ? cronoTable : rankTable
  const tabelaTitle = selEnt
    ? `Cronograma — ${selEnt.nome}${mesLabelSel ? ` · ${mesLabelSel}` : ''}`
    : `Vencimentos ${mesLabelSel || '12 meses'} — ${DIMS.find(d => d.id === effDim)?.label || ''}`

  return (
    <div className={`venc${compact ? ' compact' : ''}`}>
      <div className="venc-head">
        <div className="venc-titles">
          <h2 className="fluxo-title">Vencimentos 12 meses</h2>
          <p className="fluxo-subtitle venc-sub">
            Caixa (juros + amortização) que entra{data.refDate ? ` a partir de ${data.refDate}` : ''}.
            {' '}Juros <strong>estimados pelo cupom</strong> ({premLabel}); amortização com valor preciso da agenda.
            {' '}Clique num mês ou numa linha para investigar.
          </p>
        </div>
        <div className="venc-toggles">
          <div className="segmented" role="tablist" aria-label="Perspectiva">
            <button role="tab" aria-selected={persp === 'carteira'}
              className={`segmented-btn${persp === 'carteira' ? ' active' : ''}`}
              onClick={() => setPersp('carteira')}>Carteira</button>
            <button role="tab" aria-selected={persp === 'mercado'}
              className={`segmented-btn${persp === 'mercado' ? ' active' : ''}`}
              onClick={() => setPersp('mercado')}>Mercado</button>
          </div>
          <div className="segmented" role="tablist" aria-label="Tipo de debênture">
            {[['todos', 'Tudo'], ['12431', '12.431'], ['trad', 'Tradicional']].map(([id, lbl]) => (
              <button key={id} role="tab" aria-selected={seg === id}
                className={`segmented-btn${seg === id ? ' active' : ''}`}
                onClick={() => setSeg(id)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Todos os filtros ativos numa linha so + "limpar tudo". Perspectiva e
          dimensao sao "modos" (tem seus proprios botoes) e nao entram aqui. */}
      {(filtrando || selMes || selEnt) && (
        <div className="venc-crumbs">
          <span className="venc-crumbs-lbl">Filtros:</span>
          {filtrando && (
            <button className="venc-chip" onClick={() => setSeg('todos')} title="Limpar tipo">
              Tipo: <b>{seg === '12431' ? '12.431' : 'Tradicional'}</b> ✕
            </button>
          )}
          {selEnt && (
            <button className="venc-chip" onClick={() => setSelEnt(null)} title="Limpar seleção">
              {DIM_NOME[selEnt.dim]}: <b>{selEnt.nome}</b> ✕
            </button>
          )}
          {selMes && (
            <button className="venc-chip" onClick={() => setSelMes(null)} title="Limpar mês">
              Mês: <b>{mesLabelSel}</b> ✕
            </button>
          )}
          <button className="venc-chip venc-chip-clear"
            onClick={() => { setSeg('todos'); setSelMes(null); setSelEnt(null) }}
            title="Limpar todos os filtros">
            Limpar tudo
          </button>
        </div>
      )}

      <div className="fluxo-cards venc-cards">
        <div className="fluxo-card">
          <span className="fluxo-card-label">
            {(selEnt ? `${DIM_NOME[selEnt.dim]} · 12m` : persp === 'carteira' ? 'Entra nos fundos (12m)' : 'Mercado (12m)')}
            {seg === '12431' ? ' · 12.431' : seg === 'trad' ? ' · Tradicional' : ''}
          </span>
          <span className="fluxo-card-value">{fmtBRL(totalPeriodo)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Juros (est.)</span>
          <span className="fluxo-card-value venc-juros-ink">{fmtBRL(totJuros)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Amortização</span>
          <span className="fluxo-card-value venc-amort-ink">{fmtBRL(totAmort)}</span>
        </div>
      </div>

      <div className="venc-chart" role="img" aria-label="Vencimentos por mês (clique para filtrar)">
        {mesesView.map(m => (
          <div
            key={m.mes}
            className={`venc-col${selMes === m.mes ? ' sel' : ''}`}
            title={`${m.label}: ${fmtBRL(m.total)} — clique para ${selMes === m.mes ? 'limpar o filtro' : 'filtrar'}`}
            onClick={() => setSelMes(s => (s === m.mes ? null : m.mes))}
          >
            <div className="venc-bar-val">{m.total > 0.5 ? fmtBRL(m.total) : ''}</div>
            <div className="venc-bar-wrap">
              <div className="venc-seg venc-seg-juros" style={{ height: `${(m.juros / maxTotal) * 100}%` }} />
              <div className="venc-seg venc-seg-amort" style={{ height: `${(m.amort / maxTotal) * 100}%` }} />
            </div>
            <div className="venc-bar-lbl">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="venc-legend">
        <span><i className="venc-dot venc-seg-juros" /> Juros (estimado)</span>
        <span><i className="venc-dot venc-seg-amort" /> Amortização</span>
      </div>

      {/* Seletor de dimensão (some no drill: o cronograma já é a visão granular) */}
      {!selEnt && (
        <div className="venc-dims">
          <div className="segmented venc-dims-seg" role="tablist" aria-label="Qualificar o fluxo">
            {DIMS.filter(d => !(d.carteiraOnly && persp === 'mercado')).map(d => (
              <button key={d.id} role="tab" aria-selected={effDim === d.id}
                className={`segmented-btn${effDim === d.id ? ' active' : ''}`}
                onClick={() => setDim(d.id)}>{d.label}</button>
            ))}
          </div>
        </div>
      )}
      {selEnt && (
        <div className="venc-dims">
          <button className="venc-back" onClick={() => setSelEnt(null)}>← Voltar aos rankings</button>
          <span className="venc-crono-lbl">Cronograma de <b>{selEnt.nome}</b> — {crono.length} evento(s)</span>
        </div>
      )}

      {compact ? tabela : <TableWrap title={tabelaTitle}>{tabela}</TableWrap>}

      {data.cobertura && (
        <p className="venc-foot">
          <strong>Piso conservador:</strong> só entram debêntures com agenda de eventos na ANBIMA
          ({data.cobertura.comAgenda} de {data.cobertura.universo}). Papéis da carteira sem agenda
          contribuem com R$ 0, então os juros são subestimados — o valor real é maior.
          {data.cobertura.semCache ? ` (${data.cobertura.semCache} sem agenda em cache; rode preparar-agenda.ps1.)` : ''}
        </p>
      )}
    </div>
  )
}

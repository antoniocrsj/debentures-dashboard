import { useState, useMemo } from 'react'
import { fmtBRL } from '../../utils/format.js'
import TableWrap from '../TableWrap.jsx'
import MonthBars from './MonthBars.jsx'
import {
  buildGestoresPorTicker, flattenEventos, aggGestores, aggGrupos, aggAtivos,
  aggFundos, aggMeses, totalPeriodo, fmtBar, pctFmt,
} from '../../utils/vencimentos.js'

// Planejamento de VENCIMENTOS 12m no padrao Caixa/Captacao: a TABELA DE GESTORES
// e' o seletor principal; cards, graficos e a tabela de detalhe (Fundos/Grupos/
// Ativos) respondem ao gestor selecionado. Juros ESTIMADOS pelo cupom; amortizacao
// com valor preciso da agenda ANBIMA. O corte por gestor cruza o BLC (por gestor);
// o detalhe por FUNDO vem pronto do pipeline (posicao real por CNPJ).

function fmtDia(d) {
  const s = String(d || '')
  return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : s
}

function applySort(rows, sort, accessors) {
  const acc = accessors[sort.col]
  if (!acc) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return rows.slice().sort((a, b) => {
    const va = acc(a), vb = acc(b)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'pt-BR') * dir
  })
}

function SortTh({ label, col, sort, setSort, numeric, className, title }) {
  const active = sort.col === col
  const toggle = () => setSort(s => (s.col === col
    ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: numeric ? 'desc' : 'asc' }))
  return (
    <th
      className={`venc-th-sort${active ? ' active' : ''}${numeric ? ' num' : ''}${className ? ' ' + className : ''}`}
      onClick={toggle} role="button" tabIndex={0} title={title}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
    >
      {label}{active && <span className="venc-sort-arrow">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  )
}

function Empty() {
  return (
    <div className="venc-empty">
      <p><strong>Sem dados de vencimentos ainda.</strong></p>
      <p>Rode <code>preparar-agenda.ps1</code> e depois <code>gerar-agenda-12m.mjs</code> para gerar <code>Agenda_12m.json</code>.</p>
    </div>
  )
}

const DETALHES = [
  { id: 'fundo', label: 'Fundos' },
  { id: 'grupo', label: 'Grupos' },
  { id: 'ativo', label: 'Ativos' },
]
const GESTOR_ACC = { nome: r => r.nome, juros: r => r.juros || 0, amort: r => r.amort || 0, total: r => r.total || 0 }
const DIM_ACC = {
  nome: r => r.nome, ticker: r => r.ticker, grupo: r => r.grupo, emissor: r => r.emissor,
  gestor: r => r.gestor, juros: r => r.juros || 0, amort: r => r.amort || 0,
  total: r => r.total || 0, pctPL: r => (r.pctPL == null ? -1 : r.pctPL), prox: r => r.proxData || '',
}

export default function VencimentosDashboard({ data, blc, plByGestor, compact }) {
  const [persp, setPerspRaw] = useState('carteira')       // 'carteira' | 'mercado'
  const [detalheDim, setDetalheDim] = useState('grupo')   // 'fundo' | 'grupo' | 'ativo'
  const [selMes, setSelMes] = useState(null)              // 'yyyy-MM' | null
  const [seg, setSeg] = useState('12431')                 // '12431' | 'trad' (segmento sempre ativo)
  const [gestorSel, setGestorSel] = useState(null)        // nome do gestor selecionado | null
  const [gestorSort, setGestorSort] = useState({ col: 'total', dir: 'desc' })
  const [detSort, setDetSort] = useState({ col: 'total', dir: 'desc' })

  const gpt = useMemo(() => buildGestoresPorTicker(blc), [blc])
  const eventos = useMemo(() => flattenEventos(data), [data])
  const totalPL = useMemo(() => {
    let s = 0; for (const k in (plByGestor || {})) s += plByGestor[k] || 0; return s
  }, [plByGestor])

  const pickMes = m => setSelMes(s => (s === m ? null : m))
  // Escolher gestor: Mercado nao tem corte por gestor -> volta pra Carteira.
  const pickGestor = g => {
    setGestorSel(cur => (cur === g ? null : g))
    setPerspRaw(p => (p === 'mercado' ? 'carteira' : p))
  }
  const setPersp = p => { setPerspRaw(p); if (p === 'mercado') setGestorSel(null) }
  const limparTudo = () => { setGestorSel(null); setSelMes(null); setSeg('12431'); setDetSort({ col: 'total', dir: 'desc' }) }

  // Series mensais: R$ (perspectiva atual) e carteira (base do %PL).
  const mesesView = useMemo(() => aggMeses(data, eventos, gpt, { gestorSel, seg, persp, base: 'view' }),
    [data, eventos, gpt, gestorSel, seg, persp])
  const mesesCarteira = useMemo(() => aggMeses(data, eventos, gpt, { gestorSel, seg, persp, base: 'carteira' }),
    [data, eventos, gpt, gestorSel, seg])

  const maxTotal = Math.max(1, ...mesesView.map(m => m.total))
  const card = useMemo(() => totalPeriodo(mesesView, selMes), [mesesView, selMes])

  const plDenom = gestorSel ? (plByGestor?.[gestorSel] || 0) : totalPL
  const plSuffix = gestorSel || 'carteira'
  const mesesPL = useMemo(() => mesesCarteira.map(m => ({
    mes: m.mes, label: m.label,
    juros: plDenom > 0 ? (m.juros / plDenom) * 100 : 0,
    amort: plDenom > 0 ? (m.amort / plDenom) * 100 : 0,
    total: plDenom > 0 ? (m.total / plDenom) * 100 : 0,
  })), [mesesCarteira, plDenom])
  const maxPct = Math.max(0.001, ...mesesPL.map(m => m.total))
  const totalPctPeriodo = (selMes ? mesesPL.filter(m => m.mes === selMes) : mesesPL).reduce((s, m) => s + m.total, 0)

  // Tabela principal: gestores (sempre todos; NAO reage a propria selecao).
  const gestorRows = useMemo(() => aggGestores(data, eventos, gpt, { seg, selMes }),
    [data, eventos, gpt, seg, selMes])
  const gestorSorted = useMemo(() => applySort(gestorRows, gestorSort, GESTOR_ACC), [gestorRows, gestorSort])

  // Tabela de detalhe conforme a dimensao.
  const fundos = useMemo(() => aggFundos(data, { gestorSel, seg, selMes }),
    [data, gestorSel, seg, selMes])
  const grupos = useMemo(() => aggGrupos(data, eventos, gpt, { gestorSel, seg, selMes, persp }),
    [data, eventos, gpt, gestorSel, seg, selMes, persp])
  const ativos = useMemo(() => aggAtivos(data, gpt, { gestorSel, seg, selMes, persp }),
    [data, gpt, gestorSel, seg, selMes, persp])
  const DET_CAP = 150
  const detRows = detalheDim === 'fundo' ? fundos.rows : detalheDim === 'grupo' ? grupos : ativos
  const detSorted = useMemo(() => applySort(detRows, detSort, DIM_ACC).slice(0, DET_CAP), [detRows, detSort])
  const detTotal = detRows.reduce((s, r) => s + r.total, 0)
  const detJuros = detRows.reduce((s, r) => s + r.juros, 0)
  const detAmort = detRows.reduce((s, r) => s + r.amort, 0)

  const semAgendas = !data || !(data.meses || []).length || (data.cobertura && data.cobertura.comAgenda === 0)
  if (semAgendas) return <Empty />

  const prem = data.premissas || {}
  const cdiFonte = prem.cdiFonte && prem.cdiFonte !== 'default' ? ` (${prem.cdiFonte})` : ''
  const premLabel = `CDI ${pctFmt((prem.cdi || 0) * 100)}${cdiFonte} · VNA +${pctFmt((prem.inflacaoVna || 0) * 100)} a.a.`
  const mesLabelSel = selMes ? (data.meses.find(m => m.mes === selMes)?.label || selMes) : null
  const temFiltro = selMes || gestorSel
  const escopoLbl = gestorSel ? gestorSel : (persp === 'carteira' ? 'carteira' : 'mercado')

  // ── Tabela de gestores (seletor principal) ──
  const gestorTable = (
    <table className="venc-table table-clickable">
      <thead>
        <tr>
          <SortTh label="Gestor" col="nome" sort={gestorSort} setSort={setGestorSort} />
          <SortTh label={<>Juros<span className="venc-est">est.</span></>} col="juros" sort={gestorSort} setSort={setGestorSort} numeric />
          <SortTh label="Amort." col="amort" sort={gestorSort} setSort={setGestorSort} numeric />
          <SortTh label={<>A vencer {mesLabelSel || '12m'}</>} col="total" sort={gestorSort} setSort={setGestorSort} numeric />
        </tr>
      </thead>
      <tbody>
        {gestorSorted.map(g => (
          <tr key={g.nome} className={`venc-row-click${g.nome === gestorSel ? ' row-active' : ''}`}
              onClick={() => pickGestor(g.nome)} tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && pickGestor(g.nome)}
              title={g.nome === gestorSel ? 'Clique para limpar a seleção' : `Selecionar ${g.nome}`}>
            <td className="venc-nome"><span className="venc-ell">{g.nome}</span></td>
            <td className="num">{g.juros > 0.5 ? fmtBRL(g.juros) : '—'}</td>
            <td className="num">{g.amort > 0.5 ? fmtBRL(g.amort) : '—'}</td>
            <td className="num venc-tot">{fmtBRL(g.total)}</td>
          </tr>
        ))}
        {!gestorSorted.length && (
          <tr><td colSpan={4} className="venc-norows">Sem gestores {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
      </tbody>
    </table>
  )

  // ── Tabela de detalhe (Fundos / Grupos / Ativos) ──
  let detTable
  if (detalheDim === 'fundo' && !fundos.disponivel) {
    detTable = (
      <div className="venc-indisp">
        <p><strong>Detalhamento por fundo indisponível.</strong></p>
        <p>A posição por fundo (CNPJ) não está na base ainda. Rode <code>atualizar-tudo.ps1</code>
          {' '}(com o <code>preparar-blc.ps1</code> que gera <code>BLC_PorFundo.csv</code>) para
          habilitar a visão por fundo real. Enquanto isso, use <b>Grupos</b> ou <b>Ativos</b>.</p>
      </div>
    )
  } else if (detalheDim === 'fundo') {
    detTable = (
      <table className="venc-table">
        <thead>
          <tr>
            <SortTh label="Fundo" col="nome" sort={detSort} setSort={setDetSort} />
            {!gestorSel && <SortTh label="Gestor" col="gestor" sort={detSort} setSort={setDetSort} className="hide-compact" />}
            <SortTh label={<>Juros<span className="venc-est">est.</span></>} col="juros" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label="Amort." col="amort" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label={<>A vencer {mesLabelSel || '12m'}</>} col="total" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label="% PL" col="pctPL" sort={detSort} setSort={setDetSort} numeric />
          </tr>
        </thead>
        <tbody>
          {detSorted.map(f => (
            <tr key={f.cnpj}>
              <td className="venc-nome"><span className="venc-ell">{f.nome}</span></td>
              {!gestorSel && <td className="hide-compact"><span className="venc-ell">{f.gestor}</span></td>}
              <td className="num">{f.juros > 0.5 ? fmtBRL(f.juros) : '—'}</td>
              <td className="num">{f.amort > 0.5 ? fmtBRL(f.amort) : '—'}</td>
              <td className="num venc-tot">{fmtBRL(f.total)}</td>
              <td className="num">{f.pctPL != null ? pctFmt(f.pctPL) : '—'}</td>
            </tr>
          ))}
          {!detSorted.length && <tr><td colSpan={gestorSel ? 5 : 6} className="venc-norows">Nenhum fundo nesta janela.</td></tr>}
        </tbody>
      </table>
    )
  } else if (detalheDim === 'grupo') {
    detTable = (
      <table className="venc-table">
        <thead>
          <tr>
            <SortTh label="Grupo" col="nome" sort={detSort} setSort={setDetSort} />
            <SortTh label={<>Juros<span className="venc-est">est.</span></>} col="juros" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label="Amort." col="amort" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label={<>A vencer {mesLabelSel || '12m'}</>} col="total" sort={detSort} setSort={setDetSort} numeric />
          </tr>
        </thead>
        <tbody>
          {detSorted.map(r => (
            <tr key={r.nome}>
              <td className="venc-nome"><span className="venc-ell">{r.nome}</span></td>
              <td className="num">{r.juros > 0.5 ? fmtBRL(r.juros) : '—'}</td>
              <td className="num">{r.amort > 0.5 ? fmtBRL(r.amort) : '—'}</td>
              <td className="num venc-tot">{fmtBRL(r.total)}</td>
            </tr>
          ))}
          {!detSorted.length && <tr><td colSpan={4} className="venc-norows">Nenhum grupo nesta janela.</td></tr>}
        </tbody>
      </table>
    )
  } else {
    detTable = (
      <table className="venc-table venc-deb-table">
        <thead>
          <tr>
            <SortTh label="Ativo" col="ticker" sort={detSort} setSort={setDetSort} />
            <SortTh label="Grupo" col="grupo" sort={detSort} setSort={setDetSort} className="hide-compact" />
            <SortTh label="Emissor" col="emissor" sort={detSort} setSort={setDetSort} />
            <SortTh label={<>Juros<span className="venc-est">est.</span></>} col="juros" sort={detSort} setSort={setDetSort} numeric className="hide-compact" />
            <SortTh label="Amort." col="amort" sort={detSort} setSort={setDetSort} numeric className="hide-compact" />
            <SortTh label={<>A vencer {mesLabelSel || '12m'}</>} col="total" sort={detSort} setSort={setDetSort} numeric />
            <SortTh label="Próx." col="prox" sort={detSort} setSort={setDetSort} />
          </tr>
        </thead>
        <tbody>
          {detSorted.map(d => (
            <tr key={d.ticker}>
              <td className="venc-nome">
                <span className="venc-tk">{d.ticker}</span>
                {d.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
              </td>
              <td className="hide-compact"><span className="venc-ell">{d.grupo}</span></td>
              <td><span className="venc-ell">{d.emissor}</span></td>
              <td className="num hide-compact">{d.juros > 0.5 ? fmtBRL(d.juros) : '—'}</td>
              <td className="num hide-compact">{d.amort > 0.5 ? fmtBRL(d.amort) : '—'}</td>
              <td className="num venc-tot">{fmtBRL(d.total)}</td>
              <td>{d.proxData ? fmtDia(d.proxData) : '—'}</td>
            </tr>
          ))}
          {!detSorted.length && <tr><td colSpan={7} className="venc-norows">Nenhuma debênture nesta janela.</td></tr>}
        </tbody>
      </table>
    )
  }

  const showFoot = (detalheDim !== 'fundo' || fundos.disponivel) && detRows.length > 0
  const detFoot = showFoot && (
    <p className="venc-note">
      {detRows.length} {detalheDim === 'ativo' ? 'ativo(s)' : detalheDim === 'grupo' ? 'grupo(s)' : 'fundo(s)'}
      {detRows.length > DET_CAP ? ` (mostrando os ${DET_CAP} maiores)` : ''} ·
      {' '}total {fmtBRL(detTotal)} (juros {fmtBRL(detJuros)} + amort. {fmtBRL(detAmort)})
    </p>
  )

  const gestorTitle = `Gestores — a vencer ${mesLabelSel || '12m'} · ${seg === '12431' ? '12.431' : 'Tradicional'}`
  const detTitle = `${DETALHES.find(d => d.id === detalheDim)?.label} — ${gestorSel || 'todos os gestores'}${mesLabelSel ? ` · ${mesLabelSel}` : ''}`

  return (
    <div className={`venc${compact ? ' compact' : ''}`}>
      <div className="venc-head">
        <div className="venc-titles">
          <h2 className="fluxo-title">Vencimentos 12 meses</h2>
          <p className="fluxo-subtitle venc-sub">
            Caixa (juros + amortização) que entra{data.refDate ? ` a partir de ${data.refDate}` : ''}.
            {' '}Juros <strong>estimados pelo cupom</strong> ({premLabel}); amortização precisa da agenda.
            {' '}Clique num <strong>gestor</strong> para focar; clique num mês para filtrar.
          </p>
        </div>
        <div className="venc-toggles">
          <div className="segmented" role="tablist" aria-label="Perspectiva">
            <button role="tab" aria-selected={persp === 'carteira'}
              className={`segmented-btn${persp === 'carteira' ? ' active' : ''}`}
              onClick={() => setPersp('carteira')}>Carteira</button>
            <button role="tab" aria-selected={persp === 'mercado'}
              className={`segmented-btn${persp === 'mercado' ? ' active' : ''}`}
              onClick={() => setPersp('mercado')} title={gestorSel ? 'Mercado limpa o gestor selecionado' : undefined}>Mercado</button>
          </div>
          <div className="segmented" role="tablist" aria-label="Segmento de mercado">
            {[['12431', '12.431'], ['trad', 'Tradicional']].map(([id, lbl]) => (
              <button key={id} role="tab" aria-selected={seg === id}
                className={`segmented-btn${seg === id ? ' active' : ''}`}
                onClick={() => setSeg(id)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {temFiltro && (
        <div className="venc-crumbs">
          <span className="venc-crumbs-lbl">Filtros:</span>
          {gestorSel && (
            <button className="venc-chip" onClick={() => setGestorSel(null)} title="Limpar gestor">
              Gestor: <b>{gestorSel}</b> ✕
            </button>
          )}
          {selMes && (
            <button className="venc-chip" onClick={() => setSelMes(null)} title="Limpar mês">
              Mês: <b>{mesLabelSel}</b> ✕
            </button>
          )}
          <button className="venc-chip venc-chip-clear" onClick={limparTudo} title="Limpar todos os filtros">Limpar tudo</button>
        </div>
      )}

      <div className="fluxo-cards venc-cards">
        <div className="fluxo-card">
          <span className="fluxo-card-label">
            {gestorSel ? `${gestorSel}` : persp === 'carteira' ? 'Entra nos fundos' : 'Mercado'} · {mesLabelSel || '12m'}
            {seg === '12431' ? ' · 12.431' : ' · Tradicional'}
          </span>
          <span className="fluxo-card-value">{fmtBRL(card.total)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Juros (est.)</span>
          <span className="fluxo-card-value venc-juros-ink">{fmtBRL(card.juros)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Amortização</span>
          <span className="fluxo-card-value venc-amort-ink">{fmtBRL(card.amort)}</span>
        </div>
      </div>

      <div className="venc-charts">
        <section className="venc-chart-panel">
          <header className="venc-chart-head">
            <h3 className="venc-chart-title">{gestorSel ? gestorSel : persp === 'carteira' ? 'Entra na carteira' : 'Mercado'} · R$</h3>
            <span className="venc-chart-scale">{fmtBRL(mesesView.reduce((s, m) => s + m.total, 0))} em 12m</span>
          </header>
          <MonthBars rows={mesesView} max={maxTotal} selMes={selMes} onPick={pickMes}
            fmtVal={fmtBRL} fmtLabel={fmtBar} ariaLabel="Vencimentos por mês em reais (clique para filtrar)" />
        </section>
        <section className="venc-chart-panel">
          <header className="venc-chart-head">
            <h3 className="venc-chart-title">% do PL · {plSuffix}</h3>
            <span className="venc-chart-scale">{plDenom > 0 ? `${pctFmt(totalPctPeriodo)} ${selMes ? 'no mês' : 'em 12m'}` : 'PL indisponível'}</span>
          </header>
          {plDenom > 0
            ? <MonthBars rows={mesesPL} max={maxPct} selMes={selMes} onPick={pickMes}
                fmtVal={pctFmt} fmtLabel={pctFmt} ariaLabel="Vencimentos por mês em % do PL (clique para filtrar)" />
            : <div className="venc-nopl">Sem PL de <b>{plSuffix}</b> para calcular %PL.</div>}
        </section>
      </div>
      <div className="venc-legend">
        <span><i className="venc-dot venc-seg-juros" /> Juros (estimado)</span>
        <span><i className="venc-dot venc-seg-amort" /> Amortização</span>
        <span className="venc-legend-note">Barras da direita: caixa do mês ÷ PL de {plSuffix}.</span>
      </div>

      {/* Duas tabelas: gestores (seletor) + detalhe (Fundos/Grupos/Ativos). */}
      <div className="venc-tables">
        <div className="venc-table-block">
          {compact
            ? <><h3 className="venc-table-h">{gestorTitle}</h3><div className="venc-scroll">{gestorTable}</div></>
            : <TableWrap title={gestorTitle}>{gestorTable}</TableWrap>}
        </div>
        <div className="venc-table-block">
          <div className="venc-dims">
            <div className="segmented venc-dims-seg" role="tablist" aria-label="Detalhar por">
              {DETALHES.map(d => (
                <button key={d.id} role="tab" aria-selected={detalheDim === d.id}
                  className={`segmented-btn${detalheDim === d.id ? ' active' : ''}`}
                  onClick={() => setDetalheDim(d.id)}>{d.label}</button>
              ))}
            </div>
          </div>
          {compact
            ? <><h3 className="venc-table-h">{detTitle}</h3><div className="venc-scroll">{detTable}</div>{detFoot}</>
            : <TableWrap title={detTitle}>{detTable}{detFoot}</TableWrap>}
        </div>
      </div>

      {data.cobertura && (
        <p className="venc-foot">
          <strong>Piso conservador:</strong> só entram debêntures com agenda de eventos na ANBIMA
          ({data.cobertura.comAgenda} de {data.cobertura.universo}). Papéis sem agenda contribuem com
          R$ 0, então os juros são subestimados — o valor real é maior.
          {data.cobertura.semCache ? ` (${data.cobertura.semCache} sem agenda em cache; rode preparar-agenda.ps1.)` : ''}
        </p>
      )}
    </div>
  )
}

import { useState, useMemo } from 'react'
import { fmtBRL, parseNum } from '../../utils/format.js'
import TableWrap from '../TableWrap.jsx'

// Planejamento de VENCIMENTOS 12m com foco AGREGADO + INVESTIGACAO:
//   - quanto de caixa (juros + amortizacao) entra por mes, em R$ e em %PL;
//   - qualificar o fluxo por fundo (gestor), emissor, grupo ou ativo;
//   - filtro de gestor no topo (otica de um fundo) + drill: clicar num MES filtra
//     os rankings; clicar numa LINHA abre o cronograma daquela entidade.
// O dado granular vive em data.ativos[].eventos (gerar-agenda-12m.mjs); o corte
// por gestor cruza com o BLC (raw.blc) que o app ja carrega para as Debentures.
// O volume outstanding por ativo vem do proprio dataset de debentures (assets:
// Quantidade em Mercado x VNA atual = a coluna "Vol. emit." da aba Debentures).
// Amortizacao = R$ preciso (agenda ANBIMA); juros = R$ ESTIMADO pelo cupom.

function pctFmt(x) {
  if (x == null || isNaN(x)) return '—'
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
// Rotulo compacto pra CABER dentro da barra: sem "R$", com sufixo B/M/k.
function fmtBar(v) {
  const n = Math.abs(v || 0)
  if (n >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}B`
  if (n >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}M`
  if (n >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`
  return (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
function fmtDia(d) {
  // 'yyyy-mm-dd' -> 'dd/mm/yy'
  const s = String(d || '')
  return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : s
}
const SEM_GRUPO = '(sem classificacao)'

// Ordena por uma coluna (accessor). Numeros por valor; texto por localeCompare.
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

// Cabecalho clicavel de ordenacao (mesma logica da asset-table). numeric => alinha
// a direita e ordena desc por padrao (texto ordena asc por padrao).
function SortTh({ label, col, sort, setSort, numeric, className, title }) {
  const active = sort.col === col
  const toggle = () => setSort(s => (s.col === col
    ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: numeric ? 'desc' : 'asc' }))
  return (
    <th
      className={`venc-th-sort${active ? ' active' : ''}${numeric ? ' num' : ''}${className ? ' ' + className : ''}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      title={title}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
    >
      {label}{active && <span className="venc-sort-arrow">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  )
}

const RANK_ACC = {
  nome: r => r.nome,
  emissor: r => r.a?.emissor || '',
  grupo: r => r.a?.grupo || '',
  juros: r => r.juros || 0,
  amort: r => r.amort || 0,
  total: r => r.total || 0,
}
const DEB_ACC = {
  ticker: d => d.ticker,
  grupo: d => d.grupo,
  emissor: d => d.emissor,
  venc: d => d.venc || 0,
  outstanding: d => d.outstanding || 0,
}
const CRONO_ACC = {
  d: ev => ev.d,
  ticker: ev => ev.a.ticker,
  emissor: ev => ev.a.emissor || '',
  evento: ev => ev.t,
  v: ev => ev.v || 0,
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

// Gráfico de barras empilhadas (juros cinza + amortização azul) por mês, sem
// libs. Linha-base cinza (eixo horizontal); cada coluna é clicável para filtrar
// o mês. 3 rótulos por barra: juros no cinza, amort no azul, total acima.
function MonthBars({ rows, max, selMes, onPick, fmtVal, fmtLabel, ariaLabel }) {
  const safeMax = Math.max(1e-9, max)
  const MIN_SEG = 0.10   // fracao minima do max pra caber rotulo dentro do segmento
  return (
    <div className="venc-chart" role="group" aria-label={ariaLabel}>
      <div className="venc-plot">
        {rows.map(m => {
          const barPct = (m.total / safeMax) * 88
          const jPct = m.total > 0 ? (m.juros / m.total) * 100 : 0
          const aPct = m.total > 0 ? (m.amort / m.total) * 100 : 0
          const showJ = m.juros / safeMax >= MIN_SEG
          const showA = m.amort / safeMax >= MIN_SEG
          return (
            <button
              key={m.mes}
              type="button"
              className={`venc-col${selMes === m.mes ? ' sel' : ''}`}
              title={`${m.label}: juros ${fmtVal(m.juros)} + amort. ${fmtVal(m.amort)} = ${fmtVal(m.total)} — clique para ${selMes === m.mes ? 'limpar o filtro' : 'filtrar'}`}
              onClick={() => onPick(m.mes)}
              aria-pressed={selMes === m.mes}
            >
              <span className="venc-bar-total">{m.total > 0.00001 ? fmtLabel(m.total) : ''}</span>
              <span className="venc-bar-wrap" style={{ height: `${barPct}%` }}>
                <span className="venc-seg venc-seg-juros" style={{ height: `${jPct}%` }}>
                  {showJ && <span className="venc-seg-lbl">{fmtLabel(m.juros)}</span>}
                </span>
                <span className="venc-seg venc-seg-amort" style={{ height: `${aPct}%` }}>
                  {showA && <span className="venc-seg-lbl venc-seg-lbl-blue">{fmtLabel(m.amort)}</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="venc-baseline" aria-hidden="true" />
      <div className="venc-axis">
        {rows.map(m => (
          <span key={m.mes} className={`venc-lbl${selMes === m.mes ? ' sel' : ''}`}>{m.label}</span>
        ))}
      </div>
    </div>
  )
}

// Dimensoes de qualificacao do fluxo. "Por fundo" (gestor) so na carteira e some
// quando ja' ha um gestor filtrado no topo (ai o breakdown util e' por emissor/etc).
const DIMS = [
  { id: 'gestor', label: 'Por fundo', carteiraOnly: true },
  { id: 'emissor', label: 'Por emissor' },
  { id: 'grupo', label: 'Por grupo' },
  { id: 'ativo', label: 'Por ativo' },
]
const DIM_NOME = { gestor: 'Fundo', emissor: 'Emissor', grupo: 'Grupo', ativo: 'Ativo' }

export default function VencimentosDashboard({ data, blc, assets, plByGestor, compact }) {
  const [persp, setPerspRaw] = useState('carteira')  // 'carteira' | 'mercado'
  const [dim, setDim] = useState('gestor')            // gestor | emissor | grupo | ativo
  const [selMes, setSelMes] = useState(null)          // 'yyyy-MM' | null
  const [selEnt, setSelEnt] = useState(null)          // { dim, nome } | null
  const [seg, setSeg] = useState('todos')             // 'todos' | '12431' | 'trad'
  const [gestorSel, setGestorSel] = useState(null)    // nome do gestor filtrado no topo | null
  // Ordenacao de cada tabela.
  const [rankSort, setRankSort] = useState({ col: 'total', dir: 'desc' })
  const [debSort, setDebSort] = useState({ col: 'outstanding', dir: 'desc' })
  const [cronoSort, setCronoSort] = useState({ col: 'd', dir: 'asc' })

  const meses = data?.meses || []
  // "Por fundo" nao faz sentido em mercado nem quando ja' filtramos por um gestor.
  const effDim = (dim === 'gestor' && (persp === 'mercado' || gestorSel)) ? 'emissor' : dim
  const matchSeg = a => seg === 'todos' || (seg === '12431' ? !!a.incentivada : !a.incentivada)
  const filtrando = seg !== 'todos'
  const pickMes = m => setSelMes(s => (s === m ? null : m))

  // Mercado nao tem corte por gestor: ao mudar de perspectiva, limpa gestor/drill.
  const setPersp = p => {
    setPerspRaw(p)
    if (p === 'mercado') { setGestorSel(null); if (selEnt?.dim === 'gestor') setSelEnt(null) }
  }
  // Escolher um gestor no topo limpa o drill (mostra os rankings do gestor).
  const pickGestor = g => { setGestorSel(g || null); setSelEnt(null) }

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

  // Volume outstanding por ticker (Qtd em Mercado x VNA atual, ja calculado em
  // enrichDebenture como volumeEmitido). Alimenta a tabela de debentures.
  const outstandingPorTicker = useMemo(() => {
    const m = new Map()
    for (const a of assets || []) {
      const tk = String(a.codigoAtivo || '').trim().toUpperCase()
      if (tk) m.set(tk, a.volumeEmitido || 0)
    }
    return m
  }, [assets])

  // PL total da carteira (soma dos gestores) — denominador do %PL agregado.
  const totalPL = useMemo(() => {
    let s = 0
    for (const k in (plByGestor || {})) s += plByGestor[k] || 0
    return s
  }, [plByGestor])

  // Lista de gestores para o dropdown (ordem alfabetica).
  const gestorNomes = useMemo(
    () => (data?.porGestor || []).map(x => x.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [data]
  )

  // Eventos individuais achatados (cada um com referencia ao ativo).
  const eventos = useMemo(() => {
    const out = []
    for (const a of data?.ativos || []) for (const e of a.eventos || []) out.push({ ...e, a })
    return out
  }, [data])

  // Gestor efetivo (filtro do topo, ou um gestor no drill). Define a fatia da
  // carteira e o denominador do %PL.
  const gestorAtivo = gestorSel || (selEnt?.dim === 'gestor' ? selEnt.nome : null)
  const gestorHolds = (ticker, g) => {
    const o = gestoresPorTicker.get(ticker)
    return !!o && o.rows.some(r => r.g === g)
  }
  const matchGestor = a => !gestorSel || gestorHolds(a.ticker, gestorSel)

  const matchEnt = (a, ent) => {
    if (!ent) return true
    if (ent.dim === 'gestor') return gestorHolds(a.ticker, ent.nome)
    if (ent.dim === 'emissor') return (a.emissor || '') === ent.nome
    if (ent.dim === 'grupo') return (a.grupo || SEM_GRUPO) === ent.nome
    return a.ticker === ent.nome
  }
  // Valor do evento na CARTEIRA; p/ o gestor ativo, a fatia proporcional ao que
  // ele carrega do ticker (mesma proporcionalidade do gerador).
  const ctSliceVal = ev => {
    if (gestorAtivo) {
      const o = gestoresPorTicker.get(ev.a.ticker)
      if (!o || !o.total || !ev.ct) return 0
      const r = o.rows.find(x => x.g === gestorAtivo)
      return r ? ev.ct * (r.v / o.total) : 0
    }
    return ev.ct
  }
  // Valor de um evento cru (e, ticker) na visao atual: com gestor ativo, a fatia
  // da carteira dele; senao carteira usa ct e mercado usa mc.
  const eventoValor = (e, ticker) => {
    if (gestorAtivo) {
      const o = gestoresPorTicker.get(ticker)
      if (!o || !o.total || !e.ct) return 0
      const r = o.rows.find(x => x.g === gestorAtivo)
      return r ? e.ct * (r.v / o.total) : 0
    }
    return persp === 'carteira' ? e.ct : e.mc
  }
  const evVal = ev => eventoValor(ev, ev.a.ticker)

  // Meses do grafico R$ (perspectiva atual). Precomputado so' quando nada filtra.
  const mesesView = useMemo(() => {
    if (!selEnt && !filtrando && !gestorSel) return meses.map(m => ({ mes: m.mes, label: m.label, ...m[persp] }))
    const buckets = new Map(meses.map(m => [m.mes, { mes: m.mes, label: m.label, juros: 0, amort: 0, total: 0 }]))
    for (const ev of eventos) {
      if (!matchSeg(ev.a) || !matchGestor(ev.a) || !matchEnt(ev.a, selEnt)) continue
      const b = buckets.get(ev.d.slice(0, 7))
      if (!b) continue
      const v = evVal(ev)
      if (ev.t === 'J') b.juros += v; else b.amort += v
      b.total += v
    }
    return [...buckets.values()]
  }, [meses, persp, selEnt, seg, gestorSel, eventos, gestoresPorTicker])

  // Meses da CARTEIRA (sempre ct, base do grafico %PL).
  const mesesCarteira = useMemo(() => {
    if (!selEnt && !filtrando && !gestorSel) return meses.map(m => ({ mes: m.mes, label: m.label, ...m.carteira }))
    const buckets = new Map(meses.map(m => [m.mes, { mes: m.mes, label: m.label, juros: 0, amort: 0, total: 0 }]))
    for (const ev of eventos) {
      if (!matchSeg(ev.a) || !matchGestor(ev.a) || !matchEnt(ev.a, selEnt)) continue
      const b = buckets.get(ev.d.slice(0, 7))
      if (!b) continue
      const v = ctSliceVal(ev)
      if (ev.t === 'J') b.juros += v; else b.amort += v
      b.total += v
    }
    return [...buckets.values()]
  }, [meses, selEnt, seg, gestorSel, eventos, gestoresPorTicker])

  const maxTotal = Math.max(1, ...mesesView.map(m => m.total))
  const totJuros = mesesView.reduce((s, m) => s + m.juros, 0)
  const totAmort = mesesView.reduce((s, m) => s + m.amort, 0)
  const totalPeriodo = totJuros + totAmort

  // %PL: caixa do mes (carteira) ÷ PL do gestor ativo (ou a carteira toda).
  const plDenom = gestorAtivo ? (plByGestor?.[gestorAtivo] || 0) : totalPL
  const plSuffix = gestorAtivo || 'carteira'
  const mesesPL = useMemo(() => mesesCarteira.map(m => ({
    mes: m.mes,
    label: m.label,
    juros: plDenom > 0 ? (m.juros / plDenom) * 100 : 0,
    amort: plDenom > 0 ? (m.amort / plDenom) * 100 : 0,
    total: plDenom > 0 ? (m.total / plDenom) * 100 : 0,
  })), [mesesCarteira, plDenom])
  const maxPct = Math.max(0.001, ...mesesPL.map(m => m.total))
  const totalPctPeriodo = mesesPL.reduce((s, m) => s + m.total, 0)

  // Rankings (sem entidade selecionada), respeitando mes/gestor/segmento.
  const rankRows = useMemo(() => {
    if (selEnt) return []
    if (effDim === 'gestor' && !selMes && !filtrando && !gestorSel && data?.porGestor?.length) return data.porGestor
    const m = new Map()
    for (const ev of eventos) {
      if (!matchSeg(ev.a) || !matchGestor(ev.a)) continue
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
      const v = evVal(ev)
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
  }, [selEnt, effDim, selMes, persp, seg, gestorSel, eventos, gestoresPorTicker, data])

  // Lista de debentures na janela atual (respeita segmento, gestor, entidade e mes).
  const debList = useMemo(() => {
    const out = []
    for (const a of data?.ativos || []) {
      if (!matchSeg(a) || !matchGestor(a) || !matchEnt(a, selEnt)) continue
      if (selMes && !(a.eventos || []).some(e => e.d.slice(0, 7) === selMes)) continue
      // "Venc." = juros + amort do ativo no periodo (mesma logica da tabela da
      // esquerda: respeita mes/gestor/perspectiva).
      let venc = 0
      for (const e of a.eventos || []) {
        if (selMes && e.d.slice(0, 7) !== selMes) continue
        venc += eventoValor(e, a.ticker)
      }
      out.push({
        ticker: a.ticker,
        grupo: a.grupo || '—',
        emissor: a.emissor || '—',
        incentivada: !!a.incentivada,
        venc,
        outstanding: outstandingPorTicker.get(String(a.ticker).toUpperCase()) || 0,
      })
    }
    return out.sort((x, y) => y.outstanding - x.outstanding)
  }, [data, selEnt, seg, selMes, persp, gestorSel, outstandingPorTicker, gestoresPorTicker])
  const debTotal = debList.reduce((s, d) => s + d.outstanding, 0)
  const debVencTotal = debList.reduce((s, d) => s + d.venc, 0)
  // Cap de linhas: as 120 MAIORES por outstanding (o total/contagem no rodape
  // refletem a lista inteira). Evita DOM gigante (a janela tem ~2 mil ativos).
  const DEB_CAP = 120

  // Cronograma da entidade selecionada (evento a evento).
  const crono = useMemo(() => {
    if (!selEnt) return []
    return eventos
      .filter(ev => matchEnt(ev.a, selEnt) && matchSeg(ev.a) && matchGestor(ev.a))
      .filter(ev => !selMes || ev.d.slice(0, 7) === selMes)
      .map(ev => ({ ...ev, v: evVal(ev) }))
      .filter(ev => ev.v > 0.5)
  }, [selEnt, selMes, persp, seg, gestorSel, eventos, gestoresPorTicker])

  // Aplica a ordenacao de cada tabela.
  const rankSorted = useMemo(() => applySort(rankRows, rankSort, RANK_ACC), [rankRows, rankSort])
  const cronoSorted = useMemo(() => applySort(crono, cronoSort, CRONO_ACC), [crono, cronoSort])
  const debShown = useMemo(() => applySort(debList.slice(0, DEB_CAP), debSort, DEB_ACC), [debList, debSort])

  const semAgendas = !data || !meses.length || (data.cobertura && data.cobertura.comAgenda === 0)
  if (semAgendas) return <Empty />

  const prem = data.premissas || {}
  const cdiFonte = prem.cdiFonte && prem.cdiFonte !== 'default' ? ` (${prem.cdiFonte})` : ''
  const premLabel = `CDI ${pctFmt((prem.cdi || 0) * 100)}${cdiFonte} · VNA indexado +${pctFmt((prem.inflacaoVna || 0) * 100)} a.a.`
  const mesLabelSel = selMes ? (meses.find(m => m.mes === selMes)?.label || selMes) : null
  const temFiltro = filtrando || selMes || selEnt || gestorSel

  const rankTable = (
    <table className="venc-table">
      <thead>
        <tr>
          <SortTh label={effDim === 'gestor' ? 'Fundo (gestor)' : DIM_NOME[effDim]} col="nome" sort={rankSort} setSort={setRankSort} />
          {effDim === 'ativo' && <SortTh label="Emissor" col="emissor" sort={rankSort} setSort={setRankSort} className="hide-compact" />}
          {effDim === 'ativo' && <SortTh label="Grupo" col="grupo" sort={rankSort} setSort={setRankSort} className="hide-compact" />}
          <SortTh label={<>Juros<span className="venc-est">est.</span></>} col="juros" sort={rankSort} setSort={setRankSort} numeric />
          <SortTh label="Amort." col="amort" sort={rankSort} setSort={setRankSort} numeric />
          <SortTh label={<>Venc.<span className="venc-est">est.</span> {mesLabelSel || '12m'}</>} col="total" sort={rankSort} setSort={setRankSort} numeric />
        </tr>
      </thead>
      <tbody>
        {rankSorted.map(r => (
          <tr key={r.nome} className="venc-row-click" title="Ver cronograma"
              onClick={() => setSelEnt({ dim: effDim, nome: r.nome })}>
            <td className="venc-nome">
              {effDim === 'ativo' ? <span className="venc-tk">{r.nome}</span> : <span className="venc-ell">{r.nome}</span>}
              {effDim === 'ativo' && r.a?.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            {effDim === 'ativo' && <td className="hide-compact"><span className="venc-ell">{r.a?.emissor || '—'}</span></td>}
            {effDim === 'ativo' && <td className="hide-compact"><span className="venc-ell">{r.a?.grupo || '—'}</span></td>}
            <td className="num">{r.juros > 0.5 ? fmtBRL(r.juros) : '—'}</td>
            <td className="num">{r.amort > 0.5 ? fmtBRL(r.amort) : '—'}</td>
            <td className="num venc-tot">{fmtBRL(r.total)}</td>
          </tr>
        ))}
        {!rankSorted.length && (
          <tr><td colSpan={effDim === 'ativo' ? 6 : 4} className="venc-norows">Sem eventos {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
      </tbody>
    </table>
  )

  const cronoTable = (
    <table className="venc-table venc-crono-table">
      <thead>
        <tr>
          <SortTh label="Data" col="d" sort={cronoSort} setSort={setCronoSort} />
          <SortTh label="Ativo" col="ticker" sort={cronoSort} setSort={setCronoSort} />
          <SortTh label="Emissor" col="emissor" sort={cronoSort} setSort={setCronoSort} className="hide-compact" />
          <SortTh label="Evento" col="evento" sort={cronoSort} setSort={setCronoSort} />
          <SortTh label="R$" col="v" sort={cronoSort} setSort={setCronoSort} numeric />
        </tr>
      </thead>
      <tbody>
        {cronoSorted.map((ev, i) => (
          <tr key={`${ev.a.ticker}-${ev.d}-${ev.t}-${i}`}>
            <td>{fmtDia(ev.d)}</td>
            <td>
              <span className="venc-tk">{ev.a.ticker}</span>
              {ev.a.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            <td className="hide-compact">{ev.a.emissor || '—'}</td>
            <td>
              {ev.t === 'J'
                ? <>Juros<span className="venc-est">est.</span></>
                : `Amortização${ev.pct != null ? ` (${ev.pct.toLocaleString('pt-BR')}%)` : ''}`}
            </td>
            <td className="num venc-tot">{fmtBRL(ev.v)}</td>
          </tr>
        ))}
        {!cronoSorted.length && (
          <tr><td colSpan={5} className="venc-norows">Sem eventos {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
      </tbody>
    </table>
  )

  // Tabela de debentures na janela: Ativo, Grupo, Emissor, Vol. outstanding.
  const debTable = (
    <table className="venc-table venc-deb-table">
      <thead>
        <tr>
          <SortTh label="Ativo" col="ticker" sort={debSort} setSort={setDebSort} />
          <SortTh label="Grupo" col="grupo" sort={debSort} setSort={setDebSort} className="hide-compact" />
          <SortTh label="Emissor" col="emissor" sort={debSort} setSort={setDebSort} />
          <SortTh label={<>Venc.<span className="venc-est">est.</span></>} col="venc" sort={debSort} setSort={setDebSort} numeric title="Juros (estimado) + amortização no período" />
          <SortTh label="Outstanding" col="outstanding" sort={debSort} setSort={setDebSort} numeric title="Volume outstanding (Qtd em Mercado × VNA)" />
        </tr>
      </thead>
      <tbody>
        {debShown.map(d => (
          <tr key={d.ticker} className="venc-row-click" title="Ver cronograma do ativo"
              onClick={() => setSelEnt({ dim: 'ativo', nome: d.ticker })}>
            <td className="venc-nome">
              <span className="venc-tk">{d.ticker}</span>
              {d.incentivada && <span className="venc-inc" title="Incentivada (Lei 12.431)">12.431</span>}
            </td>
            <td className="hide-compact">{d.grupo}</td>
            <td>{d.emissor}</td>
            <td className="num venc-tot">{d.venc > 0.5 ? fmtBRL(d.venc) : '—'}</td>
            <td className="num">{d.outstanding > 0 ? fmtBRL(d.outstanding) : '—'}</td>
          </tr>
        ))}
        {!debList.length && (
          <tr><td colSpan={5} className="venc-norows">Nenhuma debênture {mesLabelSel ? `em ${mesLabelSel}` : 'nesta janela'}.</td></tr>
        )}
        {debList.length > DEB_CAP && (
          <tr><td colSpan={5} className="venc-norows">+ {debList.length - DEB_CAP} debênture(s) menor(es) — mostrando as {DEB_CAP} maiores por outstanding.</td></tr>
        )}
      </tbody>
      {debList.length > 0 && (
        <tfoot>
          <tr className="venc-foot-row">
            <td><b>Total · {debList.length}</b></td>
            <td className="hide-compact" />
            <td />
            <td className="num venc-tot">{fmtBRL(debVencTotal)}</td>
            <td className="num venc-tot">{fmtBRL(debTotal)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  )

  const leftTable = selEnt ? cronoTable : rankTable
  const leftTitle = selEnt
    ? `Cronograma — ${selEnt.nome}${mesLabelSel ? ` · ${mesLabelSel}` : ''}`
    : `Vencimentos ${mesLabelSel || '12 meses'} — ${DIMS.find(d => d.id === effDim)?.label || ''}${gestorSel ? ` · ${gestorSel}` : ''}`
  const debTitle = `Debêntures na janela — Vol. outstanding${gestorSel ? ` · ${gestorSel}` : ''}${mesLabelSel ? ` · ${mesLabelSel}` : ''}`

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
          {/* Filtro de gestor (so' faz sentido na carteira). ~60 opcoes -> dropdown. */}
          {persp === 'carteira' && (
            <select className="venc-select" aria-label="Filtrar por gestor"
              value={gestorSel || ''} onChange={e => pickGestor(e.target.value)}>
              <option value="">Todos os gestores</option>
              {gestorNomes.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Todos os filtros ativos numa linha so + "limpar tudo". */}
      {temFiltro && (
        <div className="venc-crumbs">
          <span className="venc-crumbs-lbl">Filtros:</span>
          {filtrando && (
            <button className="venc-chip" onClick={() => setSeg('todos')} title="Limpar tipo">
              Tipo: <b>{seg === '12431' ? '12.431' : 'Tradicional'}</b> ✕
            </button>
          )}
          {gestorSel && (
            <button className="venc-chip" onClick={() => setGestorSel(null)} title="Limpar gestor">
              Gestor: <b>{gestorSel}</b> ✕
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
            onClick={() => { setSeg('todos'); setSelMes(null); setSelEnt(null); setGestorSel(null) }}
            title="Limpar todos os filtros">
            Limpar tudo
          </button>
        </div>
      )}

      <div className="fluxo-cards venc-cards">
        <div className="fluxo-card">
          <span className="fluxo-card-label">
            {(selEnt ? `${DIM_NOME[selEnt.dim]} · 12m` : gestorSel ? `${gestorSel} · 12m` : persp === 'carteira' ? 'Entra nos fundos (12m)' : 'Mercado (12m)')}
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

      {/* Dois graficos lado a lado: R$ (perspectiva atual) e %PL (visao relativa,
          na otica do gestor filtrado/selecionado). */}
      <div className="venc-charts">
        <section className="venc-chart-panel">
          <header className="venc-chart-head">
            <h3 className="venc-chart-title">{persp === 'carteira' ? 'Entra na carteira' : 'Mercado'} · R$</h3>
            <span className="venc-chart-scale">{fmtBRL(totalPeriodo)} em 12m</span>
          </header>
          <MonthBars rows={mesesView} max={maxTotal} selMes={selMes} onPick={pickMes}
            fmtVal={fmtBRL} fmtLabel={fmtBar} ariaLabel="Vencimentos por mês em reais (clique para filtrar)" />
        </section>
        <section className="venc-chart-panel">
          <header className="venc-chart-head">
            <h3 className="venc-chart-title">% do PL · {plSuffix}</h3>
            <span className="venc-chart-scale">{plDenom > 0 ? `${pctFmt(totalPctPeriodo)} em 12m` : 'PL indisponível'}</span>
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

      {/* Seletor de dimensão (some no drill: o cronograma já é a visão granular) */}
      {!selEnt && (
        <div className="venc-dims">
          <div className="segmented venc-dims-seg" role="tablist" aria-label="Qualificar o fluxo">
            {DIMS.filter(d => !(d.carteiraOnly && persp === 'mercado') && !(d.id === 'gestor' && gestorSel)).map(d => (
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

      {/* Duas tabelas lado a lado: fluxo (ranking/cronograma) + debentures da janela. */}
      <div className="venc-tables">
        <div className="venc-table-block">
          {compact
            ? <><h3 className="venc-table-h">{leftTitle}</h3><div className="venc-scroll">{leftTable}</div></>
            : <TableWrap title={leftTitle}>{leftTable}</TableWrap>}
        </div>
        <div className="venc-table-block">
          {compact
            ? <><h3 className="venc-table-h">{debTitle}</h3><div className="venc-scroll">{debTable}</div></>
            : <TableWrap title={debTitle}>{debTable}</TableWrap>}
        </div>
      </div>

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

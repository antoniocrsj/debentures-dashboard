import { useMemo, useState, Suspense } from 'react'
import { parseNum, shortEmissor, fmtDateDDMMYY, fmtTaxa, isYes } from '../utils/format.js'
import { lazyWithRetry } from '../utils/lazyWithRetry.js'
import { agregaNegociosPorSemana, recortaNegociosPorPeriodo, resumoNegociosSecundario } from '../utils/secondary.js'
import TableWrap from './TableWrap.jsx'
import SearchSelect from './SearchSelect.jsx'
import SearchField from './SearchField.jsx'

// Grafico de serie (Recharts) carregado sob demanda: so' entra no bundle quando
// o usuario clica num ativo para ver a evolucao.
const SecondaryChart = lazyWithRetry(() => import('./SecondaryChart.jsx'))
const SecondaryWeeklyChart = lazyWithRetry(() => import('./SecondaryWeeklyChart.jsx'))

// Colunas do mercado secundario. Uma linha = um TRADE (ativo negociado
// num dia). Data (short date) + a taxa negociada no dia (min/med/max) e o volume;
// depois as caracteristicas da emissao (vencimento, duration e taxa de emissao),
// cruzadas do cadastro por ticker.
const COLS = [
  { id: 'data',      label: 'Liq.',       sticky: true,  sortable: true  },
  { id: 'ativo',     label: 'Ativo',      sticky: true,  sortable: true  },
  { id: 'taxa',      label: 'Tx méd.',    sticky: false, sortable: true  },
  { id: 'spreadRef', label: 'Spread ref.', sticky: false, sortable: false },
  { id: 'volume',    label: 'Volume',     sticky: false, sortable: true  },
  { id: 'vencimento',label: 'Venc.',      sticky: false, sortable: true  },
  { id: 'duration',  label: 'Duration',   sticky: false, sortable: false },
  { id: 'txEmissao', label: 'Tx emissão', sticky: false, sortable: false },
]

const FAIXAS = ['Superior a 5MM', 'Entre 1MM e 5MM', 'Até 1MM']   // filtro de volume (derivado do R$ real)

const PERIODOS = [
  { id: '3m', label: '3m', months: 3 },
  { id: '6m', label: '6m', months: 6 },
  { id: '12m', label: '12m', months: 12 },
]

function fmtTx(v) { return (v && v !== '--') ? `${v}%` : '-' }
// Volume de mercado em R$ real (base Mercado Verdadeiro): MM com 1 casa; "mil" abaixo de 1MM.
function fmtVolRs(v) {
  if (v == null || !(v > 0)) return '-'
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MM`
  return `R$ ${Math.round(v / 1e3).toLocaleString('pt-BR')} mil`
}
function fmtVolKpi(v) {
  if (v == null || !(v > 0)) return 'R$ 0'
  if (v >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
  return `R$ ${Math.round(v / 1e3).toLocaleString('pt-BR')} mil`
}

export default function SecondaryTable({ trades, secRef, dias, desktop }) {
  const [busca, setBusca] = useState('')
  const [data, setData] = useState('')
  const [grupo, setGrupo] = useState('')
  const [emissor, setEmissor] = useState('')
  const [ativo, setAtivo] = useState('')
  const [faixa, setFaixa] = useState('')
  const [periodo, setPeriodo] = useState('6m')
  const [lei, setLei] = useState('')   // '' todos · 'sim' 12.431 · 'nao' tradicional
  const [selAtivo, setSelAtivo] = useState('')   // ativo clicado -> foca o grafico (master-detail)
  const [sort, setSort] = useState({ col: 'data', dir: 'desc' })  // pregao mais recente primeiro
  const [verTudo, setVerTudo] = useState(false)  // compacto: abre no ultimo pregao; expande p/ o historico

  const onSort = id => setSort(s => ({ col: id, dir: s.col === id && s.dir === 'desc' ? 'asc' : 'desc' }))
  // Os 5 pregoes mais recentes: a tabela abre neles (sem filtro). Com qualquer
  // filtro ou "ver tudo", mostra todo o historico.
  const periodoMeses = PERIODOS.find(p => p.id === periodo)?.months ?? 6
  const tradesPeriodo = useMemo(() => recortaNegociosPorPeriodo(trades, periodoMeses), [trades, periodoMeses])
  const dias5Recentes = useMemo(() => new Set([...new Set(tradesPeriodo.map(t => t.data))].sort().slice(-5)), [tradesPeriodo])

  const opts = useMemo(() => ({
    datas:     [...new Set(tradesPeriodo.map(a => a.data).filter(Boolean))].sort().reverse(),
    grupos:    [...new Set(tradesPeriodo.map(a => a.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    emissores: [...new Set(tradesPeriodo.map(a => a.emissorNome).filter(e => e && e !== '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    ativos:    [...new Set(tradesPeriodo.map(a => a.codigoAtivo).filter(Boolean))].sort(),
  }), [tradesPeriodo])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let rows = tradesPeriodo
    if (q) rows = rows.filter(a =>
      a.codigoAtivo.toLowerCase().includes(q) ||
      (a.grupo || '').toLowerCase().includes(q) ||
      (a.emissorNome || '').toLowerCase().includes(q))
    if (data)    rows = rows.filter(a => a.data === data)
    if (grupo)   rows = rows.filter(a => a.grupo === grupo)
    if (emissor) rows = rows.filter(a => a.emissorNome === emissor)
    if (ativo)   rows = rows.filter(a => a.codigoAtivo === ativo)
    if (faixa)   rows = rows.filter(a => a.faixaVolume === faixa)
    if (lei)     rows = rows.filter(a => lei === 'sim' ? isYes(a.lei12431) : !isYes(a.lei12431))
    const dir = sort.dir === 'asc' ? 1 : -1
    const key = {
      data:       a => a.data,
      ativo:      a => a.codigoAtivo,
      taxa:       a => a.taxaMedNum || 0,
      volume:     a => a.volumeRs || 0,
      vencimento: a => a.vencimento || '',
    }[sort.col]
    // desempate estavel: dentro da mesma chave, data desc e depois ticker
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      if (a.data !== b.data) return a.data < b.data ? 1 : -1
      return a.codigoAtivo < b.codigoAtivo ? -1 : 1
    })
  }, [tradesPeriodo, busca, data, grupo, emissor, ativo, faixa, lei, sort])

  // Grafico: CLICAR num ativo na tabela/card (selAtivo) foca o grafico no
  // historico completo daquele papel; na falta, cai no conjunto FILTRADO
  // (grupo/emissor/ativo/busca). Sem nada -> aviso.
  const temFoco = !!(selAtivo || data || grupo || emissor || ativo || busca.trim())
  const focoLabel = selAtivo || ativo || emissor || grupo || (busca.trim() ? `"${busca.trim()}"` : '') || (data ? fmtDateDDMMYY(data) : '')
  // Linhas que alimentam o grafico: o ativo clicado (todos os pregoes dele) tem
  // prioridade; senao, o conjunto filtrado da tabela.
  const chartRows = useMemo(() => {
    // Ativo focado: seu historico completo, mas RESPEITANDO o filtro de Volume
    // (o >5MM tem que valer tambem no grafico).
    if (selAtivo) return tradesPeriodo.filter(t =>
      t.codigoAtivo === selAtivo &&
      (!data || t.data === data) &&
      (!faixa || t.faixaVolume === faixa))
    if (data || grupo || emissor || ativo || busca.trim()) return filtrados
    return null
  }, [selAtivo, tradesPeriodo, filtrados, data, grupo, emissor, ativo, busca, faixa])
  const nAtivosFiltro = useMemo(() => chartRows ? new Set(chartRows.map(f => f.codigoAtivo)).size : 0, [chartRows])
  const serieGrafico = useMemo(() => {
    if (!chartRows || !chartRows.length) return null
    const avg = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
    const porData = new Map()
    for (const t of chartRows) {
      if (!porData.has(t.data)) porData.set(t.data, [])
      porData.get(t.data).push(t)
    }

    // O grafico mostra o SPREAD sobre a referencia (metodologia do "Spread ref.",
    // ja' pre-calculado em cada trade). IPCA -> bps sobre NTN-B; DI+/%DI/Pre -> %
    // sobre CDI (ou DI). Como as unidades diferem, um grafico usa UMA referencia:
    // a familia com mais ativos no foco. Foco de um ativo so' -> sempre homogeneo.
    const famDe = r => r.spreadRef ? (r.spreadRef.tipo === 'IPCA' ? 'bps' : 'pct') : null
    const ativosBps = new Set(), ativosPct = new Set()
    for (const t of chartRows) {
      const f = famDe(t)
      if (f === 'bps') ativosBps.add(t.codigoAtivo)
      else if (f === 'pct') ativosPct.add(t.codigoAtivo)
    }
    const fam = (!ativosBps.size && !ativosPct.size) ? null
      : (ativosBps.size >= ativosPct.size ? 'bps' : 'pct')

    if (fam) {
      const pontos = [...porData.entries()].map(([data, rows]) => {
        const mesmos = rows.filter(r => famDe(r) === fam)
        const sps = mesmos.map(r => r.spreadRef.spreadNum).filter(v => v != null && !isNaN(v))
        if (!sps.length) return null
        return {
          data,
          spMin: Math.min(...sps),
          spMed: avg(sps),
          spMax: Math.max(...sps),
          n: new Set(mesmos.map(r => r.codigoAtivo)).size,
        }
      }).filter(Boolean).sort((a, b) => a.data.localeCompare(b.data))

      if (pontos.length) {
        let refLabel = 'NTN-B'
        if (fam === 'pct') {
          const tipos = new Set(chartRows.filter(r => famDe(r) === 'pct').map(r => r.spreadRef.tipo))
          refLabel = (tipos.has('DI+') || tipos.has('%DI')) ? 'CDI' : 'DI'
        }
        return { pontos, modo: 'spread', unidade: fam, refLabel }
      }
    }

    // Sem spread calculavel (IGP-M, sem curva do dia...) -> cai na taxa crua.
    const pontos = [...porData.entries()].map(([data, rows]) => ({
      data,
      txMin: avg(rows.map(r => parseNum(r.taxaMin)).filter(Boolean)),
      txMed: avg(rows.map(r => r.taxaMedNum).filter(Boolean)),
      txMax: avg(rows.map(r => parseNum(r.taxaMax)).filter(Boolean)),
      n: new Set(rows.map(r => r.codigoAtivo)).size,
    })).sort((a, b) => a.data.localeCompare(b.data))
    return { pontos, modo: 'taxa' }
  }, [chartRows])

  // Tabela de ativos do GRUPO selecionado (abaixo da tabela de trades): 1 linha por ativo,
  // ordenada por LIQUIDEZ nos ultimos 40 pregoes (soma da faixa de volume). Clicar
  // filtra a tabela da esquerda + foca o grafico (serve de atalho).
  const dias40 = useMemo(
    () => new Set([...new Set(tradesPeriodo.map(t => t.data))].sort().slice(-40)),
    [tradesPeriodo],
  )
  const grupoAtivos = useMemo(() => {
    if (!grupo) return null
    const porAtivo = new Map()
    for (const t of tradesPeriodo) {
      if (t.grupo !== grupo) continue
      let a = porAtivo.get(t.codigoAtivo)
      if (!a) { a = { ticker: t.codigoAtivo, vencimento: t.vencimento, duration: t.duration, ultima: '', spread: null, liq: 0 }; porAtivo.set(t.codigoAtivo, a) }
      if (dias40.has(t.data)) a.liq += (t.volumeRs || 0)
      if (t.data > a.ultima) { a.ultima = t.data; a.spread = t.spreadRef; a.vencimento = t.vencimento; a.duration = t.duration }
    }
    return [...porAtivo.values()].sort((x, y) => y.liq - x.liq || (x.ticker < y.ticker ? -1 : 1))
  }, [grupo, tradesPeriodo, dias40])

  // Clicar num ativo foca o grafico (toggle: clicar de novo solta). Independe dos
  // filtros da tabela (master-detail).
  const onClickAtivo = cod => setSelAtivo(s => (s === cod ? '' : cod))
  const limpar = () => { setBusca(''); setData(''); setGrupo(''); setEmissor(''); setAtivo(''); setFaixa(''); setLei(''); setSelAtivo('') }
  const mudarPeriodo = id => { setPeriodo(id); setData('') }
  const temFiltro = busca || data || grupo || emissor || ativo || faixa || lei

  // Compacto: por padrao mostra so' o ultimo pregao (perf -- evita renderizar todo
  // o historico em cards). Com filtro ou "ver tudo", mostra todos os filtrados.
  // A tabela abre no pregao MAIS RECENTE (desktop E compacto). Com 40 dias de
  // historico, renderizar tudo (15k+ linhas) travava o desktop; o historico por
  // ATIVO vive no GRAFICO (clique). Filtro / "ver historico" expandem, sempre com
  // um TETO de render p/ nunca travar.
  const MAX_LINHAS = 1500
  const soUltimoPregao = !temFiltro && !verTudo
  const baseLinhas = useMemo(
    () => soUltimoPregao ? filtrados.filter(t => dias5Recentes.has(t.data)) : filtrados,
    [soUltimoPregao, filtrados, dias5Recentes],
  )
  const linhasDosIndicadores = useMemo(
    () => selAtivo ? filtrados.filter(t => t.codigoAtivo === selAtivo) : filtrados,
    [filtrados, selAtivo],
  )
  const linhasDoGraficoSemanal = useMemo(
    () => selAtivo ? filtrados.filter(t => t.codigoAtivo === selAtivo) : filtrados,
    [filtrados, selAtivo],
  )
  const resumoNegocios = useMemo(() => resumoNegociosSecundario(linhasDosIndicadores), [linhasDosIndicadores])
  const serieSemanal = useMemo(() => agregaNegociosPorSemana(linhasDoGraficoSemanal), [linhasDoGraficoSemanal])
  const linhasVisiveis = baseLinhas.length > MAX_LINHAS ? baseLinhas.slice(0, MAX_LINHAS) : baseLinhas
  const escondidos = filtrados.length - baseLinhas.length
  const capExcedido = baseLinhas.length - linhasVisiveis.length

  if (!trades.length) {
    return (
      <div className="empty-state">
        <span>Sem negócios de mercado</span>
        <small>Base de trade a mercado (≥ R$ 5 MM/dia). Rode a varredura (varredura-mercado).</small>
      </div>
    )
  }

  // Tabela dos ativos do grupo (abaixo dos trades). Clicar filtra a principal + foca
  // o grafico (seta o filtro 'ativo'); clicar de novo solta.
  const grupoTabela = grupoAtivos && grupoAtivos.length > 0 && (
    <div className="sec-grupo-ativos">
      <div className="table-wrap sec-grupo-wrap">
        <table className="asset-table sec-table sec-grupo-table">
          <thead>
            <tr>
              <th className="th-nosort">Ativo</th>
              <th className="th-nosort">Venc.</th>
              <th className="th-nosort">Duration</th>
              <th className="th-nosort">Spread ref.</th>
            </tr>
          </thead>
          <tbody>
            {grupoAtivos.map(a => (
              <tr key={a.ticker}
                className={`sec-row-click filter-row${ativo === a.ticker ? ' sec-row-active is-filter-active' : ''}`}
                onClick={() => setAtivo(v => (v === a.ticker ? '' : a.ticker))}
                aria-selected={ativo === a.ticker}
                title={`Filtrar ${a.ticker} na tabela e no gráfico`}>
                <td className="col-ativo"><span className="ativo-code">{a.ticker}</span></td>
                <td className="col-num">{a.vencimento ? fmtDateDDMMYY(a.vencimento) : '-'}</td>
                <td className="col-num">{(a.duration && a.duration !== '—') ? a.duration : '-'}</td>
                <td className="col-num col-spread">{a.spread ? a.spread.formatada : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const cardsResumo = (
    <div className="sec-kpis-toolbar">
      <div className="fluxo-cards sec-kpis" aria-label="Resumo dos negócios filtrados">
        <div className="fluxo-card">
          <span className="fluxo-card-label">Volume 12.431</span>
          <span className="fluxo-card-value">{fmtVolKpi(resumoNegocios.volume12431)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Volume tradicional</span>
          <span className="fluxo-card-value">{fmtVolKpi(resumoNegocios.volumeTradicional)}</span>
        </div>
        <div className="fluxo-card">
          <span className="fluxo-card-label">Número de trades</span>
          <span className="fluxo-card-value">{resumoNegocios.numeroTrades.toLocaleString('pt-BR')}</span>
        </div>
      </div>
      {desktop && (temFiltro || selAtivo) && (
        <button type="button" className="btn btn-limpar sec-kpis-clear" onClick={limpar}>Limpar</button>
      )}
    </div>
  )

  const graficoSemanal = serieSemanal.length > 0 && (
    <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico semanal…</div>}>
      <SecondaryWeeklyChart serie={serieSemanal} />
    </Suspense>
  )

  return (
    <>

      <div className="fluxo-filters sec-filters">
        <div className="fluxo-filters-row">
          <div className="fluxo-field fluxo-field-grow">
            <span className="fluxo-field-label">Buscar</span>
            <SearchField wrapClassName="sec-search-wrap" placeholder="Buscar…"
              value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar no mercado secundário" />
          </div>
          <div className="fluxo-field sec-field-data">
            <span className="fluxo-field-label">Liquidação</span>
            <select className="sec-input sec-date-input" value={data} onChange={e => setData(e.target.value)}
              aria-label="Filtrar mercado secundario por data de liquidacao">
              <option value="">Liq: todas</option>
              {opts.datas.map(d => <option key={d} value={d}>Liq. {fmtDateDDMMYY(d)}</option>)}
            </select>
          </div>
          <div className="fluxo-field sec-field-sel">
            <span className="fluxo-field-label">Grupo</span>
            <SearchSelect label="Grupo" value={grupo} options={opts.grupos} onChange={setGrupo} />
          </div>
          <div className="fluxo-field sec-field-sel">
            <span className="fluxo-field-label">Emissor</span>
            <SearchSelect label="Emissor" value={emissor} options={opts.emissores} onChange={setEmissor} />
          </div>
          <div className="fluxo-field sec-field-sel">
            <span className="fluxo-field-label">Ativo</span>
            <SearchSelect label="Ativo" value={ativo} options={opts.ativos} onChange={setAtivo} />
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">Volume</span>
            {(() => {
              // Sweep (‹ valor ›) em vez do segmentado: percorre as faixas em ordem
              // decrescente de tamanho. Total → >5MM → 1–5MM → Até 1MM.
              const VOLS = [['', 'R$: Total'], ['Superior a 5MM', '> 5MM'], ['Entre 1MM e 5MM', '1–5MM'], ['Até 1MM', 'Até 1MM']]
              const vi = Math.max(0, VOLS.findIndex(([v]) => v === faixa))
              return (
                <div className="corte-step corte-step-vol">
                  <div className="corte-step-box">
                    <button type="button" className="corte-step-btn" aria-label="Faixa de volume maior"
                      disabled={vi <= 0} onClick={() => vi > 0 && setFaixa(VOLS[vi - 1][0])}>‹</button>
                    <span className="corte-step-val" aria-live="polite">{VOLS[vi][1]}</span>
                    <button type="button" className="corte-step-btn" aria-label="Faixa de volume menor"
                      disabled={vi >= VOLS.length - 1} onClick={() => vi < VOLS.length - 1 && setFaixa(VOLS[vi + 1][0])}>›</button>
                  </div>
                </div>
              )
            })()}
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">12.431</span>
            <div className="segmented" role="tablist" aria-label="Incentivada (Lei 12.431)">
              {[['sim', '12.431'], ['nao', 'Tradicional']].map(([v, lab]) => (
                <button key={v} type="button" role="tab" aria-selected={lei === v}
                  className={`segmented-btn${lei === v ? ' active' : ''}`}
                  onClick={() => setLei(cur => cur === v ? '' : v)}>{lab}</button>
              ))}
            </div>
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">Período</span>
            <div className="segmented sec-periodo" role="tablist" aria-label="Período dos negócios">
              {PERIODOS.map(p => (
                <button key={p.id} type="button" role="tab" aria-selected={periodo === p.id}
                  className={`segmented-btn${periodo === p.id ? ' active' : ''}`}
                  onClick={() => mudarPeriodo(p.id)}>{p.label}</button>
              ))}
            </div>
          </div>
          {!desktop && (temFiltro || selAtivo) && (
            <div className="fluxo-field">
              <span className="fluxo-field-label">&nbsp;</span>
              <button type="button" className="btn btn-limpar" onClick={limpar}>Limpar</button>
            </div>
          )}
        </div>
      </div>

      {desktop ? (
      <div className="sec-split">
       <div className="sec-split-table">
        <TableWrap title="Mercado secundário">
        <table className="asset-table sec-table">
          <colgroup>
            <col className="c-data" />
            <col className="c-ativo" />
            <col className="c-tx3" />
            <col className="c-spread" />
            <col className="c-volume" />
            <col className="c-venc" />
            <col className="c-dur" />
            <col className="c-txemi" />
          </colgroup>
          <thead>
            <tr>
              {COLS.map(col => (
                <th
                  key={col.id}
                  className={`${col.sticky ? 'col-sticky' : ''}${col.sortable ? '' : ' th-nosort'}`}
                  onClick={col.sortable ? () => onSort(col.id) : undefined}
                  aria-sort={sort.col === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {col.label}
                  {sort.col === col.id && <span className="sort-arrow">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="col-sticky">Nenhum negócio com esses filtros.</td></tr>
            )}
            {linhasVisiveis.map((a, i) => (
              <tr key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={`sec-row-click filter-row${selAtivo === a.codigoAtivo ? ' sec-row-active is-filter-active' : ''}`}
                onClick={() => onClickAtivo(a.codigoAtivo)}
                aria-selected={selAtivo === a.codigoAtivo}
                title={`Ver a evolução de ${a.codigoAtivo} no gráfico`}>
                <td className="col-sticky col-num col-data">{fmtDateDDMMYY(a.data)}</td>
                <td className="col-sticky col-ativo">
                  <div className="ativo-cell">
                    <div>
                      <span className="ativo-code">{a.codigoAtivo || '-'}</span>
                      {a.grupo && (() => {
                        const emi = shortEmissor(a.emissorNome, a.grupo)
                        return (
                          <span className="ativo-grupo" title={a.emissorNome !== '—' ? a.emissorNome : undefined}>
                            {a.grupo}{emi && <span className="ativo-emissor"> ({emi})</span>}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                </td>
                <td className="col-num">{fmtTx(a.taxaMed)}</td>
                <td className="col-num col-spread" title={a.spreadRef?.ref || undefined}>
                  {a.spreadRef ? a.spreadRef.formatada : '-'}
                </td>
                <td className="col-num">{fmtVolRs(a.volumeRs)}</td>
                <td className="col-num">{a.vencimento ? fmtDateDDMMYY(a.vencimento) : '-'}</td>
                <td className="col-num">{(a.duration && a.duration !== '—') ? a.duration : '-'}</td>
                <td className="col-num">{a.txEmissao ? fmtTaxa(a.txEmissao) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableWrap>
         {capExcedido > 0 && (
           <p className="sec-cap-nota">Mostrando {MAX_LINHAS.toLocaleString('pt-BR')} de {baseLinhas.length.toLocaleString('pt-BR')} negócios — refine os filtros p/ ver o resto.</p>
         )}
         {grupoTabela}
        </div>

       <aside className="sec-split-chart">
        {cardsResumo}
        {serieGrafico
          ? (
            <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico…</div>}>
              <SecondaryChart serie={serieGrafico.pontos} modo={serieGrafico.modo} unidade={serieGrafico.unidade} refLabel={serieGrafico.refLabel} titulo={focoLabel} nAtivos={nAtivosFiltro} />
            </Suspense>
          )
          : (
            <div className="sec-chart-empty">
              <span className="sec-chart-empty-ic">📈</span>
              Selecione um ativo, emissor ou grupo para ver a evolução da taxa.
            </div>
          )}
        {graficoSemanal}
       </aside>
      </div>
      ) : (
      <>
      {cardsResumo}
      <div className="sec-cards-wrap">
        {serieGrafico && (
          <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico…</div>}>
            <SecondaryChart serie={serieGrafico.pontos} modo={serieGrafico.modo} unidade={serieGrafico.unidade} refLabel={serieGrafico.refLabel} titulo={focoLabel} nAtivos={nAtivosFiltro} />
          </Suspense>
        )}
        {graficoSemanal}
        {!temFiltro && (verTudo || escondidos > 0) && (
          <button type="button" className="sec-cards-toggle" onClick={() => setVerTudo(v => !v)}>
            {verTudo
              ? 'Mostrar só o último pregão'
              : `Ver histórico completo · +${escondidos.toLocaleString('pt-BR')} negócios`}
          </button>
        )}
        {capExcedido > 0 && (
          <p className="sec-cap-nota">Mostrando {MAX_LINHAS.toLocaleString('pt-BR')} de {baseLinhas.length.toLocaleString('pt-BR')} — refine os filtros.</p>
        )}
        <div className="sec-cards">
          {linhasVisiveis.length === 0 && (
            <div className="sec-card sec-card-empty">Nenhum negócio com esses filtros.</div>
          )}
          {linhasVisiveis.map((a, i) => {
            const emi = a.grupo ? shortEmissor(a.emissorNome, a.grupo) : ''
            return (
              <div key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={`sec-card sec-card-click${selAtivo === a.codigoAtivo ? ' sec-card-active' : ''}`}
                onClick={() => onClickAtivo(a.codigoAtivo)}>
                <div className="sec-card-top">
                  <div className="sec-card-ativo">
                    <span className="ativo-code">{a.codigoAtivo || '-'}</span>
                    {a.grupo && (
                      <span className="ativo-grupo" title={a.emissorNome !== '—' ? a.emissorNome : undefined}>
                        {a.grupo}{emi && <span className="ativo-emissor"> ({emi})</span>}
                      </span>
                    )}
                  </div>
                  <span className="sec-card-data">{fmtDateDDMMYY(a.data)}</span>
                </div>
                <div className="sec-card-mid">
                  <span className="sec-card-taxa">{fmtTx(a.taxaMed)}</span>
                  {a.spreadRef && (
                    <span className={`sec-card-spread${a.spreadRef.spreadNum < 0 ? ' neg' : ''}`} title={a.spreadRef.ref || undefined}>
                      {a.spreadRef.formatada}
                    </span>
                  )}
                </div>
                <div className="sec-card-meta">
                  <span>{a.indexador || '-'}</span>
                  {a.vencimento && <><span className="sec-card-sep">·</span><span>venc {fmtDateDDMMYY(a.vencimento)}</span></>}
                  <span className="sec-card-sep">·</span><span>{fmtVolRs(a.volumeRs)}</span>
                </div>
              </div>
            )
          })}
        </div>
        {grupoTabela}
      </div>
      </>
      )}
    </>
  )
}

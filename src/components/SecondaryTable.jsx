import { useMemo, useState, Suspense } from 'react'
import { parseNum, shortEmissor, fmtDateDDMMYY, fmtTaxa, isYes } from '../utils/format.js'
import { lazyWithRetry } from '../utils/lazyWithRetry.js'
import TableWrap from './TableWrap.jsx'
import SearchSelect from './SearchSelect.jsx'

// Grafico de serie (Recharts) carregado sob demanda: so' entra no bundle quando
// o usuario clica num ativo para ver a evolucao.
const SecondaryChart = lazyWithRetry(() => import('./SecondaryChart.jsx'))

// Colunas do mercado secundario (REUNE). Uma linha = um TRADE (ativo negociado
// num dia). Data (short date) + a taxa negociada no dia (min/med/max) e o volume;
// depois as caracteristicas da emissao (vencimento, duration, taxa de emissao,
// indexador, 12.431), cruzadas do cadastro por ticker.
const COLS = [
  { id: 'data',      label: 'Data',       sticky: true,  sortable: true  },
  { id: 'ativo',     label: 'Ativo',      sticky: false, sortable: true  },
  { id: 'taxa',      label: 'Tx méd.',    sticky: false, sortable: true  },
  { id: 'spreadRef', label: 'Spread ref.', sticky: false, sortable: false },
  { id: 'volume',    label: 'Volume',     sticky: false, sortable: true  },
  { id: 'vencimento',label: 'Venc.',      sticky: false, sortable: true  },
  { id: 'duration',  label: 'Duration',   sticky: false, sortable: false },
  { id: 'txEmissao', label: 'Tx emissão', sticky: false, sortable: false },
  { id: 'indexador', label: 'Indexador',  sticky: false, sortable: false },
  { id: 'lei12431',  label: '12.431',     sticky: false, sortable: false },
]

const FAIXAS = ['Superior a 5MM', 'Entre 1MM e 5MM', 'Até 1MM']

function fmtTx(v) { return (v && v !== '--') ? `${v}%` : '-' }
// Rotulo curto da faixa de volume (p/ os cards do compacto).
const FAIXA_CURTA = { 'Superior a 5MM': '> 5 MM', 'Entre 1MM e 5MM': '1–5 MM', 'Até 1MM': 'Até 1 MM' }

export default function SecondaryTable({ trades, reuneRef, dias, desktop }) {
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [emissor, setEmissor] = useState('')
  const [ativo, setAtivo] = useState('')
  const [faixa, setFaixa] = useState('')
  const [lei, setLei] = useState('')   // '' todos · 'sim' 12.431 · 'nao' tradicional
  const [selAtivo, setSelAtivo] = useState('')   // ativo clicado -> foca o grafico (master-detail)
  const [sort, setSort] = useState({ col: 'data', dir: 'desc' })  // pregao mais recente primeiro
  const [verTudo, setVerTudo] = useState(false)  // compacto: abre no ultimo pregao; expande p/ o historico

  const onSort = id => setSort(s => ({ col: id, dir: s.col === id && s.dir === 'desc' ? 'asc' : 'desc' }))
  // Pregao mais recente do historico (compacto abre so' nele, por performance).
  const dataRecente = useMemo(() => trades.reduce((mx, t) => (t.data > mx ? t.data : mx), ''), [trades])

  const opts = useMemo(() => ({
    grupos:    [...new Set(trades.map(a => a.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    emissores: [...new Set(trades.map(a => a.emissorNome).filter(e => e && e !== '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    ativos:    [...new Set(trades.map(a => a.codigoAtivo).filter(Boolean))].sort(),
  }), [trades])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let rows = trades
    if (q) rows = rows.filter(a =>
      a.codigoAtivo.toLowerCase().includes(q) ||
      (a.grupo || '').toLowerCase().includes(q) ||
      (a.emissorNome || '').toLowerCase().includes(q))
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
      volume:     a => a.volRank,
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
  }, [trades, busca, grupo, emissor, ativo, faixa, lei, sort])

  // Grafico: CLICAR num ativo na tabela/card (selAtivo) foca o grafico no
  // historico completo daquele papel; na falta, cai no conjunto FILTRADO
  // (grupo/emissor/ativo/busca). Sem nada -> aviso.
  const temFoco = !!(selAtivo || grupo || emissor || ativo || busca.trim())
  const focoLabel = selAtivo || ativo || emissor || grupo || (busca.trim() ? `"${busca.trim()}"` : '')
  // Linhas que alimentam o grafico: o ativo clicado (todos os pregoes dele) tem
  // prioridade; senao, o conjunto filtrado da tabela.
  const chartRows = useMemo(() => {
    if (selAtivo) return trades.filter(t => t.codigoAtivo === selAtivo)
    if (grupo || emissor || ativo || busca.trim()) return filtrados
    return null
  }, [selAtivo, trades, filtrados, grupo, emissor, ativo, busca])
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

  // Tabela de ativos do GRUPO selecionado (abaixo do grafico): 1 linha por ativo,
  // ordenada por LIQUIDEZ nos ultimos 40 pregoes (soma da faixa de volume). Clicar
  // filtra a tabela da esquerda + foca o grafico (serve de atalho).
  const dias40 = useMemo(
    () => new Set([...new Set(trades.map(t => t.data))].sort().slice(-40)),
    [trades],
  )
  const grupoAtivos = useMemo(() => {
    if (!grupo) return null
    const porAtivo = new Map()
    for (const t of trades) {
      if (t.grupo !== grupo) continue
      let a = porAtivo.get(t.codigoAtivo)
      if (!a) { a = { ticker: t.codigoAtivo, vencimento: t.vencimento, duration: t.duration, ultima: '', spread: null, liq: 0 }; porAtivo.set(t.codigoAtivo, a) }
      if (dias40.has(t.data)) a.liq += (t.volRank || 0)
      if (t.data > a.ultima) { a.ultima = t.data; a.spread = t.spreadRef; a.vencimento = t.vencimento; a.duration = t.duration }
    }
    return [...porAtivo.values()].sort((x, y) => y.liq - x.liq || (x.ticker < y.ticker ? -1 : 1))
  }, [grupo, trades, dias40])

  // Clicar num ativo foca o grafico (toggle: clicar de novo solta). Independe dos
  // filtros da tabela (master-detail).
  const onClickAtivo = cod => setSelAtivo(s => (s === cod ? '' : cod))
  const limpar = () => { setBusca(''); setGrupo(''); setEmissor(''); setAtivo(''); setFaixa(''); setLei(''); setSelAtivo('') }
  const temFiltro = busca || grupo || emissor || ativo || faixa || lei

  // Compacto: por padrao mostra so' o ultimo pregao (perf -- evita renderizar todo
  // o historico em cards). Com filtro ou "ver tudo", mostra todos os filtrados.
  // A tabela abre no pregao MAIS RECENTE (desktop E compacto). Com 40 dias de
  // historico, renderizar tudo (15k+ linhas) travava o desktop; o historico por
  // ATIVO vive no GRAFICO (clique). Filtro / "ver historico" expandem, sempre com
  // um TETO de render p/ nunca travar.
  const MAX_LINHAS = 1500
  const soUltimoPregao = !temFiltro && !verTudo
  const baseLinhas = soUltimoPregao ? filtrados.filter(t => t.data === dataRecente) : filtrados
  const linhasVisiveis = baseLinhas.length > MAX_LINHAS ? baseLinhas.slice(0, MAX_LINHAS) : baseLinhas
  const escondidos = filtrados.length - baseLinhas.length
  const capExcedido = baseLinhas.length - linhasVisiveis.length

  if (!trades.length) {
    return (
      <div className="empty-state">
        <span>Sem prévias de negociação</span>
        <small>O REUNE publica em dias úteis (11h/13h/16h/18h). Rode a atualização.</small>
      </div>
    )
  }

  // Tabela dos ativos do grupo (abaixo do grafico). Clicar filtra a esquerda + foca
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
                className={`sec-row-click${ativo === a.ticker ? ' sec-row-active' : ''}`}
                onClick={() => setAtivo(v => (v === a.ticker ? '' : a.ticker))}
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

  return (
    <>
      <div className="sec-summary">
        <div className="sec-summary-main">{reuneRef}</div>
      </div>

      <div className="fluxo-filters sec-filters">
        <div className="fluxo-filters-row">
          <div className="fluxo-field fluxo-field-grow">
            <span className="fluxo-field-label">Buscar</span>
            <input className="sec-input" placeholder="Ativo, emissor ou grupo…"
              value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar no mercado secundário" />
          </div>
          <div className="fluxo-field sec-field-sel">
            <span className="fluxo-field-label">Grupo</span>
            <SearchSelect label="Grupo" value={grupo} options={opts.grupos} onChange={setGrupo} />
          </div>
          <div className="fluxo-field sec-field-sel">
            <span className="fluxo-field-label">Emissor</span>
            <SearchSelect label="Emissor" value={emissor} options={opts.emissores} onChange={setEmissor} />
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">Ativo</span>
            <select className="sec-input" value={ativo} onChange={e => setAtivo(e.target.value)}>
              <option value="">Todos</option>
              {opts.ativos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">Volume</span>
            {(() => {
              // Sweep (‹ valor ›) em vez do segmentado: percorre as faixas em ordem
              // decrescente de tamanho. Todos → >5MM → 1–5MM → Até 1MM.
              const VOLS = [['', 'Todos'], ['Superior a 5MM', '> 5MM'], ['Entre 1MM e 5MM', '1–5MM'], ['Até 1MM', 'Até 1MM']]
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
              {[['', 'Todos'], ['sim', '12.431'], ['nao', 'Tradicional']].map(([v, lab]) => (
                <button key={v || 'todos'} type="button" role="tab" aria-selected={lei === v}
                  className={`segmented-btn${lei === v ? ' active' : ''}`} onClick={() => setLei(v)}>{lab}</button>
              ))}
            </div>
          </div>
          {(temFiltro || selAtivo) && (
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
        <TableWrap title="Mercado secundário (REUNE)">
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
            <col className="c-idx" />
            <col className="c-lei" />
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
              <tr><td colSpan={10} className="col-sticky">Nenhum negócio com esses filtros.</td></tr>
            )}
            {linhasVisiveis.map((a, i) => (
              <tr key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={`sec-row-click${selAtivo === a.codigoAtivo ? ' sec-row-active' : ''}`}
                onClick={() => onClickAtivo(a.codigoAtivo)}
                title={`Ver a evolução de ${a.codigoAtivo} no gráfico`}>
                <td className="col-sticky col-num col-data">{fmtDateDDMMYY(a.data)}</td>
                <td className="col-ativo">
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
                <td className="col-num"><span className={`vol-tag vol-tag-${a.volRank}`}>{a.faixaVolume || '-'}</span></td>
                <td className="col-num">{a.vencimento ? fmtDateDDMMYY(a.vencimento) : '-'}</td>
                <td className="col-num">{(a.duration && a.duration !== '—') ? a.duration : '-'}</td>
                <td className="col-num">{a.txEmissao ? fmtTaxa(a.txEmissao) : '-'}</td>
                <td className="col-idx">{a.indexador || '-'}</td>
                <td className="col-num">{isYes(a.lei12431) ? 'Sim' : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableWrap>
        {!temFiltro && (verTudo || escondidos > 0) && (
          <button type="button" className="sec-cards-toggle" onClick={() => setVerTudo(v => !v)}>
            {verTudo
              ? `Mostrar só o pregão de ${fmtDateDDMMYY(dataRecente)}`
              : `Pregão de ${fmtDateDDMMYY(dataRecente)} · clique num ativo p/ ver o histórico no gráfico — ou ver todos os pregões (+${escondidos.toLocaleString('pt-BR')})`}
          </button>
        )}
        {capExcedido > 0 && (
          <p className="sec-cap-nota">Mostrando {MAX_LINHAS.toLocaleString('pt-BR')} de {baseLinhas.length.toLocaleString('pt-BR')} negócios — refine os filtros p/ ver o resto.</p>
        )}
       </div>

       <aside className="sec-split-chart">
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
        {grupoTabela}
       </aside>
      </div>
      ) : (
      <div className="sec-cards-wrap">
        {serieGrafico && (
          <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico…</div>}>
            <SecondaryChart serie={serieGrafico.pontos} modo={serieGrafico.modo} unidade={serieGrafico.unidade} refLabel={serieGrafico.refLabel} titulo={focoLabel} nAtivos={nAtivosFiltro} />
          </Suspense>
        )}
        {grupoTabela}
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
                  <span className="sec-card-sep">·</span><span>{FAIXA_CURTA[a.faixaVolume] || a.faixaVolume || '-'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </>
  )
}

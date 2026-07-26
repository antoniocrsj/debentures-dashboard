import { useMemo, useState, Suspense } from 'react'
import { parseNum, shortEmissor, fmtDateDDMMYY, fmtTaxa, isYes } from '../utils/format.js'
import { lazyWithRetry } from '../utils/lazyWithRetry.js'
import TableWrap from './TableWrap.jsx'

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
  { id: 'taxaMin',   label: 'Tx mín.',    sticky: false, sortable: false },
  { id: 'taxa',      label: 'Tx méd.',    sticky: false, sortable: true  },
  { id: 'taxaMax',   label: 'Tx máx.',    sticky: false, sortable: false },
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
  }, [trades, busca, grupo, emissor, ativo, faixa, sort])

  // Grafico dirigido pelo FILTRO: serie de taxa do conjunto filtrado -- media
  // por pregao quando ha' varios ativos (grupo/emissor). Sem foco -> aviso.
  const temFoco = !!(grupo || emissor || ativo || busca.trim())
  const focoLabel = ativo || emissor || grupo || (busca.trim() ? `"${busca.trim()}"` : '')
  const nAtivosFiltro = useMemo(() => new Set(filtrados.map(f => f.codigoAtivo)).size, [filtrados])
  const serieGrafico = useMemo(() => {
    if (!temFoco || !filtrados.length) return null
    const porData = new Map()
    for (const t of filtrados) {
      if (!porData.has(t.data)) porData.set(t.data, [])
      porData.get(t.data).push(t)
    }
    const avg = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
    return [...porData.entries()].map(([data, rows]) => ({
      data,
      txMin: avg(rows.map(r => parseNum(r.taxaMin)).filter(Boolean)),
      txMed: avg(rows.map(r => r.taxaMedNum).filter(Boolean)),
      txMax: avg(rows.map(r => parseNum(r.taxaMax)).filter(Boolean)),
      n: new Set(rows.map(r => r.codigoAtivo)).size,
    })).sort((a, b) => a.data.localeCompare(b.data))
  }, [filtrados, temFoco])
  const limpar = () => { setBusca(''); setGrupo(''); setEmissor(''); setAtivo(''); setFaixa('') }
  const temFiltro = busca || grupo || emissor || ativo || faixa

  // Compacto: por padrao mostra so' o ultimo pregao (perf -- evita renderizar todo
  // o historico em cards). Com filtro ou "ver tudo", mostra todos os filtrados.
  const soUltimoPregao = !desktop && !temFiltro && !verTudo
  const cardsList = soUltimoPregao ? filtrados.filter(t => t.data === dataRecente) : filtrados
  const escondidos = filtrados.length - cardsList.length

  if (!trades.length) {
    return (
      <div className="empty-state">
        <span>Sem prévias de negociação</span>
        <small>O REUNE publica em dias úteis (11h/13h/16h/18h). Rode a atualização.</small>
      </div>
    )
  }

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
          <div className="fluxo-field">
            <span className="fluxo-field-label">Grupo</span>
            <select className="sec-input" value={grupo} onChange={e => setGrupo(e.target.value)}>
              <option value="">Todos</option>
              {opts.grupos.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="fluxo-field">
            <span className="fluxo-field-label">Emissor</span>
            <select className="sec-input" value={emissor} onChange={e => setEmissor(e.target.value)}>
              <option value="">Todos</option>
              {opts.emissores.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
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
            <div className="segmented" role="tablist" aria-label="Faixa de volume">
              {[['', 'Todos'], ['Superior a 5MM', '>5MM'], ['Entre 1MM e 5MM', '1–5MM'], ['Até 1MM', 'Até 1MM']].map(([v, lab]) => (
                <button key={v || 'todos'} type="button" role="tab" aria-selected={faixa === v}
                  className={`segmented-btn${faixa === v ? ' active' : ''}`} onClick={() => setFaixa(v)}>{lab}</button>
              ))}
            </div>
          </div>
          {temFiltro && (
            <div className="fluxo-field">
              <span className="fluxo-field-label">&nbsp;</span>
              <button type="button" className="sec-clear" onClick={limpar}>Limpar</button>
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
            <col className="c-tx3" />
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
              <tr><td colSpan={12} className="col-sticky">Nenhum negócio com esses filtros.</td></tr>
            )}
            {filtrados.map((a, i) => (
              <tr key={`${a.codigoAtivo}|${a.data}|${i}`}>
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
                <td className="col-num col-muted">{fmtTx(a.taxaMin)}</td>
                <td className="col-num">{fmtTx(a.taxaMed)}</td>
                <td className="col-num col-muted">{fmtTx(a.taxaMax)}</td>
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
       </div>

       <aside className="sec-split-chart">
        {serieGrafico
          ? (
            <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico…</div>}>
              <SecondaryChart serie={serieGrafico} titulo={focoLabel} nAtivos={nAtivosFiltro} />
            </Suspense>
          )
          : (
            <div className="sec-chart-empty">
              <span className="sec-chart-empty-ic">📈</span>
              Selecione um ativo, emissor ou grupo para ver a evolução da taxa.
            </div>
          )}
       </aside>
      </div>
      ) : (
      <div className="sec-cards-wrap">
        {serieGrafico && (
          <Suspense fallback={<div className="sec-chart-empty">Carregando gráfico…</div>}>
            <SecondaryChart serie={serieGrafico} titulo={focoLabel} nAtivos={nAtivosFiltro} />
          </Suspense>
        )}
        {!temFiltro && (verTudo || escondidos > 0) && (
          <button type="button" className="sec-cards-toggle" onClick={() => setVerTudo(v => !v)}>
            {verTudo
              ? 'Mostrar só o último pregão'
              : `Ver histórico completo · +${escondidos.toLocaleString('pt-BR')} negócios`}
          </button>
        )}
        <div className="sec-cards">
          {cardsList.length === 0 && (
            <div className="sec-card sec-card-empty">Nenhum negócio com esses filtros.</div>
          )}
          {cardsList.map((a, i) => {
            const emi = a.grupo ? shortEmissor(a.emissorNome, a.grupo) : ''
            return (
              <div key={`${a.codigoAtivo}|${a.data}|${i}`} className="sec-card">
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

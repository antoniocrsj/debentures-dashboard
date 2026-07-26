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
  { id: 'volume',    label: 'Volume',     sticky: false, sortable: true  },
  { id: 'vencimento',label: 'Venc.',      sticky: false, sortable: true  },
  { id: 'duration',  label: 'Duration',   sticky: false, sortable: false },
  { id: 'txEmissao', label: 'Tx emissão', sticky: false, sortable: false },
  { id: 'indexador', label: 'Indexador',  sticky: false, sortable: false },
  { id: 'lei12431',  label: '12.431',     sticky: false, sortable: false },
]

const FAIXAS = ['Superior a 5MM', 'Entre 1MM e 5MM', 'Até 1MM']

function fmtTx(v) { return (v && v !== '--') ? `${v}%` : '-' }

export default function SecondaryTable({ trades, reuneRef, dias, desktop }) {
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [emissor, setEmissor] = useState('')
  const [ativo, setAtivo] = useState('')
  const [faixa, setFaixa] = useState('')
  const [sort, setSort] = useState({ col: 'data', dir: 'desc' })  // pregao mais recente primeiro

  const onSort = id => setSort(s => ({ col: id, dir: s.col === id && s.dir === 'desc' ? 'asc' : 'desc' }))

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

      <div className="sec-controls">
        <input className="sec-search" placeholder="Buscar ativo, emissor ou grupo…"
          value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar no mercado secundário" />
        <select className="sec-sel" value={grupo} onChange={e => setGrupo(e.target.value)} aria-label="Filtrar por grupo">
          <option value="">Grupo: todos</option>
          {opts.grupos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="sec-sel" value={emissor} onChange={e => setEmissor(e.target.value)} aria-label="Filtrar por emissor">
          <option value="">Emissor: todos</option>
          {opts.emissores.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="sec-sel" value={ativo} onChange={e => setAtivo(e.target.value)} aria-label="Filtrar por ativo">
          <option value="">Ativo: todos</option>
          {opts.ativos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="sec-sel" value={faixa} onChange={e => setFaixa(e.target.value)} aria-label="Filtrar por faixa de volume">
          <option value="">Volume: todos</option>
          {FAIXAS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {temFiltro && <button type="button" className="sec-clear" onClick={limpar}>Limpar</button>}
      </div>

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
              <tr><td colSpan={11} className="col-sticky">Nenhum negócio com esses filtros.</td></tr>
            )}
            {filtrados.map((a, i) => (
              <tr
                key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={a.naCarteira ? 'row-carteira' : ''}
              >
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
    </>
  )
}

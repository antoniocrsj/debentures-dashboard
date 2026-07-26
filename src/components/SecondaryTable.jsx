import { useMemo, useState, Suspense } from 'react'
import { parseNum, shortEmissor } from '../utils/format.js'
import { lazyWithRetry } from '../utils/lazyWithRetry.js'
import TableWrap from './TableWrap.jsx'

// Grafico de serie (Recharts) carregado sob demanda: so' entra no bundle quando
// o usuario clica num ativo para ver a evolucao.
const SecondaryChart = lazyWithRetry(() => import('./SecondaryChart.jsx'))

// Colunas do mercado secundario (REUNE). Uma linha = um TRADE (ativo negociado
// num dia). Data primeiro (o pregao do trade); taxa em 3 pontos (o range do
// dia); PU medio; e a faixa de volume (o selo de liquidez).
const COLS = [
  { id: 'data',    label: 'Data',        sticky: true,  sortable: true  },
  { id: 'ativo',   label: 'Ativo',       sticky: false, sortable: true  },
  { id: 'taxaMin', label: 'Tx mín.',     sticky: false, sortable: false },
  { id: 'taxa',    label: 'Tx méd.',     sticky: false, sortable: true  },
  { id: 'taxaMax', label: 'Tx máx.',     sticky: false, sortable: false },
  { id: 'pu',      label: 'PU méd.',     sticky: false, sortable: true  },
  { id: 'volume',  label: 'Volume neg.', sticky: false, sortable: true  },
]

const FAIXAS = ['Superior a 5MM', 'Entre 1MM e 5MM', 'Até 1MM']

function fmtPU(v) {
  const n = parseNum(v)
  if (!n) return '-'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTx(v) { return (v && v !== '--') ? `${v}%` : '-' }
function fmtData(iso) {
  const [y, m, d] = (iso || '').split('-')
  return (d && m) ? `${d}/${m}` : (iso || '-')
}

export default function SecondaryTable({ trades, reuneRef, dias, desktop }) {
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [emissor, setEmissor] = useState('')
  const [ativo, setAtivo] = useState('')
  const [faixa, setFaixa] = useState('')
  const [soCarteira, setSoCarteira] = useState(false)
  const [sort, setSort] = useState({ col: 'data', dir: 'desc' })  // pregao mais recente primeiro
  const [sel, setSel] = useState('')  // ativo selecionado para o grafico de serie

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
    if (soCarteira) rows = rows.filter(a => a.naCarteira)
    const dir = sort.dir === 'asc' ? 1 : -1
    const key = {
      data:   a => a.data,
      ativo:  a => a.codigoAtivo,
      taxa:   a => a.taxaMedNum || 0,
      pu:     a => a.puMedNum || 0,
      volume: a => a.volRank,
    }[sort.col]
    // desempate estavel: dentro da mesma chave, data desc e depois ticker
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      if (a.data !== b.data) return a.data < b.data ? 1 : -1
      return a.codigoAtivo < b.codigoAtivo ? -1 : 1
    })
  }, [trades, busca, grupo, emissor, ativo, faixa, soCarteira, sort])

  const nCarteira = useMemo(() => new Set(trades.filter(a => a.naCarteira).map(a => a.codigoAtivo)).size, [trades])
  const serieSel = useMemo(() => sel ? trades.filter(h => h.codigoAtivo === sel) : [], [trades, sel])
  const selInfo = useMemo(() => trades.find(a => a.codigoAtivo === sel) || {}, [trades, sel])
  const limpar = () => { setBusca(''); setGrupo(''); setEmissor(''); setAtivo(''); setFaixa(''); setSoCarteira(false) }
  const temFiltro = busca || grupo || emissor || ativo || faixa || soCarteira

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
        <div className="sec-summary-main">
          <strong>{filtrados.length.toLocaleString('pt-BR')}</strong>
          {temFiltro ? ` de ${trades.length.toLocaleString('pt-BR')}` : ''} negócios
          {dias ? <span className="sec-ref"> · {dias} pregões</span> : null}
          {reuneRef && <span className="sec-ref"> · até {reuneRef}</span>}
        </div>
        <div className="sec-summary-chips">
          <span className="sec-chip">{nCarteira} papéis da carteira negociados</span>
        </div>
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
        <label className="sec-check">
          <input type="checkbox" checked={soCarteira} onChange={e => setSoCarteira(e.target.checked)} />
          Só a carteira
        </label>
        {temFiltro && <button type="button" className="sec-clear" onClick={limpar}>Limpar</button>}
      </div>

      {sel && serieSel.length > 0 && (
        <Suspense fallback={<div className="caixa-line-empty">Carregando gráfico…</div>}>
          <SecondaryChart serie={serieSel} ativo={sel} grupo={selInfo.grupo} />
        </Suspense>
      )}

      <TableWrap title="Mercado secundário (REUNE)">
        <table className="asset-table sec-table">
          <colgroup>
            <col className="c-data" />
            <col className="c-ativo" />
            <col className="c-tx3" />
            <col className="c-tx3" />
            <col className="c-tx3" />
            <col className="c-pu" />
            <col className="c-volume" />
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
              <tr><td colSpan={7} className="col-sticky">Nenhum negócio com esses filtros.</td></tr>
            )}
            {filtrados.map((a, i) => (
              <tr
                key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={`sec-row${a.naCarteira ? ' row-carteira' : ''}${sel === a.codigoAtivo ? ' row-selected' : ''}`}
                onClick={() => setSel(s => s === a.codigoAtivo ? '' : a.codigoAtivo)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSel(s => s === a.codigoAtivo ? '' : a.codigoAtivo)}
              >
                <td className="col-sticky col-num col-data">{fmtData(a.data)}</td>
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
                <td className="col-num">{fmtPU(a.puMed)}</td>
                <td className="col-num"><span className={`vol-tag vol-tag-${a.volRank}`}>{a.faixaVolume || '-'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  )
}

import { useMemo, useState, Suspense } from 'react'
import { parseNum, shortEmissor } from '../utils/format.js'
import { lazyWithRetry } from '../utils/lazyWithRetry.js'
import TableWrap from './TableWrap.jsx'

// Grafico de serie (Recharts) carregado sob demanda: so' entra no bundle quando
// o usuario clica num ativo para ver a evolucao.
const SecondaryChart = lazyWithRetry(() => import('./SecondaryChart.jsx'))

// Colunas do mercado secundario (REUNE). Uma linha = uma debenture negociada no
// dia. Taxa vem em 3 pontos (min/med/max = o range negociado no pregao); PU
// medio; e a faixa de volume declarada pelo REUNE (o selo de liquidez).
const COLS = [
  { id: 'ativo',   label: 'Ativo',       sticky: true,  sortable: true  },
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

export default function SecondaryTable({ assets, history, reuneRef, desktop }) {
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [emissor, setEmissor] = useState('')
  const [ativo, setAtivo] = useState('')
  const [faixa, setFaixa] = useState('')
  const [soCarteira, setSoCarteira] = useState(false)
  const [sort, setSort] = useState({ col: 'volume', dir: 'desc' })  // mais liquidos primeiro
  const [sel, setSel] = useState('')  // ativo selecionado para o grafico de serie

  const onSort = id => setSort(s => ({ col: id, dir: s.col === id && s.dir === 'desc' ? 'asc' : 'desc' }))

  // Opcoes dos selects (do dataset inteiro, ordenadas).
  const opts = useMemo(() => ({
    grupos:    [...new Set(assets.map(a => a.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    emissores: [...new Set(assets.map(a => a.emissorNome).filter(e => e && e !== '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    ativos:    [...new Set(assets.map(a => a.codigoAtivo).filter(Boolean))].sort(),
  }), [assets])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let rows = assets
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
      ativo:  a => a.codigoAtivo,
      taxa:   a => a.taxaMedNum || 0,
      pu:     a => a.puMedNum || 0,
      volume: a => a.volRank,
    }[sort.col]
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [assets, busca, grupo, emissor, ativo, faixa, soCarteira, sort])

  const nCarteira = useMemo(() => assets.filter(a => a.naCarteira).length, [assets])
  const nLiquidas = useMemo(() => assets.filter(a => a.volRank === 3).length, [assets])

  // Serie temporal do ativo selecionado (para o grafico).
  const serieSel = useMemo(() => sel ? (history || []).filter(h => h.codigoAtivo === sel) : [], [history, sel])
  const selInfo = useMemo(() => assets.find(a => a.codigoAtivo === sel) || {}, [assets, sel])
  const limpar = () => { setBusca(''); setGrupo(''); setEmissor(''); setAtivo(''); setFaixa(''); setSoCarteira(false) }
  const temFiltro = busca || grupo || emissor || ativo || faixa || soCarteira

  if (!assets.length) {
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
          {temFiltro ? ` de ${assets.length.toLocaleString('pt-BR')}` : ''} debêntures negociadas
          {reuneRef && <span className="sec-ref"> · pregão de {reuneRef}</span>}
        </div>
        <div className="sec-summary-chips">
          <span className="sec-chip sec-chip-liq">{nLiquidas} acima de R$ 5MM</span>
          <span className="sec-chip">{nCarteira} na carteira acompanhada</span>
        </div>
      </div>

      <div className="sec-controls">
        <input
          className="sec-search"
          placeholder="Buscar ativo, emissor ou grupo…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          aria-label="Buscar no mercado secundário"
        />
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
              <tr><td colSpan={6} className="col-sticky">Nenhum ativo com esses filtros.</td></tr>
            )}
            {filtrados.map((a, i) => (
              <tr
                key={`${a.codigoAtivo}|${a.data}|${i}`}
                className={`sec-row${a.naCarteira ? ' row-carteira' : ''}${sel === a.codigoAtivo ? ' row-selected' : ''}`}
                onClick={() => setSel(s => s === a.codigoAtivo ? '' : a.codigoAtivo)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSel(s => s === a.codigoAtivo ? '' : a.codigoAtivo)}
              >
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
                <td className="col-num col-muted">{fmtTx(a.taxaMin)}</td>
                <td className="col-num">{fmtTx(a.taxaMed)}</td>
                <td className="col-num col-muted">{fmtTx(a.taxaMax)}</td>
                <td className="col-num">{fmtPU(a.puMed)}</td>
                <td className="col-num">
                  <span className={`vol-tag vol-tag-${a.volRank}`}>{a.faixaVolume || '-'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  )
}

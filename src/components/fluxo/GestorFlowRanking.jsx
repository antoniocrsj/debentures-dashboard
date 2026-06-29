import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows, fmtInt } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'

const LIMIT = 20
const DEFAULT_SORT = { col: 'liquido', dir: 'desc' }

const KEYS = {
  gestor:   g => g.gestor,
  liquido:  g => g.liquido,
  captacao: g => g.captacao,
  resgate:  g => g.resgate,
}
const LABELS = { gestor: 'Gestor', liquido: 'Cap. Líquida', captacao: 'Captação', resgate: 'Resgate' }

export default function GestorFlowRanking({ ranking, onSelect }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(ranking, KEYS[sort.col] || KEYS.liquido, sort.dir),
    [ranking, sort]
  )

  if (!ranking || !ranking.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)
  const dirTxt = sort.dir === 'asc' ? '↑' : '↓'

  return (
    <div className="fluxo-ranking-block">
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Ranking de gestores</h3>
        <span className="fluxo-ranking-sub">Ordenado por: {LABELS[sort.col]} {dirTxt}</span>
      </div>

      <div className="table-wrap">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="gestor"   label="Gestor"      sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido"  label="Cap. Líquida" sort={sort} onSort={onSort} />
              <SortableTh col="captacao" label="Captação"    sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label="Resgate"     sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(g => {
              const pos = g.liquido > 0, neg = g.liquido < 0
              return (
                <tr
                  key={g.gestor}
                  onClick={() => onSelect?.(g.gestor)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onSelect?.(g.gestor)}
                  title={`Filtrar Captação por ${g.gestor}`}
                >
                  <td className="col-sticky col-gestor"><span className="ativo-code">{g.gestor}</span></td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(g.liquido)}</td>
                  <td className="col-num">{fmtFluxo(g.captacao)}</td>
                  <td className="col-num">{fmtFluxo(g.resgate)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && sorted.length > LIMIT
        ? (
          <button className="show-all-btn" onClick={() => setShowAll(true)}>
            Mostrando {LIMIT} de {fmtInt(sorted.length)} gestores — ver todos
          </button>
        )
        : <p className="fluxo-note">{fmtInt(sorted.length)} gestores no período.</p>}
    </div>
  )
}

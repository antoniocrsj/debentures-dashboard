import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows, fmtWeekFull } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'

const PAGE = 16
const DEFAULT_SORT = { col: 'semana', dir: 'desc' }

const KEYS = {
  semana:   w => w.weekKey,
  captacao: w => w.captacao,
  resgate:  w => w.resgate,
  liquido:  w => w.liquido,
  pl:       w => w.plTotal,
  fundos:   w => w.numFundos,
}

export default function FluxoTable({ weekly }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(weekly, KEYS[sort.col] || KEYS.semana, sort.dir),
    [weekly, sort]
  )

  if (!weekly || !weekly.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, PAGE)

  return (
    <div className="fluxo-table-block">
      <h3 className="fluxo-section-title">Semanas</h3>
      <div className="table-wrap">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="semana"   label="Semana"   sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="captacao" label="Captação" sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label="Resgate"  sort={sort} onSort={onSort} />
              <SortableTh col="liquido"  label="Líquido"  sort={sort} onSort={onSort} />
              <SortableTh col="pl"       label="PL total" sort={sort} onSort={onSort} />
              <SortableTh col="fundos"   label="Nº fundos" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(w => {
              const pos = w.liquido > 0, neg = w.liquido < 0
              return (
                <tr key={w.weekKey}>
                  <td className="col-sticky col-ativo"><span className="ativo-code">{fmtWeekFull(w.weekKey)}</span></td>
                  <td className="col-num">{fmtFluxo(w.captacao)}</td>
                  <td className="col-num">{fmtFluxo(w.resgate)}</td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(w.liquido)}</td>
                  <td className="col-num">{fmtFluxo(w.plTotal)}</td>
                  <td className="col-num">{w.numFundos || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && sorted.length > PAGE && (
        <button className="show-all-btn" onClick={() => setShowAll(true)}>
          Mostrando {PAGE} de {sorted.length} semanas — ver todas
        </button>
      )}
    </div>
  )
}

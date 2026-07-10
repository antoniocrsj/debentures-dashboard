import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows, fmtWeekFull, fmtInt, parseSemana } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

const PAGE = 16
const DEFAULT_SORT = { col: 'semana', dir: 'desc' }

const KEYS = {
  semana:   w => w.weekKey,
  liquido:  w => w.liquido,
  captacao: w => w.captacao,
  resgate:  w => w.resgate,
}

export default function FluxoTable({ weekly }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(weekly, KEYS[sort.col] || KEYS.semana, sort.dir),
    [weekly, sort]
  )

  // Semana mais recente da base (independe da ordenação escolhida): nela mostramos
  // até que dia os dados vão ("até DD/MM") e, se ainda em andamento, marca "parcial".
  const latestKey = useMemo(() => weekly.reduce((mx, w) => (w.weekKey > mx ? w.weekKey : mx), ''), [weekly])

  if (!weekly || !weekly.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, PAGE)
  const ddmm = key => parseSemana(key)?.label || ''

  return (
    <div className="fluxo-table-block">
      <h3 className="fluxo-section-title">Semanas</h3>
      <TableWrap title="Semanas">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="semana"   label="Semana"      sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido"  label="Cap. Líquida" sort={sort} onSort={onSort} />
              <SortableTh col="captacao" label="Captação"    sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label="Resgate"     sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(w => {
              const pos = w.liquido > 0, neg = w.liquido < 0
              const isLatest = w.weekKey === latestKey
              return (
                <tr key={w.weekKey}>
                  <td className="col-sticky col-ativo">
                    <span className="ativo-code">{fmtWeekFull(w.weekKey)}</span>
                    {isLatest && w.dataBase && (
                      <span
                        className={`semana-cobertura${w.parcial ? ' parcial' : ''}`}
                        title={w.parcial
                          ? `Semana em andamento — dados até ${fmtWeekFull(w.dataBase)}`
                          : `Cobre até ${fmtWeekFull(w.dataBase)}`}
                      >
                        {w.parcial ? 'parcial · ' : ''}até {ddmm(w.dataBase)}
                      </span>
                    )}
                  </td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(w.liquido)}</td>
                  <td className="col-num">{fmtFluxo(w.captacao)}</td>
                  <td className="col-num">{fmtFluxo(w.resgate)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > PAGE && (
        <button className="show-all-btn" onClick={() => setShowAll(true)}>
          Mostrando {PAGE} de {fmtInt(sorted.length)} semanas — ver todas
        </button>
      )}
    </div>
  )
}

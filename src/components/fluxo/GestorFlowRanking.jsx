import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows, fmtInt } from '../../utils/fluxo.js'
import { fmtPct } from '../../utils/format.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

const LIMIT = 20
const DEFAULT_SORT = { col: 'liquido', dir: 'desc' }

// %CDI: acima de 100% bate o CDI (verde); negativo é retorno negativo (vermelho).
const rentClass = v => (v == null ? '' : v > 100 ? ' pos' : v < 0 ? ' neg' : '')

const KEYS = {
  gestor:   g => g.gestor,
  pl:       g => g.plRecente,   // PL total do gestor na semana mais recente do período
  liquido:  g => g.liquido,
  captacao: g => g.captacao,
  resgate:  g => g.resgate,
  rent1s:   g => g.pctCdi1s,
  rent1m:   g => g.pctCdi1m,
  rent3m:   g => g.pctCdi3m,
  rent6m:   g => g.pctCdi6m,
  rent12m:  g => g.pctCdi12m,
}
const LABELS = {
  gestor: 'Gestor', pl: 'PL', liquido: 'Cap. Líquida', captacao: 'Captação', resgate: 'Resgate',
  rent1s: '%CDI 1s', rent1m: '%CDI 1m', rent3m: '%CDI 3m', rent6m: '%CDI 6m', rent12m: '%CDI 12m',
}

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

      <TableWrap title="Ranking de gestores">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="gestor"   label="Gestor"      sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido"  label="Cap. Líquida" sort={sort} onSort={onSort} />
              <SortableTh col="captacao" label="Captação"    sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label="Resgate"     sort={sort} onSort={onSort} />
              <SortableTh col="pl"       label="PL"          sort={sort} onSort={onSort} />
              <SortableTh col="rent1s"   label="%CDI 1s"     sort={sort} onSort={onSort} />
              <SortableTh col="rent1m"   label="%CDI 1m"     sort={sort} onSort={onSort} />
              <SortableTh col="rent3m"   label="%CDI 3m"     sort={sort} onSort={onSort} />
              <SortableTh col="rent6m"   label="%CDI 6m"     sort={sort} onSort={onSort} />
              <SortableTh col="rent12m"  label="%CDI 12m"    sort={sort} onSort={onSort} />
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
                  <td className="col-num">{g.plRecente > 0 ? fmtFluxo(g.plRecente) : '-'}</td>
                  <td className={`col-num rent-cell${rentClass(g.pctCdi1s)}`}>{fmtPct(g.pctCdi1s)}</td>
                  <td className={`col-num rent-cell${rentClass(g.pctCdi1m)}`}>{fmtPct(g.pctCdi1m)}</td>
                  <td className={`col-num rent-cell${rentClass(g.pctCdi3m)}`}>{fmtPct(g.pctCdi3m)}</td>
                  <td className={`col-num rent-cell${rentClass(g.pctCdi6m)}`}>{fmtPct(g.pctCdi6m)}</td>
                  <td className={`col-num rent-cell${rentClass(g.pctCdi12m)}`}>{fmtPct(g.pctCdi12m)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
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

import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'

const LIMIT = 20
const DEFAULT_SORT = { col: 'plMedio', dir: 'desc' }

const KEYS = {
  gestor:    g => g.gestor,
  plMedio:   g => g.plTotalMedio,
  plRecente: g => g.plRecente,
  captacao:  g => g.captacao,
  resgate:   g => g.resgate,
  liquido:   g => g.liquido,
  fundos:    g => g.numFundos,
}
const LABELS = {
  gestor: 'Gestor', plMedio: 'PL total médio', plRecente: 'PL mais recente',
  captacao: 'Captação', resgate: 'Resgate', liquido: 'Captação líquida', fundos: 'Nº de fundos',
}

export default function GestorFlowRanking({ ranking }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(ranking, KEYS[sort.col] || KEYS.plMedio, sort.dir),
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
              <th scope="col" className="col-sticky th-pos">#</th>
              <SortableTh col="gestor"    label="Gestor"         sort={sort} onSort={onSort} align="left" />
              <SortableTh col="plMedio"   label="PL total médio" sort={sort} onSort={onSort} />
              <SortableTh col="plRecente" label="PL recente"     sort={sort} onSort={onSort} />
              <SortableTh col="captacao"  label="Captação"       sort={sort} onSort={onSort} />
              <SortableTh col="resgate"   label="Resgate"        sort={sort} onSort={onSort} />
              <SortableTh col="liquido"   label="Líquido"        sort={sort} onSort={onSort} />
              <SortableTh col="fundos"    label="Nº fundos"      sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map((g, i) => {
              const pos = g.liquido > 0, neg = g.liquido < 0
              return (
                <tr key={g.gestor}>
                  <td className="col-sticky th-pos">{i + 1}</td>
                  <td className="col-gestor"><span className="ativo-code">{g.gestor}</span></td>
                  <td className="col-num">{fmtFluxo(g.plTotalMedio)}</td>
                  <td className="col-num">{fmtFluxo(g.plRecente)}</td>
                  <td className="col-num">{fmtFluxo(g.captacao)}</td>
                  <td className="col-num">{fmtFluxo(g.resgate)}</td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(g.liquido)}</td>
                  <td className="col-num">{g.numFundos || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && sorted.length > LIMIT
        ? (
          <button className="show-all-btn" onClick={() => setShowAll(true)}>
            Mostrando {LIMIT} de {sorted.length} gestores — ver todos
          </button>
        )
        : <p className="fluxo-note">{sorted.length} gestores no período.</p>}
    </div>
  )
}

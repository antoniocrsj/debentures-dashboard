import { useState, useMemo } from 'react'
import { sortBy, fmtPctPL } from '../../utils/caixa.js'
import { fmtFluxo, fmtFluxoSigned, fmtInt } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from '../fluxo/SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

const LIMIT = 20
const DEFAULT_SORT = { col: 'consolidado', dir: 'desc' }
const KEYS = {
  gestor: g => g.gestor,
  nfundos: g => g.numFundos,
  pl: g => g.pl,
  consolidado: g => g.caixaConsolidado,
  pct: g => g.pctPL,
  estimado: g => g.caixaEstimado,
  fluxo: g => g.fluxoPosterior,
}

export default function CaixaGestorTable({ gestores, activeGestor, onSelect }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => sortBy(gestores, KEYS[sort.col] || KEYS.consolidado, sort.dir), [gestores, sort])
  if (!gestores || !gestores.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)

  return (
    <div className="fluxo-ranking-block">
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Ranking de gestores — caixa consolidado</h3>
        <span className="fluxo-ranking-sub">Conta o ativo final uma vez (sem feeders, sem dupla contagem via cotas)</span>
      </div>
      <TableWrap title="Ranking de gestores por caixa">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="gestor" label="Gestor" sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="consolidado" label="Caixa consolidado" sort={sort} onSort={onSort} />
              <SortableTh col="pct" label="% do PL" sort={sort} onSort={onSort} />
              <SortableTh col="estimado" label="Estimado atual" sort={sort} onSort={onSort} />
              <SortableTh col="pl" label="PL carteira" sort={sort} onSort={onSort} />
              <SortableTh col="fluxo" label="Fluxo posterior" sort={sort} onSort={onSort} />
              <SortableTh col="nfundos" label="Fundos" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(g => {
              const active = g.gestor === activeGestor
              const fpos = g.fluxoPosterior > 0, fneg = g.fluxoPosterior < 0
              return (
                <tr
                  key={g.gestor}
                  className={active ? 'row-active' : ''}
                  onClick={() => onSelect?.(g.gestor)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onSelect?.(g.gestor)}
                  title={`Ver fundos de ${g.gestor}`}
                >
                  <td className="col-sticky col-gestor"><span className="ativo-code">{g.gestor}</span></td>
                  <td className="col-num strong">{fmtFluxo(g.caixaConsolidado)}</td>
                  <td className="col-num">{fmtPctPL(g.pctPL)}</td>
                  <td className="col-num">{fmtFluxo(g.caixaEstimado)}</td>
                  <td className="col-num">{fmtFluxo(g.pl)}</td>
                  <td className={`col-num${fpos ? ' pos' : fneg ? ' neg' : ''}`}>{fmtFluxoSigned(g.fluxoPosterior)}</td>
                  <td className="col-num">{fmtInt(g.numFundos)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? <button className="show-all-btn" onClick={() => setShowAll(true)}>Mostrando {LIMIT} de {fmtInt(sorted.length)} gestores — ver todos</button>
        : <p className="fluxo-note">{fmtInt(sorted.length)} gestores no consolidado.</p>}
    </div>
  )
}

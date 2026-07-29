import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, fmtMonthYY, fmtInt, sortRows } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

/**
 * Tabela "Meses": captação/resgate/cap. líquida consolidados por mês (agregação
 * feita do diário na preparação, não da semana). Ordenável (padrão: mês mais
 * recente primeiro, igual à tabela de Semanas). Meses sem movimentação
 * aparecem com zero.
 */
const DEFAULT_SORT = { col: 'mes', dir: 'desc' }   // mais recente primeiro
const KEYS = {
  mes:      m => m.mesKey,        // 'yyyy-MM' ordena cronologicamente como texto
  liquido:  m => m.liquido,
  captacao: m => m.captacao,
  resgate:  m => m.resgate,
}

export default function FluxoMonthlyTable({ months, hideFechados = false }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const sorted = useMemo(
    () => sortRows(months, KEYS[sort.col] || KEYS.mes, sort.dir),
    [months, sort]
  )
  const totais = useMemo(() => {
    let liquido = 0, captacao = 0, resgate = 0
    for (const m of months) { liquido += m.liquido || 0; captacao += m.captacao || 0; resgate += m.resgate || 0 }
    return { liquido, captacao, resgate }
  }, [months])

  if (!months || !months.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))

  return (
    <div className="fluxo-table-block">
      <h3 className="fluxo-section-title">Meses</h3>
      {hideFechados && (
        <p className="fluxo-note fluxo-note-warn">A visão mensal não exclui fundos fechados (sem base mensal por fundo).</p>
      )}
      <TableWrap title="Meses">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="mes"      label="Mês"          sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido"  label="Cap. líq."    sort={sort} onSort={onSort} />
              <SortableTh col="captacao" label="Captação"     sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label="Resgate"      sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(m => {
              const pos = m.liquido > 0, neg = m.liquido < 0
              return (
                <tr key={m.mesKey}>
                  <td className="col-sticky col-ativo"><span className="ativo-code">{fmtMonthYY(m.mesKey)}</span></td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(m.liquido)}</td>
                  <td className="col-num">{fmtFluxo(m.captacao)}</td>
                  <td className="col-num">{fmtFluxo(m.resgate)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-sticky col-ativo">Total · {fmtInt(months.length)}</td>
              <td className={`col-num liq-cell${totais.liquido > 0 ? ' pos' : totais.liquido < 0 ? ' neg' : ''}`}>{fmtFluxoSigned(totais.liquido)}</td>
              <td className="col-num">{fmtFluxo(totais.captacao)}</td>
              <td className="col-num">{fmtFluxo(totais.resgate)}</td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
    </div>
  )
}

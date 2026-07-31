import { useState, useMemo } from 'react'
import { fmtFluxoTab, fmtFluxoTabSigned, sortRows, fmtWeekFull, fmtInt, parseSemana } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

// Cabeçalhos das colunas de fluxo: verbo curto + seta colorida (entrada verde ↑,
// saída vermelha ↓). Reutilizado por Semanas e Meses.
const H_CAP = <>Cap.<span className="fluxo-hdr-ico up" aria-hidden="true">↑</span></>
const H_RES = <>Res.<span className="fluxo-hdr-ico down" aria-hidden="true">↓</span></>

const PAGE = 16
const DEFAULT_SORT = { col: 'semana', dir: 'desc' }

const KEYS = {
  semana:   w => w.weekKey,
  liquido:  w => w.liquido,
  captacao: w => w.captacao,
  resgate:  w => w.resgate,
}

export default function FluxoTable({ weekly, allowExpand = true }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(weekly, KEYS[sort.col] || KEYS.semana, sort.dir),
    [weekly, sort]
  )

  // Semana mais recente da base (independe da ordenação escolhida): nela mostramos
  // até que dia os dados vão ("até DD/MM") e, se ainda em andamento, marca "parcial".
  const latestKey = useMemo(() => weekly.reduce((mx, w) => (w.weekKey > mx ? w.weekKey : mx), ''), [weekly])

  // Total do periodo (todas as semanas do filtro, nao so' as 16 visiveis).
  const totais = useMemo(() => {
    let liquido = 0, captacao = 0, resgate = 0
    for (const w of weekly) { liquido += w.liquido || 0; captacao += w.captacao || 0; resgate += w.resgate || 0 }
    return { liquido, captacao, resgate }
  }, [weekly])

  if (!weekly || !weekly.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = allowExpand && showAll ? sorted : sorted.slice(0, PAGE)
  const ddmm = key => parseSemana(key)?.label || ''

  return (
    <div className="fluxo-table-block">
      <h3 className="fluxo-section-title">Semanas</h3>
      <TableWrap title="Semanas">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="semana"   label="Semana"      sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido"  label="Cap. líq."    sort={sort} onSort={onSort} />
              <SortableTh col="captacao" label={H_CAP}        sort={sort} onSort={onSort} />
              <SortableTh col="resgate"  label={H_RES}        sort={sort} onSort={onSort} />
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
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoTabSigned(w.liquido)}</td>
                  <td className="col-num">{fmtFluxoTab(w.captacao)}</td>
                  <td className="col-num">{fmtFluxoTab(w.resgate)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-sticky col-ativo">Total · {fmtInt(weekly.length)}</td>
              <td className={`col-num liq-cell${totais.liquido > 0 ? ' pos' : totais.liquido < 0 ? ' neg' : ''}`}>{fmtFluxoTabSigned(totais.liquido)}</td>
              <td className="col-num">{fmtFluxoTab(totais.captacao)}</td>
              <td className="col-num">{fmtFluxoTab(totais.resgate)}</td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
      {allowExpand && !showAll && sorted.length > PAGE && (
        <button className="show-all-btn" onClick={() => setShowAll(true)}>
          Mostrando {PAGE} de {fmtInt(sorted.length)} semanas — ver todas
        </button>
      )}
    </div>
  )
}

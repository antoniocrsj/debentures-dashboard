import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, sortRows, fmtInt } from '../../utils/fluxo.js'
import { fmtPct } from '../../utils/format.js'
import SortableTh, { cycleSort } from './SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

const LIMIT = 30
const DEFAULT_SORT = { col: 'liquido', dir: 'desc' }

// %CDI: acima de 100% bate o CDI (verde); negativo é retorno negativo (vermelho).
const rentClass = v => (v == null ? '' : v > 100 ? ' pos' : v < 0 ? ' neg' : '')

const KEYS = {
  nome:     f => f.nome,
  pl:       f => f.plRecente,
  liquido:  f => f.liquido,
  captacao: f => f.captacao,
  resgate:  f => f.resgate,
  rent1s:   f => f.pctCdi1s,
  rent1m:   f => f.pctCdi1m,
  rent3m:   f => f.pctCdi3m,
  rent6m:   f => f.pctCdi6m,
  rent12m:  f => f.pctCdi12m,
}
const LABELS = {
  nome: 'Fundo', pl: 'PL', liquido: 'Cap. Líquida', captacao: 'Captação', resgate: 'Resgate',
  rent1s: '%CDI 1s', rent1m: '%CDI 1m', rent3m: '%CDI 3m', rent6m: '%CDI 6m', rent12m: '%CDI 12m',
}

export default function FundoFlowTable({ fundos, gestor, hideFechados = false, numFechados = 0 }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => sortRows(fundos, KEYS[sort.col] || KEYS.liquido, sort.dir),
    [fundos, sort]
  )

  if (!fundos || !fundos.length) return null

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)
  const dirTxt = sort.dir === 'asc' ? '↑' : '↓'

  return (
    <div className="fluxo-ranking-block fluxo-fundos-block">
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Fundos de {gestor}</h3>
        <span className="fluxo-ranking-sub">Ordenado por: {LABELS[sort.col]} {dirTxt}</span>
      </div>

      <TableWrap title={`Fundos de ${gestor}`}>
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <SortableTh col="nome"     label="Fundo"       sort={sort} onSort={onSort} align="left" sticky />
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
            {shown.map(f => {
              const pos = f.liquido > 0, neg = f.liquido < 0
              return (
                <tr key={f.cnpj} title={f.nome}>
                  <td className="col-sticky col-gestor">
                    <div className="fundo-nome-wrap">
                      <span className="ativo-code fundo-nome">{f.nome}</span>
                      {f.fechado && <span className="fundo-tag-fechado" title="Condomínio fechado (capta por emissão de cotas)">Fechado</span>}
                    </div>
                  </td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(f.liquido)}</td>
                  <td className="col-num">{fmtFluxo(f.captacao)}</td>
                  <td className="col-num">{fmtFluxo(f.resgate)}</td>
                  <td className="col-num">{f.plRecente > 0 ? fmtFluxo(f.plRecente) : '-'}</td>
                  <td className={`col-num rent-cell${rentClass(f.pctCdi1s)}`}>{fmtPct(f.pctCdi1s)}</td>
                  <td className={`col-num rent-cell${rentClass(f.pctCdi1m)}`}>{fmtPct(f.pctCdi1m)}</td>
                  <td className={`col-num rent-cell${rentClass(f.pctCdi3m)}`}>{fmtPct(f.pctCdi3m)}</td>
                  <td className={`col-num rent-cell${rentClass(f.pctCdi6m)}`}>{fmtPct(f.pctCdi6m)}</td>
                  <td className={`col-num rent-cell${rentClass(f.pctCdi12m)}`}>{fmtPct(f.pctCdi12m)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? (
          <button className="show-all-btn" onClick={() => setShowAll(true)}>
            Mostrando {LIMIT} de {fmtInt(sorted.length)} fundos — ver todos
          </button>
        )
        : (
          <p className="fluxo-note">
            {fmtInt(sorted.length)} fundo(s) de {gestor} no período.
            {hideFechados && numFechados > 0 && ` ${fmtInt(numFechados)} fundo(s) fechado(s) ocultado(s).`}
          </p>
        )}
    </div>
  )
}

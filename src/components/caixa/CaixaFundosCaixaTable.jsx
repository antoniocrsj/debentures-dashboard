import { useState, useMemo } from 'react'
import { sortBy, fmtPctPL, apelidoFundo } from '../../utils/caixa.js'
import { fmtFluxo, fmtInt } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from '../fluxo/SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

// Tabela dos FUNDOS CAIXA da analise (money market / soberano) — os fundos de
// liquidez onde os fundos de credito aplicam. Numero GLOBAL (nao muda com o
// mercado). Nao sao fundos de credito (por isso segmento "fora das listas").
const LIMIT = 25
const DEFAULT_SORT = { col: 'caixa', dir: 'desc' }
const KEYS = {
  nome: f => f.nome,
  pct: f => f.pctPL,
  pl: f => f.pl,
  caixa: f => f.caixaDireto,
}
const KIND = { confirmado: 'Fundo caixa', candidato: 'Candidato' }

export default function CaixaFundosCaixaTable({ fundos, className = '' }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => sortBy(fundos, KEYS[sort.col] || KEYS.caixa, sort.dir), [fundos, sort])
  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)
  const totalCaixa = useMemo(() => fundos.reduce((s, f) => s + (f.caixaDireto || 0), 0), [fundos])

  if (!fundos.length) return null

  return (
    <div className={`fluxo-ranking-block ${className}`}>
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Fundos caixa (liquidez)</h3>
        <span className="fluxo-ranking-sub">{fmtInt(fundos.length)} fundos · {fmtFluxo(totalCaixa)} em caixa</span>
      </div>
      <p className="fluxo-note">
        Money market / soberano onde os fundos de crédito aplicam para gestão de liquidez —
        <strong> fora</strong> das suas listas de crédito. Lista global (não muda com o mercado).
      </p>
      <TableWrap title="Fundos caixa (liquidez)">
        <table className="asset-table fluxo-table caixa-fundo-table">
          <thead>
            <tr>
              <SortableTh col="nome" label="Fundo" sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="pct" label="% do PL" sort={sort} onSort={onSort} />
              <SortableTh col="pl" label="PL" sort={sort} onSort={onSort} />
              <SortableTh col="caixa" label="Caixa" sort={sort} onSort={onSort} />
              <th className="th-plain">Classe</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(f => (
              <tr key={f.cnpj} title={f.nome}>
                <td className="col-sticky col-nome">
                  <span className="caixa-fundo-nome" title={f.nome}>{apelidoFundo(f.nome) || f.cnpj}</span>
                </td>
                <td className="col-num strong">{fmtPctPL(f.pctPL)}</td>
                <td className="col-num">{fmtFluxo(f.pl)}</td>
                <td className="col-num">{fmtFluxo(f.caixaDireto)}</td>
                <td><span className={`caixa-classe kind-${f.classeKind}`}>{KIND[f.classeKind] || '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? <button className="show-all-btn" onClick={() => setShowAll(true)}>Mostrando {LIMIT} de {fmtInt(sorted.length)} fundos caixa — ver todos</button>
        : <p className="fluxo-note">{fmtInt(sorted.length)} fundos caixa.</p>}
    </div>
  )
}

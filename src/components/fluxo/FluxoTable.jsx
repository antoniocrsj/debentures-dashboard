import { useState } from 'react'
import { fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

const PAGE = 16

const weekFull = key => {
  const [y, m, d] = (key || '').split('-')
  return d ? `${d}/${m}/${y.slice(2)}` : key
}

export default function FluxoTable({ weekly }) {
  const [showAll, setShowAll] = useState(false)

  if (!weekly || !weekly.length) return null

  // mais recente -> mais antiga
  const rows = [...weekly].reverse()
  const shown = showAll ? rows : rows.slice(0, PAGE)

  return (
    <div className="fluxo-table-block">
      <div className="table-wrap">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <th scope="col" className="col-sticky">Semana</th>
              <th scope="col">Captação</th>
              <th scope="col">Resgate</th>
              <th scope="col">Líquido</th>
              <th scope="col">PL médio</th>
              <th scope="col">Nº fundos</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(w => {
              const pos = w.liquido > 0, neg = w.liquido < 0
              return (
                <tr key={w.weekKey}>
                  <td className="col-sticky col-ativo"><span className="ativo-code">{weekFull(w.weekKey)}</span></td>
                  <td className="col-num">{fmtFluxo(w.captacao)}</td>
                  <td className="col-num">{fmtFluxo(w.resgate)}</td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>
                    {fmtFluxoSigned(w.liquido)}
                  </td>
                  <td className="col-num">{fmtFluxo(w.plMedio)}</td>
                  <td className="col-num">{w.numFundos || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > PAGE && (
        <button className="show-all-btn" onClick={() => setShowAll(true)}>
          Mostrando {PAGE} de {rows.length} semanas — ver todas
        </button>
      )}
    </div>
  )
}

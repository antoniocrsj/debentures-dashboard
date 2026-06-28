import { fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

const SORTS = [
  { id: 'liquido',  label: 'Líquido' },
  { id: 'captacao', label: 'Captação' },
  { id: 'resgate',  label: 'Resgate' },
  { id: 'pl',       label: 'PL' },
]

export default function GestorFlowRanking({ ranking, rankBy, onRankBy }) {
  if (!ranking || !ranking.length) return null

  return (
    <div className="fluxo-ranking-block">
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Ranking de gestores</h3>
        <div className="segmented segmented-sm" role="group" aria-label="Ordenar ranking por">
          {SORTS.map(s => (
            <button
              key={s.id}
              className={`segmented-btn${rankBy === s.id ? ' active' : ''}`}
              aria-pressed={rankBy === s.id}
              onClick={() => onRankBy(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <th scope="col" className="col-sticky">Gestor</th>
              <th scope="col">Captação</th>
              <th scope="col">Resgate</th>
              <th scope="col">Líquido</th>
              <th scope="col">PL médio</th>
              <th scope="col">Nº fundos</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((g, i) => {
              const pos = g.liquido > 0, neg = g.liquido < 0
              return (
                <tr key={g.gestor}>
                  <td className="col-sticky col-ativo">
                    <span className="rank-num">{i + 1}</span>
                    <span className="ativo-code">{g.gestor}</span>
                  </td>
                  <td className="col-num">{fmtFluxo(g.captacao)}</td>
                  <td className="col-num">{fmtFluxo(g.resgate)}</td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>
                    {fmtFluxoSigned(g.liquido)}
                  </td>
                  <td className="col-num">{fmtFluxo(g.plMedio)}</td>
                  <td className="col-num">{g.numFundos || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

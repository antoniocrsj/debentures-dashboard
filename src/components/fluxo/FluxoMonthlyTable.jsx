import { fmtFluxo, fmtFluxoSigned, fmtMonthYY } from '../../utils/fluxo.js'

/**
 * Tabela "Meses": captação/resgate/cap. líquida consolidados por mês (agregação
 * feita do diário na preparação, não da semana). Meses em ordem cronológica;
 * meses sem movimentação aparecem com zero. Mesmo padrão visual das demais tabelas.
 */
export default function FluxoMonthlyTable({ months }) {
  if (!months || !months.length) return null

  return (
    <div className="fluxo-table-block">
      <h3 className="fluxo-section-title">Meses</h3>
      <div className="table-wrap">
        <table className="asset-table fluxo-table">
          <thead>
            <tr>
              <th className="col-sticky th-nosort" style={{ textAlign: 'left' }}>Mês</th>
              <th className="th-nosort" style={{ textAlign: 'right' }}>Cap. Líquida</th>
              <th className="th-nosort" style={{ textAlign: 'right' }}>Captação</th>
              <th className="th-nosort" style={{ textAlign: 'right' }}>Resgate</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => {
              const pos = m.liquido > 0, neg = m.liquido < 0
              return (
                <tr key={m.mesKey}>
                  <td className="col-sticky col-gestor"><span className="ativo-code">{fmtMonthYY(m.mesKey)}</span></td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(m.liquido)}</td>
                  <td className="col-num">{fmtFluxo(m.captacao)}</td>
                  <td className="col-num">{fmtFluxo(m.resgate)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

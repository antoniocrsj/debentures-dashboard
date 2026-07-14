import { fmtBRL, fmtPct } from '../utils/format.js'

export default function GroupRanking({ groups, activeGrupo, onFilter, gestorPl, desktop }) {
  if (!groups.length) {
    return (
      <div className="empty-state">
        <span>Sem grupos para exibir</span>
        <small>Nenhuma alocação encontrada ou dados de emissor não vinculados</small>
      </div>
    )
  }

  // %PL só faz sentido com um gestor selecionado (alocação já filtrada por ele) e PL conhecido.
  const showPct = gestorPl > 0
  const totalAloc = desktop ? groups.reduce((s, g) => s + g.alocacao, 0) : 0

  return (
    <div className="ranking-panel">
      <div className="ranking-list">
        <div className="ranking-header">
          <span className="rank-col">#</span>
          <span className="name-col">Grupo Econômico</span>
          <span className="val-col">Alocação</span>
          {showPct && <span className="val-col">% do PL</span>}
        </div>
        {groups.map((g, i) => {
          const selected = activeGrupo === g.grupo
          return (
            <div
              key={g.grupo}
              className={`ranking-card${selected ? ' card-selected' : ''}`}
              onClick={() => onFilter('grupo', g.grupo)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onFilter('grupo', g.grupo)}
            >
              <div className="ranking-row">
                <span className="rank-num">{i + 1}</span>
                <span className="rank-name">{g.grupo}</span>
                <span className="rank-aloc">{fmtBRL(g.alocacao)}</span>
                {showPct && <span className="rank-pl">{fmtPct((g.alocacao / gestorPl) * 100)}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {desktop && (
        <div className="ranking-row ranking-total">
          <span className="rank-num"></span>
          <span className="rank-name">Total</span>
          <span className="rank-aloc">{fmtBRL(totalAloc)}</span>
          {showPct && <span className="rank-pl">{fmtPct((totalAloc / gestorPl) * 100)}</span>}
        </div>
      )}
    </div>
  )
}

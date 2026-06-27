import { fmtBRL } from '../utils/format.js'

export default function GroupRanking({ groups, activeGrupo, onFilter }) {
  if (!groups.length) {
    return (
      <div className="empty-state">
        <span>Sem grupos para exibir</span>
        <small>Nenhuma alocação encontrada ou dados de emissor não vinculados</small>
      </div>
    )
  }

  const maxAloc = groups[0]?.alocacao || 1

  return (
    <div className="ranking-list">
      <div className="ranking-header">
        <span className="rank-col">#</span>
        <span className="name-col">Grupo Econômico</span>
        <span className="val-col">Alocação</span>
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
            </div>
            <div className="rank-bar-wrap">
              <div className="rank-bar" style={{ width: `${(g.alocacao / maxAloc) * 100}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

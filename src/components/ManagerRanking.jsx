import { fmtBRL } from '../utils/format.js'

export default function ManagerRanking({ managers, activeGestor, onFilter, desktop }) {
  if (!managers.length) {
    return (
      <div className="empty-state">
        <span>Sem gestores para exibir</span>
        <small>Nenhuma alocação encontrada na carteira BLC</small>
      </div>
    )
  }

  return (
    <div className="ranking-list">
      <div className="ranking-header">
        <span className="rank-col">#</span>
        <span className="name-col">Gestor</span>
        <span className="val-col">Alocação</span>
        <span className="val-col">PL</span>
      </div>
      {managers.map((m, i) => {
        const selected = activeGestor === m.gestor
        return (
          <div
            key={m.gestor}
            className={`ranking-card${selected ? ' card-selected' : ''}`}
            onClick={() => onFilter('gestor', m.gestor)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onFilter('gestor', m.gestor)}
          >
            <div className="ranking-row">
              <span className="rank-num">{i + 1}</span>
              <span className="rank-name">{m.gestor}</span>
              <span className="rank-aloc">{fmtBRL(m.alocacao)}</span>
              <span className="rank-pl">{m.pl > 0 ? fmtBRL(m.pl) : '-'}</span>
            </div>
          </div>
        )
      })}
      {desktop && (
        <div className="ranking-row ranking-total">
          <span className="rank-num"></span>
          <span className="rank-name">Total</span>
          <span className="rank-aloc">{fmtBRL(managers.reduce((s, m) => s + m.alocacao, 0))}</span>
          <span className="rank-pl">{fmtBRL(managers.reduce((s, m) => s + m.pl, 0))}</span>
        </div>
      )}
    </div>
  )
}

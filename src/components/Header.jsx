export default function Header({ loading, error, currentMonth, onMonthClick }) {
  return (
    <header className="app-header">
      <div className="header-left">
        <span className="header-logo">💰</span>
        <span className="header-title">Debêntures CR</span>
        {loading && <span className="header-badge loading">carregando…</span>}
        {!loading && error && <span className="header-badge error">erro</span>}
      </div>
      <button className="month-btn" onClick={onMonthClick} aria-label="Selecionar mês">
        <span className="month-label">{currentMonth?.label ?? '—'}</span>
        <span className="month-arrow">▾</span>
      </button>
    </header>
  )
}

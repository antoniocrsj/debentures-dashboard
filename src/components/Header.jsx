export default function Header({ loading, refreshing, error, currentMonth, onMonthClick }) {
  return (
    <header className="app-header">
      <div className="header-left">
        <span className="header-logo">💰</span>
        <span className="header-title">Debêntures CR</span>
        {loading    && <span className="header-badge loading">carregando…</span>}
        {refreshing && <span className="header-badge refreshing">atualizando…</span>}
        {!loading && !refreshing && error && <span className="header-badge error">erro</span>}
      </div>
      <button className="month-btn" onClick={onMonthClick} aria-label="Selecionar mês">
        <span className="month-label">{currentMonth?.label ?? '—'}</span>
        <span className="month-arrow">▾</span>
      </button>
    </header>
  )
}

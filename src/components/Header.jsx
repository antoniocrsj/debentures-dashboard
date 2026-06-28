export default function Header({ loading, refreshing, error, desktop, onToggleView }) {
  return (
    <header className="app-header">
      <div className="header-left">
        <svg
          className="header-logo" viewBox="0 0 24 24" width="20" height="20"
          fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M3 17l5.5-5.5 3.5 3.5L21 7" />
          <path d="M15 7h6v6" />
        </svg>
        <span className="header-title">BI - Crédito Privado</span>
        {loading    && <span className="header-badge loading">carregando…</span>}
        {refreshing && <span className="header-badge refreshing">atualizando…</span>}
        {!loading && !refreshing && error && <span className="header-badge error">erro</span>}
      </div>

      <button
        className="view-toggle"
        onClick={onToggleView}
        aria-label={desktop ? 'Mudar para visão compacta' : 'Mudar para visão desktop'}
      >
        {desktop ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" />
          </svg>
        )}
        <span>{desktop ? 'Compacto' : 'Desktop'}</span>
      </button>
    </header>
  )
}

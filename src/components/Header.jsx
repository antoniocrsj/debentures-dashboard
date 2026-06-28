export default function Header({ loading, refreshing, error }) {
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
    </header>
  )
}

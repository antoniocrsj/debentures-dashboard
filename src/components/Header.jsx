// Ícones das seções (line icons, ver ROADMAP GER-2).
function DebenturesIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 13 H27 L33 19 V34 A1 1 0 0 1 32 35 H19 A1 1 0 0 1 18 34 V14 A1 1 0 0 1 19 13 Z" />
      <path d="M27 13 V19 H33" />
      <path d="M21 25 H30 M21 28.5 H30 M21 32 H27" />
    </svg>
  )
}
function CaptacaoIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 20 H31" /><path d="M28 17 L31 20 L28 23" />
      <path d="M32 28 H17" /><path d="M20 25 L17 28 L20 31" />
    </svg>
  )
}

export default function Header({ loading, refreshing, error, desktop, onToggleView, section, onSection }) {
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

      {/* Compacto: navegação entre seções por ícones, ao lado do título (GER-2).
          No desktop a troca de seção fica nas abas de texto, junto da busca. */}
      {!desktop && (
        <nav className="section-nav" aria-label="Seções">
          <button
            type="button"
            className={`section-btn${section === 'debentures' ? ' active' : ''}`}
            aria-pressed={section === 'debentures'}
            aria-label="Debêntures"
            title="Debêntures"
            onClick={() => onSection('debentures')}
          >
            <DebenturesIcon />
          </button>
          <button
            type="button"
            className={`section-btn${section === 'captacao' ? ' active' : ''}`}
            aria-pressed={section === 'captacao'}
            aria-label="Captação"
            title="Captação"
            onClick={() => onSection('captacao')}
          >
            <CaptacaoIcon />
          </button>
        </nav>
      )}

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

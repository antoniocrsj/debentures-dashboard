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
function VencimentosIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="14" y="15" width="20" height="19" rx="2" />
      <path d="M14 20 H34 M20 13 V17 M28 13 V17" />
      <path d="M20 26 H22 M26 26 H28 M20 30 H22 M26 30 H28" />
    </svg>
  )
}
function ControlPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function ResumoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5l3 2" />
    </svg>
  )
}

export default function Header({
  loading, refreshing, error, desktop, onToggleView, section, onSection,
  hasResumo, onOpenResumo,
}) {
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
        <span className="header-title">{section === 'atualizacao' ? 'Painel de Atualização - BI' : 'BI - Crédito Privado'}</span>
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
          <button
            type="button"
            className={`section-btn${section === 'vencimentos' ? ' active' : ''}`}
            aria-pressed={section === 'vencimentos'}
            aria-label="Vencimentos 12 meses"
            title="Vencimentos 12 meses"
            onClick={() => onSection('vencimentos')}
          >
            <VencimentosIcon />
          </button>
        </nav>
      )}

      {/* Resumo do Dia: visível em desktop e compacto (não é uma "seção" de
          navegação, é um atalho pontual) — só aparece quando há relatórios
          diários gerados (useDailyReports retornou o índice). */}
      {hasResumo && (
        <button
          type="button"
          className="section-btn"
          aria-label="Resumo do Dia"
          title="Resumo do Dia"
          onClick={onOpenResumo}
        >
          <ResumoIcon />
        </button>
      )}

      {/* Painel de controle da atualização: só existe em dev (nunca em produção,
          nem quando alguém acessa este mesmo bundle de outra máquina). */}
      {import.meta.env.DEV && (
        <button
          type="button"
          className={`section-btn cp-header-btn${section === 'atualizacao' ? ' active' : ''}`}
          aria-pressed={section === 'atualizacao'}
          aria-label="Painel de controle da atualização"
          title="Painel de controle da atualização (dev)"
          onClick={() => onSection('atualizacao')}
        >
          <ControlPanelIcon />
        </button>
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

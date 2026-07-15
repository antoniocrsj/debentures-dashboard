// Ícones (line icons). Os ícones de seção agora vivem no BottomNav (rodapé).
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
        <img className="header-logo" src="/icon-192-v2.png" alt="" aria-hidden="true" width="28" height="28" />
        <span className="header-title">{section === 'atualizacao' ? 'Painel de Atualização - Luc' : 'Luc'}</span>
        {loading    && <span className="header-badge loading">carregando…</span>}
        {refreshing && <span className="header-badge refreshing">atualizando…</span>}
        {!loading && !refreshing && error && <span className="header-badge error">erro</span>}
      </div>

      {/* Compacto: a navegação entre seções foi para a barra inferior fixa
          (BottomNav, no rodapé). No desktop a troca de seção fica nas abas de
          texto, junto da busca. */}

      {/* Controles no canto direito, agrupados (perto do botão Compacto):
          Resumo do Dia, painel dev e o toggle de visão. */}
      <div className="header-right">
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
      </div>
    </header>
  )
}

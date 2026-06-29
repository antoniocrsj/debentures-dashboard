import SearchSelect from '../SearchSelect.jsx'

const SHORTCUTS = [
  { months: 1,  label: '1 mês',  short: '1m' },
  { months: 3,  label: '3 meses', short: '3m' },
  { months: 6,  label: '6 meses', short: '6m' },
  { months: 12, label: '12 meses', short: '12m' },
  { months: null, label: 'Todo o histórico', short: 'Tudo' },
]

export default function FluxoFilters({
  tipos, tipo, onTipo,
  gestores, gestor, onGestor,
  months, onMonths, periodLabel, onClear,
  disabled, defaultMonths = 12, compact = false,
}) {
  const hasFilter = gestor || months !== defaultMonths

  return (
    <div className="fluxo-filters" aria-label="Filtros de captação">
      <div className="fluxo-filters-row">
        {/* Tipo de fundo — segmented control */}
        <div className="fluxo-field fluxo-field-tipo">
          <span className="fluxo-field-label">Tipo de fundo</span>
          <div className="segmented" role="tablist" aria-label="Tipo de fundo">
            {tipos.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tipo === t.id}
                className={`segmented-btn${tipo === t.id ? ' active' : ''}`}
                onClick={() => onTipo(t.id)}
                disabled={disabled}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Gestor */}
        <div className="fluxo-field">
          <span className="fluxo-field-label">Gestor</span>
          <SearchSelect
            label="Todos os gestores"
            value={gestor}
            options={gestores}
            disabled={disabled}
            onChange={onGestor}
          />
        </div>

        {/* Período — só atalhos */}
        <div className="fluxo-field fluxo-field-grow">
          <span className="fluxo-field-label">Período</span>
          <div className="period-shortcuts" role="group" aria-label="Período">
            {SHORTCUTS.map(s => {
              const active = months === s.months
              // Toggle: clicar no atalho ativo (que nao seja "Todo o historico") volta
              // para null = todo o historico. No mobile o botao "Todo o historico" fica
              // oculto, entao esse e o caminho para o estado de historico completo.
              return (
                <button
                  key={s.label}
                  className={`period-chip${active ? ' active' : ''}${s.months === null ? ' period-chip-all' : ''}`}
                  onClick={() => onMonths(months === s.months && s.months !== null ? null : s.months)}
                  disabled={disabled}
                  aria-pressed={active}
                  title={s.label}
                >
                  {compact ? s.short : s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="fluxo-period-info">
        {periodLabel && <span className="period-effective">{periodLabel}</span>}
        {hasFilter && (
          <button className="chip-clear" onClick={onClear} aria-label="Limpar filtros">
            ✕ Limpar
          </button>
        )}
      </div>
    </div>
  )
}

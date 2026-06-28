import SearchSelect from '../SearchSelect.jsx'

const SHORTCUTS = [
  { months: 1,  label: '1 mês' },
  { months: 3,  label: '3 meses' },
  { months: 6,  label: '6 meses' },
  { months: 12, label: '12 meses' },
  { months: null, label: 'Todo o histórico' },
]

export default function FluxoFilters({
  tipos, tipo, onTipo,
  gestores, gestor, onGestor,
  months, onMonths, periodLabel, onClear,
  disabled, defaultMonths = 12,
}) {
  const hasFilter = gestor || months !== defaultMonths

  return (
    <div className="fluxo-filters" aria-label="Filtros de captação">
      {/* Tipo de fundo — segmented control */}
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

      <div className="fluxo-filters-row">
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
              return (
                <button
                  key={s.label}
                  className={`period-chip${active ? ' active' : ''}`}
                  onClick={() => onMonths(s.months)}
                  disabled={disabled}
                  aria-pressed={active}
                >
                  {s.label}
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

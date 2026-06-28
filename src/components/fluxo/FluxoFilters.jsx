import SearchSelect from '../SearchSelect.jsx'

const SHORTCUTS = [
  { months: 3,  label: '3 meses' },
  { months: 6,  label: '6 meses' },
  { months: 12, label: '12 meses' },
  { months: null, label: 'Tudo' },
]

const toISO = d => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '')
const fromISO = s => (s ? new Date(s + 'T00:00:00') : null)

export default function FluxoFilters({
  tipos, tipo, onTipo,
  gestores, gestor, onGestor,
  period, onPeriod, onClear,
  disabled,
}) {
  const hasFilter = gestor || period.start || period.end || period.months !== 12

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
          <span className="fluxo-field-label" id="lbl-gestor-fluxo">Gestor</span>
          <SearchSelect
            label="Todos os gestores"
            value={gestor}
            options={gestores}
            disabled={disabled}
            onChange={onGestor}
          />
        </div>

        {/* Período — atalhos */}
        <div className="fluxo-field">
          <span className="fluxo-field-label">Período</span>
          <div className="period-shortcuts" role="group" aria-label="Atalhos de período">
            {SHORTCUTS.map(s => {
              const active = !period.start && !period.end && period.months === s.months
              return (
                <button
                  key={s.label}
                  className={`period-chip${active ? ' active' : ''}`}
                  onClick={() => onPeriod({ start: null, end: null, months: s.months })}
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

      {/* Período — datas explícitas */}
      <div className="fluxo-dates">
        <label className="fluxo-date">
          <span>De</span>
          <input
            type="date"
            value={toISO(period.start)}
            disabled={disabled}
            onChange={e => onPeriod({ ...period, start: fromISO(e.target.value), months: null })}
          />
        </label>
        <label className="fluxo-date">
          <span>Até</span>
          <input
            type="date"
            value={toISO(period.end)}
            disabled={disabled}
            onChange={e => onPeriod({ ...period, end: fromISO(e.target.value), months: null })}
          />
        </label>
        {hasFilter && (
          <button className="chip-clear" onClick={onClear} aria-label="Limpar filtros">
            ✕ Limpar
          </button>
        )}
      </div>
    </div>
  )
}

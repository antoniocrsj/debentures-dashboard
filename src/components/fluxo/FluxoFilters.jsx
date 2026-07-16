import SearchSelect from '../SearchSelect.jsx'

const SHORTCUTS = [
  { months: '1w', label: '1 semana', short: '1s' },
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
  hideFechados = false, onHideFechados, fechadosDisponivel = false,
}) {
  const hasFilter = gestor || months !== defaultMonths || hideFechados

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

        {/* Fundos fechados — incluir/ocultar (condomínio fechado capta por
            emissão de cotas, fluxo esporádico). Mesmo controle no compacto e no desktop. */}
        {onHideFechados && (
          <div className="fluxo-field fluxo-field-fechados">
            <span className="fluxo-field-label">Fundos fechados</span>
            <div className="segmented" role="group" aria-label="Fundos fechados">
              <button
                type="button"
                className={`segmented-btn${!hideFechados ? ' active' : ''}`}
                onClick={() => onHideFechados(false)}
                disabled={disabled}
                aria-pressed={!hideFechados}
                title="Incluir fundos de condomínio fechado"
              >
                Incluir
              </button>
              <button
                type="button"
                className={`segmented-btn${hideFechados ? ' active' : ''}`}
                onClick={() => onHideFechados(true)}
                disabled={disabled || !fechadosDisponivel}
                aria-pressed={hideFechados}
                title={fechadosDisponivel ? 'Ocultar fundos de condomínio fechado' : 'Sem dados de forma de condomínio (rode a atualização)'}
              >
                Ocultar
              </button>
            </div>
          </div>
        )}

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
                  aria-label={s.label}
                  title={s.label}
                >
                  {s.months === '1w' || compact ? s.short : s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* O "Limpar" fica SEMPRE montado (so' desabilita): aparecendo/sumindo com
          o filtro, esta linha nascia do nada e empurrava todo o conteudo ~30px
          ao selecionar uma gestora -- o grafico pulava embaixo do cursor justo
          quando se quer trocar de gestora e comparar. */}
      <div className="fluxo-period-info">
        {periodLabel && <span className="period-effective">{periodLabel}</span>}
        <button className="chip-clear" onClick={onClear} disabled={!hasFilter} aria-label="Limpar filtros">
          ✕ Limpar
        </button>
      </div>
    </div>
  )
}

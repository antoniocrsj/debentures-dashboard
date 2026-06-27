import { useCallback } from 'react'

export default function Filters({ filters, options, disabled, onChange }) {
  const set = useCallback((key, val) => onChange(f => ({ ...f, [key]: val })), [onChange])

  return (
    <div className="filter-bar" aria-label="Filtros">
      <div className="filter-scroll">
        <Select
          label="Grupo"
          value={filters.grupo}
          options={options.grupos}
          disabled={disabled}
          onChange={v => set('grupo', v)}
        />
        <Select
          label="Setor"
          value={filters.setor}
          options={options.setores}
          disabled={disabled}
          onChange={v => set('setor', v)}
        />
        <Select
          label="Ativo"
          value={filters.ativo}
          options={options.ativos}
          disabled={disabled}
          onChange={v => set('ativo', v)}
        />
        <Select
          label="Lei 12.431"
          value={filters.lei12431}
          options={['Sim', 'Não']}
          disabled={disabled}
          onChange={v => set('lei12431', v)}
        />

        {/* Clear all */}
        {Object.values(filters).some(v => v !== '') && (
          <button
            className="chip-clear"
            onClick={() => onChange({ grupo: '', setor: '', lei12431: '', ativo: '', search: '' })}
          >
            ✕ Limpar
          </button>
        )}
      </div>

      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          type="search"
          className="search-input"
          placeholder="Buscar ativo, emissor, grupo…"
          value={filters.search}
          disabled={disabled}
          onChange={e => set('search', e.target.value)}
        />
      </div>
    </div>
  )
}

function Select({ label, value, options, disabled, onChange }) {
  return (
    <div className={`chip-select-wrap${value ? ' active' : ''}`}>
      <select
        className="chip-select"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">{label} ▾</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

import { useCallback } from 'react'
import SearchSelect from './SearchSelect.jsx'

const EMPTY = { grupo: '', setor: '', gestor: '', lei12431: '', ativo: '', search: '' }

export default function Filters({ filters, options, disabled, onChange, tabsSlot, updatedLabel, updatedTooltip, compact = false }) {
  const set = useCallback((key, val) => onChange(f => ({ ...f, [key]: val })), [onChange])

  return (
    <div className="filter-bar" aria-label="Filtros">
      <div className="filter-scroll">
        <SearchSelect label="Grupo"      value={filters.grupo}    options={options.grupos}   disabled={disabled} onChange={v => set('grupo', v)} />
        <SearchSelect label="Setor"      value={filters.setor}    options={options.setores}  disabled={disabled} onChange={v => set('setor', v)} />
        <SearchSelect label="Gestor"     value={filters.gestor}   options={options.gestores} disabled={disabled} onChange={v => set('gestor', v)} />
        <SearchSelect label="Ativo"      value={filters.ativo}    options={options.ativos}   disabled={disabled} onChange={v => set('ativo', v)} />
        <SearchSelect label="12.431" value={filters.lei12431} options={['Sim', 'Não']}   disabled={disabled} onChange={v => set('lei12431', v)} />

        {Object.values(filters).some(v => v !== '') && (
          <button className="chip-clear" onClick={() => onChange(EMPTY)}>✕ Limpar</button>
        )}
      </div>

      {/* No compacto a busca sai (as buscas por ativo/grupo/gestor já vivem nos
          chips acima); no desktop a barra de busca continua. */}
      <div className={`filter-searchrow${tabsSlot ? ' has-tabs' : ''}${compact ? ' no-search' : ''}`}>
        {!compact && (
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
        )}
        {tabsSlot}
        {updatedLabel && <p className="data-updated" title={updatedTooltip}>Atualizado em {updatedLabel}</p>}
      </div>
    </div>
  )
}

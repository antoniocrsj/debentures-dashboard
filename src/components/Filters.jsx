import { useCallback } from 'react'
import SearchSelect from './SearchSelect.jsx'
import SelectAtivos from './SelectAtivos.jsx'
import SearchField from './SearchField.jsx'

const EMPTY = { grupo: '', setor: '', gestor: '', lei12431: '', ativo: '', search: '', comRecompra: '' }
const EMPTY_SEL = new Set()

export default function Filters({ filters, options, disabled, onChange, selection, onSelectionToggle, onSelectionClear, tabsSlot, updatedLabel, updatedTooltip, compact = false }) {
  const set = useCallback((key, val) => onChange(f => ({ ...f, [key]: val })), [onChange])
  const sel = selection || EMPTY_SEL
  const limpar = useCallback(() => { onChange(EMPTY); onSelectionClear?.() }, [onChange, onSelectionClear])

  return (
    <div className="filter-bar" aria-label="Filtros">
      <div className="filter-scroll">
        {!compact && (
          <SearchField
            placeholder="Buscar…"
            aria-label="Buscar debêntures"
            value={filters.search}
            disabled={disabled}
            onChange={e => set('search', e.target.value)}
          />
        )}
        <SearchSelect label="Grupo"      value={filters.grupo}    options={options.grupos}   disabled={disabled} onChange={v => set('grupo', v)} />
        <SearchSelect label="Setor"      value={filters.setor}    options={options.setores}  disabled={disabled} onChange={v => set('setor', v)} />
        <SearchSelect label="Gestor"     value={filters.gestor}   options={options.gestores} disabled={disabled} onChange={v => set('gestor', v)} />
        <SelectAtivos label="Ativo"      options={options.ativos}   selected={sel} disabled={disabled} onToggle={onSelectionToggle} onClear={onSelectionClear} />
        <div className="segmented seg-lei" role="tablist" aria-label="Incentivada (Lei 12.431)">
          {[['Sim', '12.431'], ['Não', 'Tradicional']].map(([v, lab]) => (
            <button key={v} type="button" role="tab" aria-selected={filters.lei12431 === v}
              className={`segmented-btn${filters.lei12431 === v ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => set('lei12431', filters.lei12431 === v ? '' : v)}>{lab}</button>
          ))}
        </div>

        <button
          type="button"
          className={`chip-toggle${filters.comRecompra ? ' is-active' : ''}`}
          disabled={disabled}
          aria-pressed={!!filters.comRecompra}
          title="Mostrar só debêntures com recompra antecipada / breakeven"
          onClick={() => set('comRecompra', filters.comRecompra ? '' : '1')}
        >Só com recompra</button>

        {(Object.values(filters).some(v => v !== '') || sel.size > 0) && (
          <button className="btn btn-limpar" onClick={limpar}>✕ Limpar</button>
        )}
      </div>

      {/* Busca agora vive no canto superior esquerdo da linha de chips (padrao
          de filtros). Aqui ficam so' as abas e o rotulo de atualizacao. */}
      {(tabsSlot || updatedLabel) && (
        <div className={`filter-searchrow${tabsSlot ? ' has-tabs' : ''} no-search`}>
          {tabsSlot}
          {updatedLabel && <p className="data-updated" title={updatedTooltip}>Atualizado em {updatedLabel}</p>}
        </div>
      )}
    </div>
  )
}

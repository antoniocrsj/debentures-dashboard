import { useCallback, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

const EMPTY = { grupo: '', setor: '', gestor: '', lei12431: '', ativo: '', search: '' }

export default function Filters({ filters, options, disabled, onChange }) {
  const set = useCallback((key, val) => onChange(f => ({ ...f, [key]: val })), [onChange])

  return (
    <div className="filter-bar" aria-label="Filtros">
      <div className="filter-scroll">
        <SearchSelect label="Grupo"      value={filters.grupo}    options={options.grupos}   disabled={disabled} onChange={v => set('grupo', v)} />
        <SearchSelect label="Setor"      value={filters.setor}    options={options.setores}  disabled={disabled} onChange={v => set('setor', v)} />
        <SearchSelect label="Gestor"     value={filters.gestor}   options={options.gestores} disabled={disabled} onChange={v => set('gestor', v)} />
        <SearchSelect label="Ativo"      value={filters.ativo}    options={options.ativos}   disabled={disabled} onChange={v => set('ativo', v)} />
        <SearchSelect label="Lei 12.431" value={filters.lei12431} options={['Sim', 'Não']}   disabled={disabled} onChange={v => set('lei12431', v)} />

        {Object.values(filters).some(v => v !== '') && (
          <button className="chip-clear" onClick={() => onChange(EMPTY)}>✕ Limpar</button>
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

function SearchSelect({ label, value, options, disabled, onChange }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos]     = useState({ top: 0, left: 0, width: 0 })
  const btnRef            = useRef(null)
  const dropRef           = useRef(null)

  const toggle = () => {
    if (disabled) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) })
    }
    setOpen(o => !o)
    setQuery('')
  }

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = options
    .filter(o => o.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 30)

  return (
    <div className={`chip-select-wrap${value ? ' active' : ''}`}>
      <button
        ref={btnRef}
        className="chip-select"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="chip-label">{value || `${label} ▾`}</span>
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          className="search-dropdown"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          <div className="dropdown-search">
            <input
              autoFocus
              placeholder="Buscar…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="dropdown-list" role="listbox">
            <div
              className={`dropdown-item${!value ? ' item-selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false) }}
            >
              — Todos —
            </div>
            {filtered.map(o => (
              <div
                key={o}
                className={`dropdown-item${value === o ? ' item-selected' : ''}`}
                onClick={() => { onChange(o); setOpen(false) }}
                role="option"
                aria-selected={value === o}
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="dropdown-empty">Nenhum resultado</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

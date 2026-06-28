import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// Dropdown com busca, renderizado em portal (evita corte por overflow).
// Reutilizado pela barra de filtros do Mercado e pela aba Captação.
export default function SearchSelect({ label, value, options, disabled, onChange }) {
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

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import SearchField from './SearchField.jsx'

// Selecao MULTIPLA de tickers (caixas de marcacao), irma do SearchSelect mas
// sem fechar ao marcar. Compartilha o mesmo estado de selecao do clique na
// tabela Ativos — marcar aqui = clicar na linha com Ctrl. Nao filtra a tabela;
// guia os paineis e o Total. Renderizada em portal (evita corte por overflow).
export default function SelectAtivos({ label = 'Ativo', options, selected, disabled, onToggle, onClear }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos]     = useState({ top: 0, left: 0, width: 0 })
  const btnRef            = useRef(null)
  const dropRef           = useRef(null)

  const count = selected.size

  const toggle = () => {
    if (disabled) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) })
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

  // Marcados no topo (para nao "sumirem" numa lista longa), depois a busca.
  const filtered = options
    .filter(o => o.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (selected.has(b) ? 1 : 0) - (selected.has(a) ? 1 : 0))
    .slice(0, 60)

  return (
    <div className={`chip-select-wrap${count ? ' active' : ''}`}>
      <button
        ref={btnRef}
        className="chip-select"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="chip-label">{count ? `${label}s (${count})` : `${label} ▾`}</span>
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          className="search-dropdown"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          <div className="dropdown-search">
            <SearchField
              wrapClassName="dropdown-search-wrap"
              autoFocus
              placeholder="Buscar…"
              aria-label="Buscar ativo"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="dropdown-list" role="listbox" aria-multiselectable="true">
            {count > 0 && (
              <div className="dropdown-item dropdown-clear" onClick={onClear}>
                ✕ Limpar seleção ({count})
              </div>
            )}
            {filtered.map(o => {
              const on = selected.has(o)
              return (
                <div
                  key={o}
                  className={`dropdown-item dropdown-check${on ? ' item-selected' : ''}`}
                  onClick={() => onToggle(o)}
                  role="option"
                  aria-selected={on}
                >
                  <span className={`check-box${on ? ' on' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
                  {o}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="dropdown-empty">Nenhum resultado</div>
            )}
          </div>
        </div>,
        document.querySelector('.app') || document.body
      )}
    </div>
  )
}

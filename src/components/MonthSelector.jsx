import { useState, useEffect } from 'react'

const GAS_PREFIX = 'https://script.google.com/'

export default function MonthSelector({ months, monthIdx, onChange, onClose }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  function select(idx) {
    onChange(months, idx)
    onClose()
  }

  function remove(idx) {
    if (months.length <= 1) return
    const next = months.filter((_, i) => i !== idx)
    const nextIdx = monthIdx >= next.length ? next.length - 1 : monthIdx
    onChange(next, nextIdx)
  }

  function addMonth() {
    setErr('')
    if (!label.trim()) { setErr('Informe um nome (ex: Mar/26)'); return }
    if (!url.startsWith(GAS_PREFIX)) { setErr('A URL deve começar com https://script.google.com/'); return }
    const next = [...months, { label: label.trim(), url: url.trim() }]
    onChange(next, next.length - 1)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">Carteiras BLC</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-body">
          <p className="month-hint">Selecione ou adicione uma carteira por mês de referência.</p>

          <div className="month-list">
            {months.map((m, i) => (
              <div key={i} className={`month-item${i === monthIdx ? ' selected' : ''}`}>
                <button className="month-item-btn" onClick={() => select(i)}>
                  {i === monthIdx && <span className="month-check">✓</span>}
                  {m.label}
                </button>
                {months.length > 1 && (
                  <button className="month-remove" onClick={() => remove(i)} aria-label={`Remover ${m.label}`}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {!adding ? (
            <button className="btn-add-month" onClick={() => setAdding(true)}>
              + Adicionar mês
            </button>
          ) : (
            <div className="add-month-form">
              <label className="form-label">
                Nome do mês
                <input
                  className="form-input"
                  placeholder="ex: Mar/26"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="form-label">
                URL do Apps Script (Carteira BLC)
                <input
                  className="form-input"
                  placeholder="https://script.google.com/macros/s/…/exec"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </label>
              {err && <p className="form-error">{err}</p>}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => { setAdding(false); setErr('') }}>Cancelar</button>
                <button className="btn-confirm" onClick={addMonth}>Adicionar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

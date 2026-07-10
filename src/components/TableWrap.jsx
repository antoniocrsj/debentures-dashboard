import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Envolve uma tabela e adiciona um botão discreto de "expandir" que só aparece
 * no DESKTOP e apenas quando o cursor está sobre a tabela (via CSS —
 * .app.desktop .table-wrap-x:hover). Ao clicar, abre a MESMA tabela numa janela
 * grande e rolável (portal), para navegar com folga. Fecha no ✕, no fundo ou Esc.
 *
 * A tabela é passada como children e renderizada nos dois lugares; como o estado
 * (ordenação/paginação) vive no componente-pai, as duas visões ficam em sincronia.
 */
export default function TableWrap({ title, children }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    // trava o scroll do fundo enquanto a janela está aberta
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  return (
    <div className="table-wrap-x">
      <button
        type="button"
        className="table-expand-btn"
        title="Expandir tabela"
        aria-label="Expandir tabela"
        onClick={() => setOpen(true)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>

      <div className="table-wrap">{children}</div>

      {open && createPortal(
        <div className="table-modal-overlay" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="table-modal" onClick={e => e.stopPropagation()}>
            <div className="table-modal-head">
              <span className="table-modal-title">{title || 'Tabela'}</span>
              <button type="button" className="table-modal-close" aria-label="Fechar" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="table-modal-body">{children}</div>
          </div>
        </div>,
        // Portal para dentro do .app (mantém os estilos .app.desktop da tabela);
        // cai para o body se por algum motivo o .app não existir.
        document.querySelector('.app') || document.body,
      )}
    </div>
  )
}

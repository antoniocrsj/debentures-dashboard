import { useEffect } from 'react'
import { fmtBRL, fmtDate, isYes } from '../utils/format.js'

export default function AssetModal({ asset, onClose }) {
  // Close on Escape
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const lei = isYes(asset.lei12431Str) ? 'Sim' : (asset.lei12431Str || '—')

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={asset.codigoAtivo}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{asset.codigoAtivo}</h2>
            <p className="modal-subtitle">{asset.emissorNome}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-body">
          <Section title="Emissor">
            <Row label="Emissor"    value={asset.emissorNome} />
            <Row label="Grupo"      value={asset.grupo} />
            <Row label="Setor"      value={asset.setor} />
          </Section>

          <Section title="Características">
            <Row label="Emissão"          value={fmtDate(asset.emissao)} />
            <Row label="Vencimento"        value={fmtDate(asset.vencimento)} />
            <Row label="Indexador"         value={asset.indexador} />
            <Row label="Taxa"              value={asset.taxa} highlight />
            <Row label="Lei 12.431"        value={lei} tag={isYes(asset.lei12431Str)} />
            <Row label="Garantia"          value={asset.garantia} />
            <Row label="Coordenador Líder" value={asset.coordenador} />
          </Section>

          <Section title="Posição">
            <Row label="Vol. emitido" value={asset.volumeEmitido > 0 ? fmtBRL(asset.volumeEmitido) : '—'} />
            <Row label="Alocação BLC" value={asset.alocacao > 0 ? fmtBRL(asset.alocacao) : '—'} highlight />
          </Section>

          {asset.descricao && (
            <Section title="Descrição">
              <p className="modal-desc">{asset.descricao}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="modal-section">
      <h3 className="modal-section-title">{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, value, highlight, tag }) {
  if (!value || value === '—') return null
  return (
    <div className="modal-row">
      <span className="modal-label">{label}</span>
      <span className={`modal-value${highlight ? ' highlight' : ''}`}>
        {tag && <span className="badge-lei">✓</span>}
        {value}
      </span>
    </div>
  )
}

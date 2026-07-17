import { useEffect } from 'react'
import { fmtBRL, fmtDate, isYes } from '../utils/format.js'
import { anbimaUrl } from '../utils/anbima.js'
import { useAgenda } from '../hooks/useAgenda.js'
import { useBooks, fmtBookTaxa, fmtBookDemanda } from '../hooks/useBooks.js'

export default function AssetModal({ asset, onClose }) {
  // Close on Escape
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const lei = isYes(asset.lei12431Str) ? 'Sim' : (asset.lei12431Str || '—')
  const anbimaHref = anbimaUrl(asset.codigoAtivo)   // null quando sem ticker → botão não aparece

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
          {anbimaHref && (
            <div className="modal-actions">
              <a
                className="btn-anbima"
                href={anbimaHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver na ANBIMA
                <svg
                  className="btn-anbima-icon"
                  viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                  fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          )}

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

          <AgendaSection asset={asset} />

          <BookSection asset={asset} />

          <Section title="Posição">
            <Row label="Vol. mercado" value={asset.volumeEmitido > 0 ? fmtBRL(asset.volumeEmitido) : '—'} />
            <Row label="Alocação" value={asset.alocacao > 0 ? fmtBRL(asset.alocacao) : '—'} highlight />
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

// Agenda de eventos (ANBIMA) sob demanda — prazo + amortização + cupom.
// Só aparece no ambiente de dev (o app publicado não tem o proxy).
function AgendaSection({ asset }) {
  const { loading, data, unavailable } = useAgenda(asset.codigoAtivo, asset.emissao, asset.vencimento)
  if (unavailable) return null
  if (loading) {
    return (
      <div className="modal-section">
        <h3 className="modal-section-title">Agenda / Amortização</h3>
        <p className="modal-desc">Carregando agenda…</p>
      </div>
    )
  }
  if (!data || !data.prazoAnos) return null
  const fmt = s => (s && s.includes('-') ? s.split('-').reverse().join('/') : s)
  return (
    <div className="modal-section">
      <h3 className="modal-section-title">Agenda / Amortização</h3>
      <Row label="Prazo" value={data.amortLabel} highlight />
      <Row label="Cupom" value={data.cupom} />
      {data.amortizacoes.length > 0 && (
        <>
          <p className="agenda-sub">Amortizações</p>
          <ul className="agenda-list">
            {data.amortizacoes.map((a, i) => (
              <li key={i}><span>{fmt(a.dataStr)}</span><b>{a.pct != null ? `${a.pct}%` : '—'}</b></li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// yyyymmdd de "DD/MM/AAAA" (via fmtDate, tolerante a ISO/BR)
function dataNum(str) {
  const m = fmtDate(str).match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? +(m[3] + m[2] + m[1]) : 0
}

// Emissao primaria: books (bookbuilding) do GRUPO da debenture, do mercado
// primario. Casa pelo grupo; ordena pela proximidade da emissao desta debenture
// (senao, recencia). So' aparece quando ha' book casado (degrada gracioso: sem
// Books_Primario.csv, o hook devolve Map vazio e a secao some).
function BookSection({ asset }) {
  const { booksByGrupo } = useBooks()
  if (!asset.grupo) return null
  let books = booksByGrupo.get(asset.grupo) || []
  if (!books.length) return null
  const emi = dataNum(asset.emissao)
  books = emi
    ? [...books].sort((a, b) => Math.abs(a.dataNum - emi) - Math.abs(b.dataNum - emi))
    : books
  const mostra = books.slice(0, 3)
  const resto = books.length - mostra.length
  return (
    <div className="modal-section">
      <h3 className="modal-section-title">Emissão primária (book)</h3>
      {mostra.map((bk, i) => (
        <div className="book-entry" key={i}>
          <p className="book-head">
            <span className="book-date">{bk.data}</span>
            {bk.rating && <span className="book-tag">{bk.rating}</span>}
            {bk.regime && <span className="book-tag">{bk.regime}</span>}
          </p>
          <ul className="book-series">
            {bk.series.map((s, j) => {
              const dem = fmtBookDemanda(s)
              // teto so' quando comparavel (mesmo indexador do final) e diferente
              // do final -> evita "IPCA +9,30% -> B32 +1,00%" (bases diferentes).
              const temTeto = s.SpreadTetoPct !== '' && s.SpreadTetoPct != null
                && s.IndexadorTeto === s.IndexadorFinal && s.SpreadTetoPct !== s.SpreadFinalPct
              return (
                <li key={j}>
                  <span className="book-prazo">{s.Serie === 'unica' ? 'Única' : s.Serie} · {s.Prazo || '—'}</span>
                  <span className="book-taxa">
                    {temTeto && <span className="book-teto">{fmtBookTaxa(s, 'Teto')} →</span>}
                    <b>{fmtBookTaxa(s, 'Final')}</b>
                    {dem && <span className="book-dem"> · {dem}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {resto > 0 && <p className="book-more">+{resto} book(s) anterior(es) de {asset.grupo}</p>}
      <p className="book-src">Bookbuilding divulgado · casado pelo grupo</p>
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

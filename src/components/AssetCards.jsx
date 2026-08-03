import { fmtBRL, fmtDateDDMMYY, fmtTaxa, fmtRecompraTaxa, shortEmissor } from '../utils/format.js'

// TESTE (compacto): ativos da aba Debentures como CARDS de 80px, layout do croqui
// do usuario -- 3 colunas com divisorias tracejadas:
//   Col 1: ticker + emissor + Registro CVM + Vencimento
//   Col 2: Taxa, Tx Anbima (com o selo ANBIMA ao lado), Duration, BE + data recompra
//   Col 3: Vol. mercado e Alocacao (R$, destacados)
// Tocar no card abre o modal do ativo. So' no mobile; desktop segue com AssetTable.
const EMPTY_SET = new Set()

// Junta indexador + taxa no estilo do croqui ("CDI + 1,25", "IPCA + 7,95").
function comIndex(indexador, taxaFmt) {
  if (!taxaFmt || taxaFmt === '-') return '-'
  const ix = (indexador || '').trim().toUpperCase()
  if (!ix || ix === 'PRÉ' || ix === 'PRE') return taxaFmt
  if (ix === 'DI' || ix.includes('CDI')) return `CDI + ${taxaFmt}`
  return `${ix} + ${taxaFmt}`
}

export default function AssetCards({ assets, selectedSet, onSelect, onInfoClick }) {
  const sel = selectedSet || EMPTY_SET
  if (!assets.length) {
    return (
      <div className="empty-state">
        <span>Nenhum ativo encontrado</span>
        <small>Ajuste os filtros acima</small>
      </div>
    )
  }
  return (
    <div className="asset-cards">
      {assets.map((a, i) => {
        const r = a.recompra
        const emi = a.grupo ? shortEmissor(a.emissorNome, a.grupo) : ''
        const taxa = comIndex(a.indexador, fmtTaxa(a.taxa))
        const anbima = (a.txAnbima && a.txAnbima !== '—') ? a.txAnbima : ''
        const dur = (a.durationAnbima && a.durationAnbima !== '—') ? a.durationAnbima : '-'
        const be = r ? fmtRecompraTaxa(r.taxaEvento, r.remuneracao) : ''
        const beData = r
          ? (r.statusExercicio === 'Em exercício' ? 'valendo' : (r.dataEvento ? fmtDateDDMMYY(r.dataEvento) : ''))
          : ''
        return (
          <div
            key={a.codigoAtivo || i}
            className={`asset-card${sel.has(a.codigoAtivo) ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onInfoClick && onInfoClick(a)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInfoClick && onInfoClick(a) } }}
          >
            <div className="ac-col ac-id">
              <span className="ativo-code">{a.codigoAtivo || '-'}</span>
              {a.grupo && (
                <span className="ativo-grupo" title={a.emissorNome !== '—' ? a.emissorNome : undefined}>
                  {a.grupo}{emi && <span className="ativo-emissor"> ({emi})</span>}
                </span>
              )}
              <span className="ac-date">{fmtDateDDMMYY(a.registroCvm) || '-'}</span>
              <span className="ac-date">{fmtDateDDMMYY(a.vencimento) || '-'}</span>
            </div>

            <div className="ac-col ac-tax">
              {/* Nominal + spread de emissão do SRE (teto), ex.: "IPCA + 7,95 (B35 −20)". */}
              <span className="ac-line ac-taxa">{taxa}{a.sreSpread ? ` (${a.sreSpread.replace(/bps$/i, '').trim()})` : ''}</span>
              <span className="ac-line ac-anbima">
                {anbima ? <>{anbima}<img className="ac-selo" src="/anbima-selo.jpg" alt="ANBIMA" /></> : <span className="ac-muted">—</span>}
              </span>
              <span className="ac-line ac-muted">Dur: {dur}</span>
              <span className="ac-line">
                {be ? <>BE: {be}{beData && <em className="ac-be-data"> ({beData})</em>}</> : <span className="ac-muted">BE: —</span>}
              </span>
            </div>

            <div className="ac-col ac-val">
              <div className="ac-val-item">
                <span className="ac-k">Vol. mercado</span>
                <span className="ac-v">{a.volumeEmitido > 0 ? fmtBRL(a.volumeEmitido) : '-'}</span>
              </div>
              <div className="ac-val-item">
                <span className="ac-k">Alocação</span>
                <span className="ac-v">{a.alocacao > 0 ? fmtBRL(a.alocacao) : '-'}</span>
              </div>
              {/* Drill de Vencimentos: amortização do mês (abaixo da alocação). */}
              {a.amortVenc != null && (
                <div className="ac-val-item">
                  <span className="ac-k">Amortização</span>
                  <span className="ac-v">{a.amortVenc > 0 ? fmtBRL(a.amortVenc) : '-'}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

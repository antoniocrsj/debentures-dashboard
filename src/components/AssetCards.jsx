import { fmtBRL, fmtDateDDMMYY, fmtTaxa, fmtRecompraTaxa, shortEmissor } from '../utils/format.js'

// TESTE (compacto): mostra os ativos da aba Debentures como CARDS em vez de
// tabela -- como sao muitas colunas, cada ativo vira um card com todas as infos
// num grid de rotulo/valor. Mesma selecao/info da tabela (clique seleciona; o
// botao i abre o modal). So' no mobile; o desktop segue com o AssetTable.
const EMPTY_SET = new Set()

function Campo({ k, v }) {
  return (
    <div className="asset-card-field">
      <span className="asset-card-k">{k}</span>
      <span className="asset-card-v">{v}</span>
    </div>
  )
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
  const select = (cod, e) => onSelect && onSelect(cod, e.ctrlKey || e.metaKey || e.shiftKey)
  return (
    <div className="asset-cards">
      {assets.map((a, i) => {
        const selected = sel.has(a.codigoAtivo)
        const r = a.recompra
        const emi = a.grupo ? shortEmissor(a.emissorNome, a.grupo) : ''
        const recompraTaxa = r ? fmtRecompraTaxa(r.taxaEvento, r.remuneracao) : '-'
        const recompraQuando = r
          ? (r.statusExercicio === 'Em exercício'
              ? 'Valendo'
              : (r.dataEvento ? fmtDateDDMMYY(r.dataEvento) : '-'))
          : '-'
        return (
          <div
            key={a.codigoAtivo || i}
            className={`asset-card${selected ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-selected={selected}
            onClick={e => select(a.codigoAtivo, e)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(a.codigoAtivo, e) } }}
          >
            <div className="asset-card-head">
              <div className="asset-card-id">
                <span className="ativo-code">{a.codigoAtivo || '-'}</span>
                {a.grupo && (
                  <span className="ativo-grupo" title={a.emissorNome !== '—' ? a.emissorNome : undefined}>
                    {a.grupo}{emi && <span className="ativo-emissor"> ({emi})</span>}
                  </span>
                )}
              </div>
              <button className="info-btn" onClick={e => { e.stopPropagation(); onInfoClick && onInfoClick(a) }} aria-label="Ver detalhes">ℹ</button>
            </div>
            <div className="asset-card-grid">
              <Campo k="Reg. CVM" v={fmtDateDDMMYY(a.registroCvm) || '-'} />
              <Campo k="Venc." v={fmtDateDDMMYY(a.vencimento) || '-'} />
              <Campo k="Taxa" v={fmtTaxa(a.taxa) || '-'} />
              <Campo k="Tx Anbima" v={(a.txAnbima && a.txAnbima !== '—') ? a.txAnbima : '-'} />
              <Campo k="Duration" v={(a.durationAnbima && a.durationAnbima !== '—') ? a.durationAnbima : '-'} />
              <Campo k="Indexador" v={a.indexador || '-'} />
              <Campo k="Tx. BE" v={recompraTaxa} />
              <Campo k="Recompra" v={recompraQuando} />
              <Campo k="Vol. mercado" v={a.volumeEmitido > 0 ? fmtBRL(a.volumeEmitido) : '-'} />
              <Campo k="Alocação" v={a.alocacao > 0 ? fmtBRL(a.alocacao) : '-'} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

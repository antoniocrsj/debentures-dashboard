import { fmtBRL, fmtDateShort, fmtTaxa } from '../utils/format.js'

const COLS = [
  { id: 'ativo',      label: 'Ativo',      sticky: true  },
  { id: 'emissao',    label: 'Emis.',      sticky: false },
  { id: 'vencimento', label: 'Venc.',      sticky: false },
  { id: 'taxa',       label: 'Taxa',       sticky: false },
  { id: 'vol',        label: 'Vol. emit.', sticky: false },
  { id: 'alocacao',   label: 'Alocação',   sticky: false },
]

export default function AssetTable({ assets, sort, onSort, activeAtivo, onFilter, onInfoClick }) {
  if (!assets.length) {
    return (
      <div className="empty-state">
        <span>Nenhum ativo encontrado</span>
        <small>Ajuste os filtros acima</small>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="asset-table">
        <colgroup>
          <col className="c-ativo" />
          <col className="c-emis" />
          <col className="c-venc" />
          <col className="c-taxa" />
          <col className="c-vol" />
          <col className="c-aloc" />
        </colgroup>
        <thead>
          <tr>
            {COLS.map(col => (
              <th
                key={col.id}
                className={col.sticky ? 'col-sticky' : ''}
                onClick={() => onSort(col.id)}
                aria-sort={sort.col === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {col.label}
                {sort.col === col.id && (
                  <span className="sort-arrow">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((a, i) => {
            const selected = activeAtivo === a.codigoAtivo
            return (
              <tr
                key={a.codigoAtivo || i}
                className={selected ? 'row-selected' : ''}
                onClick={() => onFilter('ativo', a.codigoAtivo)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onFilter('ativo', a.codigoAtivo)}
              >
                <td className="col-sticky col-ativo">
                  <div className="ativo-cell">
                    <div>
                      <span className="ativo-code">{a.codigoAtivo || '—'}</span>
                      {a.grupo && <span className="ativo-grupo">{a.grupo}</span>}
                    </div>
                    <button
                      className="info-btn"
                      onClick={e => { e.stopPropagation(); onInfoClick(a) }}
                      aria-label="Ver detalhes"
                    >ℹ</button>
                  </div>
                </td>
                <td className="col-num">{fmtDateShort(a.emissao)}</td>
                <td className="col-num">{fmtDateShort(a.vencimento)}</td>
                <td className="col-num">{fmtTaxa(a.taxa)}</td>
                <td className="col-num">{a.volumeEmitido > 0 ? fmtBRL(a.volumeEmitido) : '—'}</td>
                <td className={`col-num col-aloc${a.alocacao > 0 ? ' has-aloc' : ''}`}>
                  {a.alocacao > 0 ? fmtBRL(a.alocacao) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

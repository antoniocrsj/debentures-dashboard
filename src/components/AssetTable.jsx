import { fmtBRL, fmtDateShort, fmtDateDDMMYY, fmtTaxa } from '../utils/format.js'
import TableWrap from './TableWrap.jsx'

const COLS = [
  { id: 'ativo',      label: 'Ativo',      sticky: true,  sortable: true  },
  { id: 'emissao',    label: 'Emis.',      sticky: false, sortable: true  },
  { id: 'vencimento', label: 'Venc.',      sticky: false, sortable: true  },
  { id: 'taxa',       label: 'Taxa',       sticky: false, sortable: true  },
  { id: 'txanbima',   label: 'Tx Anbima',  sticky: false, sortable: false },
  { id: 'duration',   label: 'Duration',   sticky: false, sortable: false },
  { id: 'vol',        label: 'Vol. mercado', sticky: false, sortable: true  },
  { id: 'alocacao',   label: 'Alocação',   sticky: false, sortable: true  },
]

// Monta o tooltip com os dados originais da ANBIMA (auditoria) para uma debênture.
function anbimaTooltip(a, ref) {
  const info = a.anbimaInfo
  if (!info || a.txAnbima === '—') {
    return ref ? `Tx Anbima — sem dado na ANBIMA (ref ${ref})` : 'Tx Anbima — sem dado na ANBIMA'
  }
  const L = []
  if (info.indexadorAnbima) L.push(`Original: ${info.indexadorAnbima}`)
  if (info.codigoNtnbExibicao && info.taxaNtnbReferencia) {
    L.push(`NTN-B ${info.codigoNtnbExibicao}: ${info.taxaNtnbReferencia}%`)
    if (info.spreadNtnbBps) L.push(`Spread: ${info.spreadNtnbBps} bps`)
  }
  if (info.percentualCdiOriginal) L.push(`${info.percentualCdiOriginal}% do CDI → ${a.txAnbima}`)
  if (info.dataReferenciaAnbima) {
    const [y, m, d] = info.dataReferenciaAnbima.split('-')
    L.push(`Ref: ${d}/${m}/${y}`)
  }
  return L.join('\n')
}

export default function AssetTable({ assets, sort, onSort, activeAtivo, onFilter, onInfoClick, anbimaRef, desktop }) {
  const fmtData = desktop ? fmtDateDDMMYY : fmtDateShort
  if (!assets.length) {
    return (
      <div className="empty-state">
        <span>Nenhum ativo encontrado</span>
        <small>Ajuste os filtros acima</small>
      </div>
    )
  }

  const totalVol  = desktop ? assets.reduce((s, a) => s + (a.volumeEmitido || 0), 0) : 0
  const totalAloc = desktop ? assets.reduce((s, a) => s + (a.alocacao || 0), 0) : 0

  return (
    <TableWrap title="Ativos (debêntures)">
      <table className="asset-table">
        <colgroup>
          <col className="c-ativo" />
          <col className="c-emis" />
          <col className="c-venc" />
          <col className="c-taxa" />
          <col className="c-anbima" />
          <col className="c-duration" />
          <col className="c-vol" />
          <col className="c-aloc" />
        </colgroup>
        <thead>
          <tr>
            {COLS.map(col => (
              <th
                key={col.id}
                className={`${col.sticky ? 'col-sticky' : ''}${col.sortable ? '' : ' th-nosort'}`}
                onClick={col.sortable ? () => onSort(col.id) : undefined}
                aria-sort={col.sortable && sort.col === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                title={col.id === 'txanbima' && anbimaRef ? `Taxa indicativa ANBIMA — ref ${anbimaRef}` : undefined}
              >
                {col.label}
                {col.sortable && sort.col === col.id && (
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
                      <span className="ativo-code">{a.codigoAtivo || '-'}</span>
                      {a.grupo && <span className="ativo-grupo">{a.grupo}</span>}
                    </div>
                    <button
                      className="info-btn"
                      onClick={e => { e.stopPropagation(); onInfoClick(a) }}
                      aria-label="Ver detalhes"
                    >ℹ</button>
                  </div>
                </td>
                <td className="col-num">{fmtData(a.emissao)}</td>
                <td className="col-num">{fmtData(a.vencimento)}</td>
                <td className="col-num">{fmtTaxa(a.taxa)}</td>
                <td className="col-num col-anbima" title={anbimaTooltip(a, anbimaRef)}>{(a.txAnbima && a.txAnbima !== '—') ? a.txAnbima : '-'}</td>
                <td className="col-num col-anbima">{(a.durationAnbima && a.durationAnbima !== '—') ? a.durationAnbima : '-'}</td>
                <td className="col-num">{a.volumeEmitido > 0 ? fmtBRL(a.volumeEmitido) : '-'}</td>
                <td className={`col-num col-aloc${a.alocacao > 0 ? ' has-aloc' : ''}`}>
                  {a.alocacao > 0 ? fmtBRL(a.alocacao) : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
        {desktop && (
          <tfoot>
            <tr className="total-row">
              <td className="col-sticky col-ativo">Total</td>
              <td className="col-num"></td>
              <td className="col-num"></td>
              <td className="col-num"></td>
              <td className="col-num col-anbima"></td>
              <td className="col-num col-anbima"></td>
              <td className="col-num">{fmtBRL(totalVol)}</td>
              <td className="col-num col-aloc">{fmtBRL(totalAloc)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </TableWrap>
  )
}

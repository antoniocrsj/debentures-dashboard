// Cabeçalho de tabela ordenável (acessível) reutilizado nas tabelas da Captação.
export default function SortableTh({ col, label, sub, sort, onSort, align = 'right', sticky = false }) {
  const active = sort.col === col
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`fluxo-th-sort${sticky ? ' col-sticky' : ''}${active ? ' active' : ''}`}
      style={{ textAlign: align }}
    >
      <button type="button" className="th-sort-btn" onClick={() => onSort(col)}>
        <span>{label}{sub && <span className="th-sub"> {sub}</span>}</span>
        <span className="th-sort-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

// Cicla a ordenação de uma coluna: nova → desc; desc → asc; asc → volta ao padrão.
export function cycleSort(prev, col, def) {
  if (prev.col !== col) return { col, dir: 'desc' }
  if (prev.dir === 'desc') return { col, dir: 'asc' }
  return { ...def }
}

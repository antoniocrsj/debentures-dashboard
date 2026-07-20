import { useState, useMemo } from 'react'
import { fmtFluxo, fmtFluxoSigned, fmtInt, sortRows } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from '../fluxo/SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

// Tabela de gestoras da aba Tecnico: o FILTRO PRINCIPAL dos 3 graficos (mesmo
// padrao de selecao unica das outras abas — clicar de novo limpa). Cada linha
// cruza 3 fontes independentes (Captacao/Caixa/Vencimentos) pelo nome do
// gestor (mesmo Apelido Gestor em todo o app); %Caixa/Vencimento ficam "—"
// quando o gestor nao aparece naquela fonte (fundo sem caixa estimado, sem
// debenture a vencer em 12m etc.) em vez de mostrar um falso zero.
const LIMIT = 20
const DEFAULT_SORT = { col: 'liquido', dir: 'desc' }
const KEYS = { gestor: g => g.gestor, liquido: g => g.liquido, pctCaixa: g => g.pctCaixa ?? -Infinity, venc12m: g => g.venc12m ?? -Infinity }
const LABELS = { gestor: 'Gestor', liquido: 'Cap. líquida', pctCaixa: '% Caixa', venc12m: 'Vencimento 12m' }

function fmtPct(v) { return v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }

export default function TecnicoGestorTable({ rows, activeGestor, onSelect }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => sortRows(rows, KEYS[sort.col] || KEYS.liquido, sort.dir), [rows, sort])
  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)
  const dirTxt = sort.dir === 'asc' ? '↑' : '↓'

  if (!rows || !rows.length) return null

  return (
    <div className="fluxo-ranking-block tecnico-gestor-table">
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">Gestoras</h3>
        <span className="fluxo-ranking-sub">Ordenado por: {LABELS[sort.col]} {dirTxt}</span>
      </div>
      <TableWrap title="Gestoras — filtro da aba Técnico">
        <table className="asset-table fluxo-table table-clickable">
          <thead>
            <tr>
              <SortableTh col="gestor" label="Gestor" sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="liquido" label="Cap. líquida" sort={sort} onSort={onSort} />
              <SortableTh col="pctCaixa" label="% Caixa" sort={sort} onSort={onSort} />
              <SortableTh col="venc12m" label="Venc. 12m" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(g => {
              const pos = g.liquido > 0, neg = g.liquido < 0
              const active = g.gestor === activeGestor
              return (
                <tr key={g.gestor} className={active ? 'row-active' : ''} onClick={() => onSelect?.(g.gestor)}
                  tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect?.(g.gestor)}
                  title={active ? `Limpar o filtro de ${g.gestor}` : `Filtrar por ${g.gestor}`}>
                  <td className="col-sticky col-gestor"><span className="ativo-code">{g.gestor}</span></td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(g.liquido)}</td>
                  <td className="col-num">{fmtPct(g.pctCaixa)}</td>
                  <td className="col-num">{g.venc12m == null ? '—' : fmtFluxo(g.venc12m)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? (
          <button className="show-all-btn" onClick={() => setShowAll(true)}>
            Mostrando {LIMIT} de {fmtInt(sorted.length)} gestores — ver todos
          </button>
        )
        : <p className="fluxo-note">{fmtInt(sorted.length)} gestores no filtro.</p>}
    </div>
  )
}

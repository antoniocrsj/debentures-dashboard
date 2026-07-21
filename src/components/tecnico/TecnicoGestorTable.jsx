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
const DEFAULT_SORT = { col: 'pl', dir: 'desc' }   // abre pelo maior PL (porte do gestor)
const KEYS = { gestor: g => g.gestor, pl: g => g.pl ?? -Infinity, liquido: g => g.liquido, pctCaixa: g => g.pctCaixa ?? -Infinity, venc3m: g => g.venc3m ?? -Infinity }

function fmtPct(v) { return v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }

export default function TecnicoGestorTable({ rows, activeGestor, onSelect, refDate }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => sortRows(rows, KEYS[sort.col] || KEYS.liquido, sort.dir), [rows, sort])
  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)

  // Total sobre TODAS as gestoras do filtro (nao so' as 20 visiveis). PL, cap.
  // liquida e venc. somam; % Caixa NAO -- somar percentual nao significa nada.
  // Vai a media ponderada pelo PL: sum(pct*PL)/sum(PL), que e' o caixa total
  // sobre o PL total = o nivel de caixa real do conjunto. Ponderada so' sobre
  // quem TEM %Caixa (gestor sem dado de caixa nao dilui o denominador com 0).
  const totais = useMemo(() => {
    let pl = 0, liquido = 0, venc = 0, pctNum = 0, pctDen = 0
    for (const g of rows || []) {
      if (g.pl != null) pl += g.pl
      liquido += g.liquido || 0
      if (g.venc3m != null) venc += g.venc3m
      if (g.pctCaixa != null && g.pl != null && g.pl > 0) { pctNum += g.pctCaixa * g.pl; pctDen += g.pl }
    }
    return { pl, liquido, venc, pctCaixa: pctDen > 0 ? pctNum / pctDen : null }
  }, [rows])

  if (!rows || !rows.length) return null

  return (
    <div className="fluxo-ranking-block tecnico-gestor-table">
      {/* Sem "Gestoras" nem "Ordenado por: X": a 1a coluna ja' se chama Gestor e a
          propria coluna ordenada mostra a seta -- os dois textos repetiam o que
          a tabela dizia de si mesma, gastando uma linha inteira. */}
      <TableWrap title="Gestoras — filtro da aba Técnico">
        <table className="asset-table fluxo-table table-clickable">
          <thead>
            <tr>
              <SortableTh col="gestor" label="Gestor" sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="pl" label="PL" sort={sort} onSort={onSort} />
              <SortableTh col="liquido" label="Cap. líq." sort={sort} onSort={onSort} />
              <SortableTh col="pctCaixa" label="% Caixa" sort={sort} onSort={onSort} />
              <SortableTh col="venc3m" label="Venc. 3M" sort={sort} onSort={onSort} />
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
                  <td className="col-num">{g.pl == null ? '—' : fmtFluxo(g.pl)}</td>
                  <td className={`col-num liq-cell${pos ? ' pos' : neg ? ' neg' : ''}`}>{fmtFluxoSigned(g.liquido)}</td>
                  <td className="col-num">{fmtPct(g.pctCaixa)}</td>
                  <td className="col-num">{g.venc3m == null ? '—' : fmtFluxo(g.venc3m)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="venc-foot-row tecnico-foot-row">
              <td className="col-sticky col-gestor"><b>Total · {fmtInt(sorted.length)}</b></td>
              <td className="col-num"><b>{fmtFluxo(totais.pl)}</b></td>
              <td className={`col-num liq-cell${totais.liquido > 0 ? ' pos' : totais.liquido < 0 ? ' neg' : ''}`}><b>{fmtFluxoSigned(totais.liquido)}</b></td>
              <td className="col-num" title="Média ponderada pelo PL (caixa total ÷ PL total)"><b>{fmtPct(totais.pctCaixa)}</b></td>
              <td className="col-num"><b>{fmtFluxo(totais.venc)}</b></td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? (
          <button className="show-all-btn" onClick={() => setShowAll(true)}>
            Mostrando {LIMIT} de {fmtInt(sorted.length)} gestores — ver todos
          </button>
        )
        : <p className="fluxo-note">{fmtInt(sorted.length)} gestores no filtro{refDate ? ` · base ${refDate}` : ''}.</p>}
    </div>
  )
}

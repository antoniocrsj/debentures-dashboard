import { useState, useMemo } from 'react'
import { sortBy, fmtPctPL, fmtMes, CONF_LABEL, apelidoFundo } from '../../utils/caixa.js'
import { fmtFluxo, fmtInt } from '../../utils/fluxo.js'
import SortableTh, { cycleSort } from '../fluxo/SortableTh.jsx'
import TableWrap from '../TableWrap.jsx'

const LIMIT = 40
const DEFAULT_SORT = { col: 'total', dir: 'desc' }
const KEYS = {
  nome: f => f.nome,
  gestor: f => f.gestor,
  pl: f => f.pl,
  direto: f => f.caixaDireto,
  indireto: f => f.caixaIndiretoConf,
  total: f => f.caixaTotal,
  pct: f => f.pctPL,
  estimado: f => f.caixaEstimado,
}

// Segmento -> classe CSS segura + rotulo curto. Evita class="seg-(fora das
// listas)" (espacos viram multiplas classes) e pilulas com texto longo.
const SEG_BADGE = { CDI: { k: 'CDI', l: 'CDI' }, '12431': { k: '12431', l: '12.431' } }
function segBadge(seg) { return SEG_BADGE[seg] || { k: 'outro', l: 'outro' } }

export default function CaixaFundoTable({ fundos, title, subtitle, className = '' }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => sortBy(fundos, KEYS[sort.col] || KEYS.total, sort.dir), [fundos, sort])

  const onSort = col => setSort(s => cycleSort(s, col, DEFAULT_SORT))
  const shown = showAll ? sorted : sorted.slice(0, LIMIT)

  if (!fundos || !fundos.length) {
    return (
      <div className={`empty-state ${className}`}>
        <span>Nenhum fundo para os filtros</span>
        <small>Ajuste o segmento, a classificação ou a busca.</small>
      </div>
    )
  }

  return (
    <div className={`fluxo-ranking-block ${className}`}>
      <div className="fluxo-ranking-head">
        <h3 className="fluxo-section-title">{title}</h3>
        {subtitle && <span className="fluxo-ranking-sub">{subtitle}</span>}
      </div>
      <TableWrap title={title}>
        <table className="asset-table fluxo-table caixa-fundo-table">
          <thead>
            <tr>
              <SortableTh col="nome" label="Fundo" sort={sort} onSort={onSort} align="left" sticky />
              <SortableTh col="gestor" label="Gestor" sort={sort} onSort={onSort} align="left" />
              <SortableTh col="pct" label="% do PL" sort={sort} onSort={onSort} />
              <SortableTh col="direto" label="Caixa direto" sort={sort} onSort={onSort} />
              <SortableTh col="indireto" label="Indireto" sort={sort} onSort={onSort} />
              <SortableTh col="total" label="Caixa total" sort={sort} onSort={onSort} />
              <SortableTh col="estimado" label="Caixa estimado" sort={sort} onSort={onSort} />
              <th className="th-plain">Confiança</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(f => (
              <tr key={f.cnpj} title={f.justificativa || undefined}>
                <td className="col-sticky col-nome">
                  <span className="caixa-fundo-nome" title={f.nome || f.cnpj}>{apelidoFundo(f.nome) || f.cnpj}</span>
                  <span className="caixa-fundo-tags">
                    {f.segmento && <span className={`caixa-seg seg-${segBadge(f.segmento).k}`}>{segBadge(f.segmento).l}</span>}
                    {f.mesBase && <span className="caixa-mesbase">{fmtMes(f.mesBase)}</span>}
                    {f.feeder && <span className="caixa-flag feeder">feeder</span>}
                    {f.cotasNaoId > 0 && <span className="caixa-flag cotas" title="Cotas confidenciais não identificadas (não viram caixa)">cotas ñ id</span>}
                  </span>
                </td>
                <td className="col-gestor-cell">{f.gestor || '—'}</td>
                <td className="col-num strong">{fmtPctPL(f.pctPL)}</td>
                <td className="col-num">{fmtFluxo(f.caixaDireto)}</td>
                <td className="col-num">{f.caixaIndiretoConf > 0 ? fmtFluxo(f.caixaIndiretoConf) : '—'}</td>
                <td className="col-num">{fmtFluxo(f.caixaTotal)}</td>
                <td className="col-num">{f.caixaEstimado != null ? fmtFluxo(f.caixaEstimado) : '—'}</td>
                <td><span className={`caixa-conf conf-${f.confianca}`}>{CONF_LABEL[f.confianca] || '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!showAll && sorted.length > LIMIT
        ? <button className="show-all-btn" onClick={() => setShowAll(true)}>Mostrando {LIMIT} de {fmtInt(sorted.length)} fundos — ver todos</button>
        : <p className="fluxo-note">{fmtInt(sorted.length)} fundos.</p>}
    </div>
  )
}

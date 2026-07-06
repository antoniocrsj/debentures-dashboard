import { useEffect } from 'react'
import { fmtBRL } from '../utils/format.js'
import { fmtDia } from '../utils/reports.js'
import { downloadFile } from '../utils/download.js'

const money = v => fmtBRL(typeof v === 'number' ? v : Number(v))
const pct = v => (v == null || Number.isNaN(+v) ? '—' : `${(+v).toFixed(2)}%`)
// Variação em bps, com sinal e minus tipográfico; 1 casa, sem zero à direita.
const sinalBps = v => {
  const r = Math.round(Number(v) * 10) / 10
  const sinal = r > 0 ? '+' : r < 0 ? '−' : ''
  const abs = Math.abs(r).toFixed(1).replace(/\.0$/, '').replace('.', ',')
  return `${sinal}${abs} bps`
}

function Empty({ children }) { return <p className="rd-empty">{children}</p> }

function Section({ title, children }) {
  return (
    <div className="rd-section">
      <h3 className="rd-section-title">{title}</h3>
      {children}
    </div>
  )
}

function Bullets({ items }) {
  if (!items?.length) return <Empty>Sem eventos relevantes neste dia.</Empty>
  return (
    <ul className="rd-bullets">
      {items.map((b, i) => <li key={i} className={b.tom ? `rd-${b.tom}` : ''}>{b.texto}</li>)}
    </ul>
  )
}

function Debentures({ sec }) {
  if (!sec?.novas?.length) return <Empty>Sem novas debêntures cadastradas neste dia.</Empty>
  return (
    <div className="rd-tablewrap">
      <table className="rd-table">
        <thead><tr><th>Ativo</th><th>Empresa</th><th>Venc.</th><th>Indexador</th><th>Taxa</th><th>12.431</th></tr></thead>
        <tbody>
          {sec.novas.map((d, i) => (
            <tr key={d.ticker || i}>
              <td className="rd-strong">{d.ticker}</td>
              <td className="rd-empresa" title={d.empresa}>{d.empresa}</td>
              <td>{d.vencimento}</td>
              <td>{d.indexador}</td>
              <td>{d.taxa}</td>
              <td>{d.incentivada ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sec.saidas?.length > 0 && (
        <p className="rd-note">{sec.saidas.length} debênture(s) saíram da base.</p>
      )}
    </div>
  )
}

function Captacao({ sec }) {
  const seg = (c, nome) => {
    if (!c) return <div className="rd-cap-seg"><h4>{nome}</h4><Empty>Sem dado de captação neste dia.</Empty></div>
    const pos = c.liquido >= 0
    return (
      <div className="rd-cap-seg">
        <h4>{nome} <span className="rd-cap-dia">· {fmtDia(c.dia)}</span></h4>
        <div className="rd-kv"><span>Captação</span><b>{money(c.captacao)}</b></div>
        <div className="rd-kv"><span>Resgate</span><b>{money(c.resgate)}</b></div>
        <div className="rd-kv"><span>Líquido</span><b className={pos ? 'rd-pos' : 'rd-neg'}>{money(c.liquido)}</b></div>
        <div className="rd-kv"><span>PL</span><b>{money(c.pl)}</b></div>
        <div className="rd-kv"><span>Nº fundos</span><b>{c.numFundos}</b></div>
        {c.anterior && <div className="rd-kv rd-muted"><span>Líquido {fmtDia(c.anterior.dia)}</span><b>{money(c.anterior.liquido)}</b></div>}
      </div>
    )
  }
  return (
    <div className="rd-cap">
      {seg(sec?.['12431'], 'Incentivados (12.431)')}
      {seg(sec?.trad, 'Crédito Tradicional')}
    </div>
  )
}

function TopGestores({ arr, titulo }) {
  if (!arr?.length) return <div className="rd-top"><h4>{titulo}</h4><Empty>Sem destaques.</Empty></div>
  return (
    <div className="rd-top">
      <h4>{titulo}</h4>
      <ol className="rd-ol">
        {arr.map((g, i) => <li key={g.gestor || i}><span>{g.gestor}</span><b className={g.liquido >= 0 ? 'rd-pos' : 'rd-neg'}>{money(g.liquido)}</b></li>)}
      </ol>
    </div>
  )
}

function Anbima({ sec }) {
  if (sec?.semAnterior) return <Empty>Sem dia anterior de ANBIMA para comparar — começa a partir do próximo snapshot.</Empty>
  const lista = (arr, titulo) => arr?.length
    ? (
      <div className="rd-top">
        <h4>{titulo}</h4>
        <ol className="rd-ol">
          {arr.map((a, i) => (
            <li key={a.ticker || i}>
              <span className="rd-empresa">{a.ticker} <em>{a.fmtAnterior} → {a.fmtAtual}</em></span>
              {/* abertura de spread (+bps) = vermelho; fechamento (−bps) = verde */}
              <b className={a.variacaoBps > 0 ? 'rd-neg' : a.variacaoBps < 0 ? 'rd-pos' : ''}>{sinalBps(a.variacaoBps)}</b>
            </li>
          ))}
        </ol>
      </div>
    ) : null
  if (!sec?.aberturas?.length && !sec?.fechamentos?.length) return <Empty>Sem variações de spread neste dia.</Empty>
  return <>{lista(sec.aberturas, 'Maiores aberturas de spread (bps)')}{lista(sec.fechamentos, 'Maiores fechamentos de spread (bps)')}</>
}

function Perf({ sec }) {
  const bloco = (pos, neg, nome) => {
    if (!pos?.length && !neg?.length) return <div className="rd-top"><h4>{nome}</h4><Empty>Sem performance diária neste dia.</Empty></div>
    const li = f => <li key={f.cnpj}><span className="rd-empresa" title={f.nome}>{f.nome} <em>{f.gestor}</em></span><b className={f.retorno >= 0 ? 'rd-pos' : 'rd-neg'}>{pct(f.retorno)}</b></li>
    return (
      <div className="rd-top">
        <h4>{nome} — altas</h4><ol className="rd-ol">{pos.map(li)}</ol>
        <h4>{nome} — quedas</h4><ol className="rd-ol">{neg.map(li)}</ol>
      </div>
    )
  }
  return <>{bloco(sec?.top12431Pos, sec?.top12431Neg, 'Incentivados')}{bloco(sec?.topTradPos, sec?.topTradNeg, 'Tradicional')}</>
}

function Fundos({ sec }) {
  if (sec?.semAnterior) return <Empty>Sem snapshot anterior do universo de fundos — começa a partir do próximo.</Empty>
  if (!sec?.novos?.length && !sec?.removidos?.length) return <Empty>Sem mudanças no universo de fundos.</Empty>
  return (
    <>
      <p className="rd-note">Novos: {sec.novos.length} · Removidos: {sec.removidos.length}</p>
      {sec.novos.slice(0, 15).map((f, i) => <div key={f.cnpj || i} className="rd-kv"><span className="rd-empresa" title={f.nome}>{f.nome || f.cnpj}</span><b>{f.segmento}</b></div>)}
    </>
  )
}

function Alertas({ arr }) {
  if (!arr?.length) return <Empty>Nenhum alerta de qualidade.</Empty>
  return <ul className="rd-bullets">{arr.map((a, i) => <li key={i} className="rd-warn">{a.texto}</li>)}</ul>
}

export default function ResumoDoDiaModal({ index, report, loadingReport, selectedDate, onSelectDate, onClose }) {
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const reports = index?.reports || []
  const s = report?.sections
  const inc = s?.inclusoes

  const baixar = ext => {
    if (!report) return
    downloadFile(`/reports/daily/${report.date}.${ext}`, `resumo-do-dia-${report.date}.${ext}`).catch(() => {})
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Resumo do Dia">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Resumo do Dia</h2>
            <p className="modal-subtitle">Variações por data dos dados vs. dia anterior disponível</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="rd-toolbar">
          <div className="rd-dates" role="tablist" aria-label="Datas disponíveis">
            {reports.map(r => (
              <button
                key={r.date}
                className={`rd-date-chip${r.date === selectedDate ? ' active' : ''}`}
                onClick={() => onSelectDate(r.date)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="rd-download">
            <button className="rd-dl-btn" onClick={() => baixar('html')} disabled={!report}>Baixar HTML</button>
            <button className="rd-dl-btn" onClick={() => baixar('json')} disabled={!report}>JSON</button>
          </div>
        </div>

        <div className="modal-body">
          {loadingReport && <p className="rd-empty">Carregando…</p>}
          {!loadingReport && !report && <p className="rd-empty">Selecione uma data.</p>}
          {!loadingReport && report && (
            <>
              <Section title="1. Sumário executivo"><Bullets items={report.summary} /></Section>
              <Section title="2. Novas debêntures cadastradas"><Debentures sec={s.debentures} /></Section>
              <Section title="3. Captação líquida do dia"><Captacao sec={s.captacao} /></Section>
              <Section title="4. Destaques por gestor">
                <TopGestores arr={s.gestores?.top12431Captacao} titulo="Top captação 12.431" />
                <TopGestores arr={s.gestores?.top12431Resgate} titulo="Top resgate 12.431" />
                <TopGestores arr={s.gestores?.topTradCaptacao} titulo="Top captação Tradicional" />
                <TopGestores arr={s.gestores?.topTradResgate} titulo="Top resgate Tradicional" />
              </Section>
              <Section title="5. Variação ANBIMA (taxa/spread)"><Anbima sec={s.anbima} /></Section>
              <Section title="6. Ativos incluídos">
                <p className="rd-note">
                  Novos em Debêntures: {inc?.novosDebentures?.length || 0}
                  {inc?.temSnapshotBlc ? ` · Novos no BLC: ${inc.novosBlc.length}` : ''}
                </p>
              </Section>
              <Section title="7. Fundos incluídos/excluídos"><Fundos sec={s.fundos} /></Section>
              <Section title="8. Performance de fundos"><Perf sec={s.perf} /></Section>
              <Section title="9. Alertas de qualidade"><Alertas arr={s.alertas} /></Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

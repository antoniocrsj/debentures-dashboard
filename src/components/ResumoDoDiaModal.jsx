import { useEffect } from 'react'
import { fmtBRL } from '../utils/format.js'
import { fmtDia } from '../utils/reports.js'
import { downloadFile } from '../utils/download.js'

const money = v => fmtBRL(typeof v === 'number' ? v : Number(v))
const pct = v => (v == null || Number.isNaN(+v) ? '—' : `${(+v).toFixed(2)}%`)
// Valor em milhões de reais (R$ MM), 1 casa, separador pt-BR (só o número).
const mm = v => {
  const n = Number(v) / 1e6
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'
}
// Variação em bps, com sinal e minus tipográfico; 1 casa, sem zero à direita.
const sinalBps = v => {
  const r = Math.round(Number(v))   // bps já é granular: inteiro, sem sufixo (header já diz "bps")
  const sinal = r > 0 ? '+' : r < 0 ? '−' : ''
  return `${sinal}${Math.abs(r)}`
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

function Debentures({ sec, cvm, faltantes }) {
  const temNovas = sec?.novas?.length > 0
  return (
    <div className="rd-tablewrap">
      {temNovas ? (
        <>
          <table className="rd-table">
            <thead><tr><th>Ativo</th><th>Emis.</th><th>Venc.</th><th>Taxa</th><th className="rd-num">Vol. mercado</th></tr></thead>
            <tbody>
              {sec.novas.map((d, i) => (
                <tr key={d.ticker || i}>
                  <td className="rd-strong">{d.ticker}{d.grupo && <span className="rd-sub">{d.grupo}</span>}</td>
                  <td>{fmtDia(d.dataEmissao)}</td>
                  <td>{fmtDia(d.vencimento)}</td>
                  <td>{d.taxa}</td>
                  <td className="rd-num">{d.volumeEmitido > 0 ? money(d.volumeEmitido) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sec.saidas?.length > 0 && (
            <p className="rd-note">{sec.saidas.length} debênture(s) saíram da base.</p>
          )}
        </>
      ) : (
        <Empty>Sem novas debêntures cadastradas neste dia.</Empty>
      )}
      <EmissoesCVM cvm={cvm} />
      <EmissoresFaltantes faltantes={faltantes} />
    </div>
  )
}

// Emissores das emissões novas ainda sem grupo cadastrado — o usuário classifica
// e adiciona ao Cadastro_Emissores (lista também em Emissores_Faltantes.csv).
function EmissoresFaltantes({ faltantes }) {
  if (!faltantes?.itens?.length) return null
  return (
    <div className="rd-cvm">
      <h4>Emissores novos sem grupo cadastrado <span className="rd-cap-dia">· {faltantes.itens.length}</span></h4>
      <p className="rd-note">Classifique o grupo econômico e adicione ao seu cadastro (lista em <code>Emissores_Faltantes.csv</code>).</p>
      <table className="rd-table">
        <thead><tr><th>CNPJ</th><th>Emissor</th></tr></thead>
        <tbody>
          {faltantes.itens.map((e, i) => (
            <tr key={e.cnpj || i}><td>{e.cnpj}</td><td className="rd-empresa" title={e.emissor}>{e.emissor}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Emissões registradas na CVM (oferta_distribuicao) ainda não no cadastro.
// Lista de pendências (posição atual), só presente no relatório mais recente.
function EmissoesCVM({ cvm }) {
  if (!cvm) return null
  return (
    <div className="rd-cvm">
      <h4>
        Registradas na CVM, ainda não no cadastro
        {cvm.asOf && <span className="rd-cap-dia"> · posição em {fmtDia(cvm.asOf)}</span>}
      </h4>
      {cvm.itens?.length ? (
        <table className="rd-table">
          <thead><tr><th>Data req.</th><th>Emissão</th><th>Emissor</th><th>Grupo</th><th>Líder</th><th className="rd-num">Valor (R$ MM)</th></tr></thead>
          <tbody>
            {cvm.itens.map((e, i) => (
              <tr key={`${e.cnpj}-${e.emissao}-${i}`}>
                <td>{fmtDia(e.dataRequerimento || e.dataRegistro)}</td>
                <td>{e.emissao != null ? `${e.emissao}ª` : '—'}</td>
                <td className="rd-empresa" title={e.emissor}>{e.emissor}</td>
                <td className="rd-empresa" title={e.grupo}>{e.grupo || '—'}</td>
                <td className="rd-empresa" title={e.lider}>{e.lider || '—'}</td>
                <td className="rd-num">{mm(e.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Nenhuma emissão pendente na CVM neste momento.</Empty>
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
        <div className="rd-kv"><span>Cap. líquida</span><b className={pos ? 'rd-pos' : 'rd-neg'}>{money(c.liquido)}</b></div>
        <div className="rd-kv"><span>PL</span><b>{money(c.pl)}</b></div>
        <div className="rd-kv" title="Fundos da sua lista curada que reportaram no Informe Diário deste dia (a lista é constante)">
          <span>Fundos reportados</span>
          <b>{c.numFundos}{c.curados ? <span className="rd-cap-dia"> de {c.curados}</span> : ''}</b>
        </div>
        {c.fechados ? (
          <div className="rd-kv" title="Fundos de condomínio fechado na sua lista: captam por emissão de cotas (fluxo esporádico), não por aportes diários">
            <span>Fundos fechados</span>
            <b>{c.fechados} <span className="rd-cap-dia">condomínio fechado</span></b>
          </div>
        ) : null}
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

// Duas tabelas lado a lado (Incentivados | Tradicional), cada uma com o Top 5 de
// captação líquida positiva (verde) e negativa (vermelho).
function GestoresLado({ gestores }) {
  const seg = (capArr, resArr, nome) => {
    const cap = capArr || [], res = resArr || []
    return (
      <div className="rd-cap-seg">
        <h4>{nome}</h4>
        {cap.length || res.length ? (
          <table className="rd-table">
            <thead><tr><th>Gestor</th><th className="rd-num">Cap. líquida</th></tr></thead>
            <tbody>
              {cap.map((g, i) => <tr key={'p' + i}><td className="rd-empresa" title={g.gestor}>{g.gestor}</td><td className="rd-num rd-pos">{money(g.liquido)}</td></tr>)}
              {cap.length > 0 && res.length > 0 && <tr className="rd-sep"><td colSpan={2}></td></tr>}
              {res.map((g, i) => <tr key={'n' + i}><td className="rd-empresa" title={g.gestor}>{g.gestor}</td><td className="rd-num rd-neg">{money(g.liquido)}</td></tr>)}
            </tbody>
          </table>
        ) : <Empty>Sem destaques.</Empty>}
      </div>
    )
  }
  return (
    <div className="rd-cap">
      {seg(gestores?.top12431Captacao, gestores?.top12431Resgate, 'Incentivados (12.431)')}
      {seg(gestores?.topTradCaptacao, gestores?.topTradResgate, 'Crédito Tradicional')}
    </div>
  )
}

// Tabela de variação de spread (top 15). Abertura (+bps) = vermelho; fechamento
// (−bps) = verde. Nunca taxa nominal — sempre spread.
function Anbima({ sec }) {
  if (sec?.semAnterior) return <Empty>Sem dia anterior de ANBIMA para comparar — começa a partir do próximo snapshot.</Empty>
  const tabela = (arr, titulo) => arr?.length ? (
    <div className="rd-top">
      <h5 className="rd-anb-sub">{titulo}</h5>
      <div className="rd-tablewrap">
        <table className="rd-table">
          <thead><tr><th>Ativo</th><th>Grupo</th><th>Emissor</th><th>Indexador</th><th>Spread Anbima</th><th className="rd-num">Duration (a)</th><th className="rd-num">Var. (bps)</th></tr></thead>
          <tbody>
            {arr.map((a, i) => (
              <tr key={a.ticker || i}>
                <td className="rd-strong">{a.ticker}</td>
                <td className="rd-empresa" title={a.grupo}>{a.grupo || '—'}</td>
                <td className="rd-empresa" title={a.emissor}>{a.emissor || '—'}</td>
                <td>{a.indexadorFamilia}</td>
                <td>{a.spreadAtual || a.fmtAtual}</td>
                <td className="rd-num">{a.durationAnos != null ? a.durationAnos.toFixed(2) : '—'}</td>
                <td className={'rd-num ' + (a.variacaoBps > 0 ? 'rd-neg' : a.variacaoBps < 0 ? 'rd-pos' : '')}>{sinalBps(a.variacaoBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : null
  // Um bloco por mercado (Incentivadas 12.431 / Tradicional): placar do mercado
  // inteiro + top 15 de abertura e de fechamento.
  const mercado = (g, nome) => {
    if (!g || !g.totalComparados) return <div className="rd-top"><h4>{nome}</h4><Empty>Sem variações de spread comparáveis neste dia.</Empty></div>
    const vm = Math.round(g.variacaoMediaBps || 0)
    return (
      <div className="rd-top">
        <h4>{nome}</h4>
        <p className="rd-note">
          <b className="rd-neg">{g.totalAberturas}</b> abertura(s) e <b className="rd-pos">{g.totalFechamentos}</b> fechamento(s) de spread — de {g.totalComparados} ativo(s) com taxa ANBIMA · média{' '}
          <b className={vm > 0 ? 'rd-neg' : vm < 0 ? 'rd-pos' : ''}>{vm > 0 ? '+' : ''}{vm} bps</b>
        </p>
        {tabela(g.aberturas, 'Maiores aberturas')}
        {tabela(g.fechamentos, 'Maiores fechamentos')}
      </div>
    )
  }
  const pm = sec?.porMercado
  if (!pm) return <Empty>Sem variações de spread neste dia.</Empty>
  return <>{mercado(pm['12431'], 'Incentivadas (12.431)')}{mercado(pm.trad, 'Tradicional')}</>
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
  return <><p className="rd-note">Retorno nominal da cota no dia (não é %CDI).</p>{bloco(sec?.top12431Pos, sec?.top12431Neg, 'Incentivados')}{bloco(sec?.topTradPos, sec?.topTradNeg, 'Tradicional')}</>
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
              <Section title="2. Novas debêntures e emissões">
                <Debentures sec={s.debentures} cvm={s.emissoesCVM} faltantes={s.emissoresFaltantes} />
                {inc?.temSnapshotBlc && inc.novosBlc?.length > 0 && (
                  <p className="rd-note">Novos ativos no BLC/alocação: {inc.novosBlc.length}</p>
                )}
              </Section>
              <Section title="3. Captação líquida do dia"><Captacao sec={s.captacao} /></Section>
              <Section title="4. Destaques por gestor (captação líquida)">
                <GestoresLado gestores={s.gestores} />
              </Section>
              <Section title="5. Variação ANBIMA (spread)"><Anbima sec={s.anbima} /></Section>
              <Section title="6. Fundos incluídos/excluídos"><Fundos sec={s.fundos} /></Section>
              <Section title="7. Performance de fundos"><Perf sec={s.perf} /></Section>
              <Section title="8. Alertas de qualidade"><Alertas arr={s.alertas} /></Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { fmtBRL, shortInstituicao } from '../utils/format.js'
import { fmtDia } from '../utils/reports.js'
import { downloadFile, downloadName } from '../utils/download.js'
import { siglaBanco, fmtValorCurto, fmtDataDia, tenorAmort, spreadFinalCurto } from '../utils/sreCard.js'

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

function Debentures({ sec, cvm, faltantes, sre, periodo }) {
  const temNovas = sec?.novas?.length > 0
  // Período: registro no intervalo (colunas Ticker/Emissor/Grupo/Registro).
  if (periodo) {
    return temNovas ? (
      <div className="rd-tablewrap">
        <table className="rd-table">
          <thead><tr><th>Ativo</th><th>Emissor</th><th>Grupo</th><th>Registro</th></tr></thead>
          <tbody>
            {sec.novas.map((d, i) => (
              <tr key={d.ticker || i}>
                <td className="rd-strong">{d.ticker}{d.incentivada && <span className="rd-sub">12.431</span>}</td>
                <td className="rd-empresa" title={d.empresa}>{d.empresa || '—'}</td>
                <td className="rd-empresa" title={d.grupo}>{d.grupo || '—'}</td>
                <td>{fmtDia(d.dataRegistro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : <Empty>Nenhuma nova debênture registrada no período.</Empty>
  }
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
      <OfertasSRE sre={sre} />
      <EmissoesCVM cvm={cvm} />
      <EmissoresFaltantes faltantes={faltantes} />
    </div>
  )
}

// ── Card de oferta do SRE (mesmo do relatório HTML, ver tools/relatorios/card-sre.mjs).
// Estilos inline (paleta Luc, hex literais) p/ ficar idêntico ao card do relatório.
// Restyle compacto (só apresentação): sem status/resgate/datas, tipo texto puro.
const SRE_C = { T: '#8c5e3a', CARVAO: '#2a2420', TAUPE: '#9a8c7a', BORDA: '#6f4a2e', DIV: '#eee5db', BEGE: '#f2ede5' }

// remuneração numa linha: teto em terracota + "(final X%)" em carvão quando existir.
function CelRemun({ s }) {
  const main = s.teto || s.final || '—'
  const fin = (s.teto && s.final) ? spreadFinalCurto(s.final) : null
  return (
    <>
      <span style={{ fontSize: 12, fontWeight: 500, color: SRE_C.T }}>{main}</span>
      {fin && <span style={{ fontSize: 9.5, fontWeight: 400, color: SRE_C.CARVAO }}> (final {fin})</span>}
    </>
  )
}
// 12.431 / Trad como texto simples (sem fundo, borda, badge ou negrito)
function SeloTipo({ inc }) {
  return <span style={{ fontSize: 12, fontWeight: 400, color: SRE_C.CARVAO }}>{inc ? '12.431' : 'Trad'}</span>
}

function CardSRE({ o }) {
  const series = Array.isArray(o.series) ? o.series : []
  const tdLbl = { textAlign: 'left', padding: '3px 7px', fontSize: 11, fontWeight: 400, color: SRE_C.CARVAO }
  const tdV = { textAlign: 'center', padding: '3px 7px', verticalAlign: 'middle' }
  const bb = { borderBottom: `1px solid ${SRE_C.DIV}` }
  const razao = o.razaoSocial && o.razaoSocial.toLowerCase() !== String(o.emissor || '').toLowerCase() ? o.razaoSocial : o.grupo
  return (
    <div style={{ background: '#fff', border: `1px solid ${SRE_C.BORDA}`, borderRadius: 8, boxShadow: '0 1px 2px rgb(42 36 32 / 7%)', overflow: 'hidden', margin: '8px 0', color: SRE_C.CARVAO }}>
      <div style={{ minHeight: 42, padding: '5px 10px', borderBottom: `1px solid ${SRE_C.DIV}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 11, color: SRE_C.T, fontWeight: 500 }}>{fmtDataDia(o.data)}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: SRE_C.CARVAO }}>{o.emissor || '—'}</span>
          {razao && <span style={{ fontSize: 11, color: SRE_C.CARVAO }}>{razao}</span>}
        </div>
        {o.rating && <span style={{ fontSize: 11, color: SRE_C.TAUPE }}>{o.rating}</span>}
      </div>
      <div style={{ minHeight: 32, padding: '4px 10px', borderBottom: `1px solid ${SRE_C.DIV}`, fontSize: 11, lineHeight: 1.6, color: SRE_C.CARVAO }}>
        Sindicato <span style={{ fontWeight: 500 }}>{(o.sindicato || []).length
          ? (o.sindicato || []).map((c, k) => <span key={k}>{k > 0 ? ' · ' : ''}{siglaBanco(c.nome || c.razaoSocial)}{c.lider && ' (líder)'}</span>)
          : '—'}</span>
        <span style={{ color: SRE_C.TAUPE, margin: '0 7px' }}>|</span>
        Total <span style={{ fontWeight: 500 }}>{fmtValorCurto(o.valorTotal ?? o.valor)}</span>
        <span style={{ color: SRE_C.TAUPE, margin: '0 7px' }}>|</span>
        <span style={{ fontWeight: 500 }}>{series.length || o.numSeries || '—'} série{(series.length || o.numSeries) === 1 ? '' : 's'}</span>
      </div>
      {series.length ? (
        <div style={{ padding: '5px 8px 7px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: Math.max(360, 110 + series.length * 90) }}>
            <thead><tr style={{ background: SRE_C.BEGE }}><th style={{ ...tdLbl, height: 28 }}>Série</th>{series.map((_, i) => <th key={i} style={{ height: 28, padding: '3px 7px', textAlign: 'center', fontSize: 11, fontWeight: 500, color: SRE_C.CARVAO }}>{i + 1}ª</th>)}</tr></thead>
            <tbody>
              <tr><td style={{ ...tdLbl, height: 28, ...bb }}>Tipo</td>{series.map((s, i) => <td key={i} style={{ ...tdV, height: 28, ...bb }}><SeloTipo inc={s.incentivada} /></td>)}</tr>
              <tr><td style={{ ...tdLbl, height: 34, ...bb }}>Remuneração</td>{series.map((s, i) => <td key={i} style={{ ...tdV, height: 34, ...bb }}><CelRemun s={s} /></td>)}</tr>
              <tr><td style={{ ...tdLbl, height: 28 }}>Vencimento</td>{series.map((s, i) => <td key={i} style={{ ...tdV, height: 28, fontSize: 12, fontWeight: 500 }}>{tenorAmort(s)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '8px 10px', color: SRE_C.TAUPE, fontStyle: 'italic', fontSize: 11 }}>Detalhamento das séries ainda não disponível no SRE (oferta recém-protocolada).</div>
      )}
    </div>
  )
}

// Seção completa (heading + cards) — usada no modal do Dia e no Semanal v2.
function SecaoSRE({ sre }) {
  if (!sre) return null
  const itens = sre.itens || []
  return (
    <div className="rd-cvm">
      <h4>Novas ofertas de debêntures na CVM (SRE){sre.janelaDias && <span className="rd-cap-dia"> · últimos {sre.janelaDias} dias</span>}</h4>
      {itens.length ? itens.map((o, i) => <CardSRE key={o.idRequerimento || i} o={o} />) : <Empty>Nenhuma nova oferta de debênture na CVM na janela.</Empty>}
    </div>
  )
}
// Novas ofertas de debêntures no SRE (TEMPO REAL): card por oferta (séries em colunas).
function OfertasSRE({ sre }) { return <SecaoSRE sre={sre} /> }

// ─────────────────────────────────────────────────────────────────────────────
// Resumo SEMANAL v2 — 3 partes espelhando as abas (Debêntures/Secundário/Técnico).
// Só é usado quando report.formato === 'v2' (Semanal). Dia e Mês seguem intactos.
const _brl = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}R$ ${(a / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`; if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`; if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`; return `${s}R$ ${a.toLocaleString('pt-BR')}` }
const _bps = v => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)} bps`
const _pct = v => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const _curtoInst = shortInstituicao   // marca da instituição (BTG Pactual, XP, Itaú BBA…)
const SemSintese = ({ arr }) => arr?.length ? <ul className="rd-sintese">{arr.map((s, i) => <li key={i}>{s}</li>)}</ul> : null

// KPIs derivados do próprio SRE (consistentes com os cards).
function KpisSre({ itens }) {
  const n = itens.length
  const nS = itens.reduce((s, o) => s + (o.series?.length || o.numSeries || 0), 0)
  const vol = itens.reduce((s, o) => s + (o.valorTotal || 0), 0)
  const inc = itens.reduce((s, o) => s + (o.series || []).filter(x => x.incentivada).length, 0)
  return (
    <div className="rd-kpis">
      <div><b>{n}</b><span>ofertas no SRE</span></div>
      <div><b>{nS}</b><span>séries</span></div>
      <div><b>{_brl(vol)}</b><span>volume total</span></div>
      <div><b>{inc}</b><span>séries 12.431</span></div>
    </div>
  )
}
// Debêntures (Semanal) = MESMA seção SRE do diário (todas as debêntures do SRE),
// só no relatório da semana corrente (como o asOf do diário).
function SemDeb({ d }) {
  const sre = d.ofertasSRE
  if (!sre) return <Section title="1. Debêntures"><Empty>As novas ofertas no SRE (tempo real, últimos 15 dias) constam apenas no relatório da semana corrente.</Empty></Section>
  const itens = sre.itens || []
  return (
    <Section title="1. Debêntures">
      {itens.length > 0 && <KpisSre itens={itens} />}
      <SecaoSRE sre={sre} />
    </Section>
  )
}

function SemSec({ s }) {
  const rz = s.trades.resumo
  return (
    <Section title="2. Secundário">
      <SemSintese arr={s.sintese} />
      <h4 className="rd-h4">Tendência de spread</h4>
      <div className="rd-cards2">
        {['12431', 'trad'].map(seg => {
          const t = s.tendencia.porSegmento[seg]; const nome = seg === '12431' ? '12.431' : 'Tradicional'; if (!t) return null
          return (<div key={seg} className="rd-card">{t.classificacao === 'dados insuficientes' ? (<><b>{nome}: <span className="rd-cls insuf">dados insuficientes</span></b><p className="rd-oferta-meta">{t.motivoInsuf}</p></>) : (<>
            <b>{nome}: <span className="rd-cls">{t.classificacao}</span>{t.amostraPequena && <span className="rd-tag warn">amostra pequena</span>}</b>
            <p className="rd-oferta-meta">mediana {_bps(t.medianaBps)} · aparada {_bps(t.mediaAparadaBps)} · {t.n} comparáveis · abriram {t.abriu} ({t.pctAbriu}%) · fecharam {t.fechou} ({t.pctFechou}%){t.vsAnbima ? ` · vs ANBIMA: ${t.vsAnbima.acima} acima / ${t.vsAnbima.abaixo} abaixo` : ''}</p>
            {t.maioresAberturas.length > 0 && <div className="rd-mini"><b>Maiores aberturas:</b> {t.maioresAberturas.map(m => `${m.ticker} ${_bps(m.variacaoBps)}`).join(', ')}</div>}
            {t.maioresFechamentos.length > 0 && <div className="rd-mini"><b>Maiores fechamentos:</b> {t.maioresFechamentos.map(m => `${m.ticker} ${_bps(m.variacaoBps)}`).join(', ')}</div>}
          </>)}</div>)
        })}
      </div>
      <h4 className="rd-h4">Resumo semanal</h4>
      <div className="rd-kpis">
        <div><b>{_brl(rz.volume)}</b><span>volume · {rz.nTrades} negócios</span></div>
        <div><b>{_brl(rz.volume12431)}</b><span>12.431</span></div>
        <div><b>{_brl(rz.volumeTradicional)}</b><span>Tradicional</span></div>
        <div><b>{_pct(rz.variacaoVolPct)}</b><span>vs semana anterior</span></div>
        <div><b>{_pct(rz.variacaoVs4Pct)}</b><span>vs média 4 semanas</span></div>
      </div>
      <h4 className="rd-h4">Negócios em destaque (≥ R$ 20 mi, por grupo)</h4>
      {s.trades.grupos.length ? (<div className="rd-tablewrap"><table className="rd-table"><thead><tr><th>Grupo</th><th className="rd-num">Volume</th><th className="rd-num">Neg.</th><th>Ativos</th><th className="rd-num">Maior</th><th>Spread</th></tr></thead><tbody>
        {s.trades.grupos.map((g, i) => (<tr key={i}><td>{g.grupo} {g.enquadramento === '12.431' ? <span className="rd-tag">12.431</span> : <span className="rd-tag t2">{g.enquadramento === 'misto' ? 'misto' : 'Trad'}</span>}</td><td className="rd-num">{_brl(g.volumeTotal)}</td><td className="rd-num">{g.nTrades}</td><td className="rd-det">{g.ativos.join(', ')}</td><td className="rd-num">{g.maiorTrade ? _brl(g.maiorTrade.volume) : '—'}</td><td>{g.maiorTrade ? g.maiorTrade.spreadFmt : '—'}</td></tr>))}
      </tbody></table></div>) : <Empty>Nenhum negócio ≥ R$ 20 mi na semana.</Empty>}
    </Section>
  )
}

function SemTec({ t }) {
  const bloco = k => {
    const x = t[k]; if (!x) return null; const nome = k === '12431' ? '12.431' : 'Tradicional'
    const row = (lbl, i) => (<tr key={lbl}><td>{lbl}</td><td className="rd-num">{_brl(i.valor)}</td><td className="rd-num">{i.anterior == null ? '—' : _brl(i.anterior)}</td><td className="rd-num">{_brl(i.variacaoNominal)}</td><td className="rd-num">{_pct(i.variacaoPct)}</td><td className="rd-num">{i.media4Semanas == null ? '—' : _brl(i.media4Semanas)}</td></tr>)
    return (<div key={k} className="rd-card"><b>{nome}{x.captacaoBruta.diasUteis ? <span className="rd-oferta-meta"> ({x.captacaoBruta.diasUteis} d.u. · até {fmtDia(x.captacaoBruta.dataFonte)})</span> : ''}</b>
      <table className="rd-table"><thead><tr><th>Indicador</th><th className="rd-num">Semana</th><th className="rd-num">Anterior</th><th className="rd-num">Δ</th><th className="rd-num">Δ%</th><th className="rd-num">Média 4s</th></tr></thead><tbody>
        {row('Captação bruta', x.captacaoBruta)}{row('Resgates', x.resgates)}{row('Captação líquida', x.captacaoLiquida)}{row('Emissão CVM', x.volumeEmitidoCVM)}</tbody></table>
      <div className="rd-mini"><b>Maiores líquidas:</b> {x.destaques.maioresLiquidas.map(d => `${d.gestor} ${_brl(d.valor)}`).join(', ') || '—'}</div>
      <div className="rd-mini"><b>Piores líquidas:</b> {x.destaques.pioresLiquidas.map(d => `${d.gestor} ${_brl(d.valor)}`).join(', ') || '—'}</div></div>)
  }
  const ve = t.volumeEmitidoDestaques
  return (<Section title="3. Técnico"><SemSintese arr={t.sintese} /><div className="rd-cards2">{bloco('12431')}{bloco('trad')}</div>
    <h4 className="rd-h4">Volume emitido — destaques</h4>
    <div className="rd-mini"><b>Por grupo:</b> {ve.porGrupo.map(g => `${g.nome} ${_brl(g.volume)}`).join(', ') || '—'}</div>
    <div className="rd-mini"><b>Por emissor:</b> {ve.porEmissor.map(g => `${g.nome} ${_brl(g.volume)}`).join(', ') || '—'}</div></Section>)
}

function SemanalV2({ rep }) {
  return (<>
    {rep.alertas?.length > 0 && <div className="rd-alerta">{rep.alertas.map((a, i) => <div key={i}>{a.texto}</div>)}</div>}
    <SemDeb d={rep.partes.debentures} />
    <SemSec s={rep.partes.secundario} />
    <SemTec t={rep.partes.tecnico} />
  </>)
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

function Captacao({ sec, periodo }) {
  const seg = (c, nome) => {
    if (!c || (periodo && !c.diasUteis)) return <div className="rd-cap-seg"><h4>{nome}</h4><Empty>Sem dado de captação no período.</Empty></div>
    const pos = c.liquido >= 0
    const sub = periodo ? `${fmtDia(c.de)}–${fmtDia(c.ate)} · ${c.diasUteis} d.u.` : `· ${fmtDia(c.dia)}`
    return (
      <div className="rd-cap-seg">
        <h4>{nome} <span className="rd-cap-dia">{sub}</span></h4>
        <div className="rd-kv"><span>Captação</span><b>{money(c.captacao)}</b></div>
        <div className="rd-kv"><span>Resgate</span><b>{money(c.resgate)}</b></div>
        <div className="rd-kv"><span>Cap. líquida</span><b className={pos ? 'rd-pos' : 'rd-neg'}>{money(c.liquido)}</b></div>
        <div className="rd-kv"><span>PL{periodo && c.dataPl ? <span className="rd-cap-dia"> · {fmtDia(c.dataPl)}</span> : ''}</span><b>{money(c.pl)}</b></div>
        {!periodo && (
          <div className="rd-kv" title="Fundos da sua lista curada que reportaram no Informe Diário deste dia (a lista é constante)">
            <span>Fundos reportados</span>
            <b>{c.numFundos}{c.curados ? <span className="rd-cap-dia"> de {c.curados}</span> : ''}</b>
          </div>
        )}
        {!periodo && c.fechados ? (
          <div className="rd-kv" title="Fundos de condomínio fechado na sua lista: captam por emissão de cotas (fluxo esporádico), não por aportes diários">
            <span>Fundos fechados</span>
            <b>{c.fechados} <span className="rd-cap-dia">condomínio fechado</span></b>
          </div>
        ) : null}
        {c.anterior && <div className="rd-kv rd-muted"><span>Líquido {periodo ? (periodo === 'weekly' ? 'sem. anterior' : 'mês anterior') : fmtDia(c.anterior.dia)}</span><b>{money(c.anterior.liquido)}</b></div>}
      </div>
    )
  }
  return (
    <div className="rd-cap">
      {seg(sec?.['12431'], '12.431')}
      {seg(sec?.trad, 'Tradicional')}
    </div>
  )
}

// Direção agregada de mercado (IDA) — só nos relatórios de período (complementa
// a ANBIMA por ativo, especialmente no mês em cold-start de snapshots).
function Ida({ sec }) {
  if (!sec) return null
  const seg = (x, nome) => {
    if (!x) return null
    const sp = x.variacaoBps == null ? null : (x.variacaoBps >= 0 ? 'abriu' : 'fechou')
    return (
      <div className="rd-kv">
        <span className="rd-empresa">{nome} · {x.indice}</span>
        <b>{x.retornoPct >= 0 ? '+' : ''}{x.retornoPct?.toFixed(2)}%{sp ? ` · spread ${sp} ${Math.abs(x.variacaoBps)} bps${x.spreadConfiavel ? '' : ' (aprox.)'}` : ''}</b>
      </div>
    )
  }
  return (
    <div className="rd-ida">
      <p className="rd-note">Índice de Debêntures ANBIMA (IDA) — direção agregada de mercado no período.</p>
      {seg(sec['12431'], '12.431')}
      {seg(sec.trad, 'Tradicional')}
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
      {seg(gestores?.top12431Captacao, gestores?.top12431Resgate, '12.431')}
      {seg(gestores?.topTradCaptacao, gestores?.topTradResgate, 'Tradicional')}
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
          {g.variacaoMedianaBps != null && <> · mediana <b>{g.variacaoMedianaBps > 0 ? '+' : ''}{g.variacaoMedianaBps} bps</b></>}
        </p>
        {tabela(g.aberturas, 'Maiores aberturas')}
        {tabela(g.fechamentos, 'Maiores fechamentos')}
      </div>
    )
  }
  const pm = sec?.porMercado
  if (!pm) return <Empty>Sem variações de spread neste dia.</Empty>
  return <>{mercado(pm['12431'], '12.431')}{mercado(pm.trad, 'Tradicional')}</>
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
  return <><p className="rd-note">Retorno nominal da cota no dia (não é %CDI).</p>{bloco(sec?.top12431Pos, sec?.top12431Neg, '12.431')}{bloco(sec?.topTradPos, sec?.topTradNeg, 'Tradicional')}</>
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

const MODOS = [{ id: 'daily', label: 'Dia' }, { id: 'weekly', label: 'Semana' }, { id: 'monthly', label: 'Mês' }]
const TITULO = { daily: 'Resumo do Dia', weekly: 'Resumo da Semana', monthly: 'Resumo do Mês' }
const SUBTITULO = {
  daily: 'Variações por data dos dados vs. dia anterior disponível',
  weekly: 'Agregado da semana (ISO) — captação, spreads e performance no período',
  monthly: 'Agregado do mês — captação, spreads e performance no período',
}
const entryId = e => e.id || e.date

export default function ResumoDoDiaModal({ mode, setMode, index, available, selectedId, report, loading, select, onClose }) {
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const reports = index?.reports || []
  const s = report?.sections
  const inc = s?.inclusoes
  const periodo = mode === 'daily' ? null : mode

  const baixar = ext => {
    if (!report) return
    const id = entryId(report)
    downloadFile(`/reports/${mode}/${id}.${ext}`, downloadName(mode, id, ext)).catch(() => {})
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Central de relatórios">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{TITULO[mode]}{report?.status && (
              <span className={`rd-status ${report.status === 'partial' ? 'partial' : 'closed'}`}>{report.status === 'partial' ? 'Parcial' : 'Fechado'}</span>
            )}</h2>
            <p className="modal-subtitle">{SUBTITULO[mode]}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {/* Segmentado Dia / Semana / Mês (cada modo mantém sua seleção) */}
        <div className="rd-modes segmented" role="tablist" aria-label="Tipo de relatório">
          {MODOS.map(m => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} disabled={!available?.[m.id]}
              className={`segmented-btn${mode === m.id ? ' active' : ''}`}
              onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>

        <div className="rd-toolbar">
          <div className="rd-dates" role="tablist" aria-label="Períodos disponíveis">
            {reports.map(r => {
              const id = entryId(r)
              return (
                <button key={id} className={`rd-date-chip${id === selectedId ? ' active' : ''}`} onClick={() => select(id)}>{r.label}</button>
              )
            })}
          </div>
          <div className="rd-download">
            <button className="rd-dl-btn" onClick={() => baixar('html')} disabled={!report}>Baixar HTML</button>
            <button className="rd-dl-btn" onClick={() => baixar('json')} disabled={!report}>JSON</button>
          </div>
        </div>

        <div className="modal-body">
          {loading && <p className="rd-empty">Carregando…</p>}
          {!loading && !report && <p className="rd-empty">{reports.length ? 'Selecione um período.' : 'Sem relatórios neste modo ainda.'}</p>}
          {!loading && report && report.formato === 'v2' && <SemanalV2 rep={report} />}
          {!loading && report && !report.formato && s && (
            <>
              <Section title="1. Sumário executivo"><Bullets items={report.summary} /></Section>
              <Section title="2. Novas debêntures e emissões">
                <Debentures sec={s.debentures} cvm={s.emissoesCVM} faltantes={s.emissoresFaltantes} sre={s.ofertasSRE} periodo={periodo} />
                {!periodo && inc?.temSnapshotBlc && inc.novosBlc?.length > 0 && (
                  <p className="rd-note">Novos ativos no BLC/alocação: {inc.novosBlc.length}</p>
                )}
              </Section>
              <Section title={periodo ? '3. Captação do período' : '3. Captação líquida do dia'}><Captacao sec={s.captacao} periodo={periodo} /></Section>
              <Section title="4. Destaques por gestor (captação líquida)"><GestoresLado gestores={s.gestores} /></Section>
              <Section title="5. Variação ANBIMA (spread)"><Anbima sec={s.anbima} />{periodo && <Ida sec={s.ida} />}</Section>
              <Section title="6. Fundos incluídos/excluídos"><Fundos sec={s.fundos} /></Section>
              {periodo && (
                <Section title="7. Ativos incluídos nas tabelas">
                  {inc?.semAnterior ? <Empty>Sem snapshot de fronteira BLC neste período.</Empty>
                    : <p className="rd-note">Novos no cadastro: <b>{(inc?.novosDebentures || []).length}</b> · Passaram a aparecer nas carteiras: <b>{(inc?.novosBlc || []).length}</b> · Saíram: <b>{(inc?.saiuBlc || []).length}</b></p>}
                </Section>
              )}
              <Section title={periodo ? '8. Performance de fundos (composto)' : '7. Performance de fundos'}><Perf sec={s.perf} /></Section>
              <Section title={periodo ? '9. Alertas de qualidade' : '8. Alertas de qualidade'}><Alertas arr={s.alertas} /></Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

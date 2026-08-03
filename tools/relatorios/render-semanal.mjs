// HTML self-contained do Resumo Semanal v2 (3 partes: Debêntures/Secundário/Técnico).
// Mesma identidade visual dos demais relatórios (paleta Luc). Sem assets externos.
import { fmtBRL, round } from './semanal.mjs'
import { shortInstituicao } from '../../src/utils/format.js'

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const bps = v => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(round(v, 1))} bps`
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—') }
const money = v => fmtBRL(v)
// vermelho só p/ valor factualmente negativo (§8 da FORMATACAO); positivo fica carvão.
const negWrap = (s, v) => (typeof v === 'number' && v < 0) ? `<span class="neg">${s}</span>` : s
const moneyN = v => negWrap(money(v), v)
const pctN = v => v == null ? '—' : negWrap(pct(v), v)
// Remuneração máxima (teto do bookbuilding). Destaque no compacto + texto integral no title.
const tetoStr = o => {
  if (!o.teto && !o.remuneracaoMaxima) return ''
  const c = o.teto?.compacto ? `<b>${esc(o.teto.compacto)}</b>${o.teto.floorPct ? ` (piso ${esc(o.teto.floorPct)})` : ''}` : esc((o.remuneracaoMaxima || '').replace(/\s+/g, ' ').slice(0, 140))
  const tit = o.remuneracaoMaxima ? ` title="${esc(o.remuneracaoMaxima.replace(/\s+/g, ' '))}"` : ''
  return `<p class="meta teto"${tit}>Remuneração máx.: ${c}</p>`
}
// "Coordenadores: BTG Pactual (líder), XP" (SRE); fallback = líder do cadastro
const coordStr = o => {
  if (o.coordenadores?.length) return o.coordenadores.map(c => `${esc(shortInstituicao(c.razaoSocial))}${c.lider ? ' <b>(líder)</b>' : ''}`).join(', ')
  if (o.coordenador) return `${esc(shortInstituicao(o.coordenador))} <b>(líder)</b>`
  return null
}

function tabela(cols, linhas) {
  if (!linhas.length) return `<p class="vazio">Sem dados.</p>`
  const th = cols.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.h)}</th>`).join('')
  const tr = linhas.map(l => `<tr>${cols.map(c => `<td${c.num ? ' class="num"' : ''}>${l[c.k] == null ? '—' : l[c.k]}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
}
const sintese = arr => arr && arr.length ? `<ul class="sintese">${arr.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''

function parteDebentures(d) {
  const r = d.resumo
  const kpis = `<div class="kpis">
    <div><b>${r.nOfertas}</b><span>ofertas (${r.nSeries} séries)</span></div>
    <div><b>${r.nEmissores}</b><span>emissores · ${r.nGrupos} grupos</span></div>
    <div><b>${money(r.volumeTotal)}</b><span>volume total${r.volumeConfiavel ? '' : ' (parcial)'}</span></div>
    <div><b>${money(r.volume12431)}</b><span>12.431</span></div>
    <div><b>${money(r.volumeTradicional)}</b><span>Tradicional</span></div>
  </div>`
  const ofertas = d.ofertas.map(o => {
    const linhasSerie = o.series.map(s => {
      const campos = [
        s.indexador && `${esc(s.indexador)}`, s.taxaEmissao && `taxa ${esc(s.taxaEmissao)}`,
        s.vencimento && `venc ${fmtD(s.vencimento)}`, s.durationAnos != null && `dur ${s.durationAnos}a`,
        s.garantia && `gar. ${esc(s.garantia)}`, s.amortizacao && `amort. ${esc(s.amortizacao)}`,
        s.recompra && s.recompra.breakeven && `BE ${esc(s.recompra.breakeven)}`,
        s.resgateAntecipado && `resg.antec.`,
      ].filter(Boolean).join(' · ')
      return `<tr><td>${esc(s.ticker)}${s.serie ? ` <span class="sub">${esc(s.serie)}</span>` : ''}</td><td class="num">${s.volumeSerie ? money(s.volumeSerie) : '—'}</td><td>${campos || '—'}</td></tr>`
    }).join('')
    const cs = coordStr(o)
    return `<div class="oferta"><h4>${esc(o.emissor)} ${o.incentivada ? '<span class="tag">12.431</span>' : '<span class="tag tag2">Trad</span>'}${o.volumeParcial ? ' <span class="tag tag-warn">volume parcial</span>' : ''}</h4>
      <p class="meta">${esc(o.grupo || '—')}${o.setor ? ` · ${esc(o.setor)}` : ''} · reg. CVM ${fmtD(o.dataRegistro)} · ${money(o.volumeOferta)}${o.rating ? ` · rating ${esc(o.rating)}` : ''}</p>
      ${tetoStr(o)}
      ${cs ? `<p class="meta">Coordenadores: ${cs}</p>` : ''}
      <table class="series"><thead><tr><th>Série</th><th class="num">Volume</th><th>Detalhes</th></tr></thead><tbody>${linhasSerie}</tbody></table></div>`
  }).join('')
  const inc = d.inconsistencias.length ? `<div class="alerta">⚠ ${d.inconsistencias.map(i => `${esc(i.emissor)}: ${esc(i.motivo)}`).join(' · ')}</div>` : ''
  return `<section><h2>1. Debêntures</h2>${sintese(d.sintese)}${kpis}${inc}<h3>Novas emissões</h3>${d.ofertas.length ? ofertas : '<p class="vazio">Nenhuma nova debênture registrada na CVM na semana.</p>'}</section>`
}

function parteSecundario(s) {
  const tend = ['12431', 'trad'].map(seg => {
    const t = s.tendencia.porSegmento[seg]; const nome = seg === '12431' ? '12.431' : 'Tradicional'
    if (!t) return ''
    if (t.classificacao === 'dados insuficientes') return `<div class="card"><h4>${nome}: <span class="cls insuf">dados insuficientes</span></h4><p class="meta">${esc(t.motivoInsuf || '')}</p></div>`
    const va = t.vsAnbima
    return `<div class="card"><h4>${nome}: <span class="cls">${esc(t.classificacao)}</span>${t.amostraPequena ? ' <span class="tag tag-warn">amostra pequena</span>' : ''}</h4>
      <p class="meta">mediana ${bps(t.medianaBps)} · aparada ${bps(t.mediaAparadaBps)} · ${t.n} comparáveis · abriram ${t.abriu} (${t.pctAbriu}%) · fecharam ${t.fechou} (${t.pctFechou}%) · estáveis ${t.estavel} (${t.pctEstavel}%)${va ? ` · vs ANBIMA: ${va.acima} acima / ${va.abaixo} abaixo` : ''}</p>
      ${t.maioresAberturas.length ? `<div class="mini"><b>Maiores aberturas:</b> ${t.maioresAberturas.map(m => `${esc(m.ticker)} ${bps(m.variacaoBps)}`).join(', ')}</div>` : ''}
      ${t.maioresFechamentos.length ? `<div class="mini"><b>Maiores fechamentos:</b> ${t.maioresFechamentos.map(m => `${esc(m.ticker)} ${bps(m.variacaoBps)}`).join(', ')}</div>` : ''}</div>`
  }).join('')
  const rz = s.trades.resumo
  const resumo = `<div class="kpis">
    <div><b>${money(rz.volume)}</b><span>volume negociado · ${rz.nTrades} negócios</span></div>
    <div><b>${money(rz.volume12431)}</b><span>12.431</span></div>
    <div><b>${money(rz.volumeTradicional)}</b><span>Tradicional</span></div>
    <div><b>${pctN(rz.variacaoVolPct)}</b><span>vs semana anterior</span></div>
    <div><b>${pctN(rz.variacaoVs4Pct)}</b><span>vs média 4 semanas</span></div>
  </div>`
  const grupos = s.trades.grupos.map(g => `<tr><td>${esc(g.grupo)} ${g.enquadramento === '12.431' ? '<span class="tag">12.431</span>' : g.enquadramento === 'Tradicional' ? '<span class="tag tag2">Trad</span>' : '<span class="tag tag2">misto</span>'}</td><td class="num">${money(g.volumeTotal)}</td><td class="num">${g.nTrades}</td><td>${esc(g.ativos.join(', '))}</td><td class="num">${g.maiorTrade ? money(g.maiorTrade.volume) : '—'}</td><td>${g.maiorTrade ? esc(g.maiorTrade.spreadFmt) : '—'}</td></tr>`).join('')
  return `<section><h2>2. Secundário</h2>${sintese(s.sintese)}
    <h3>Tendência de spread</h3><div class="cards">${tend}</div>
    <h3>Resumo semanal</h3>${resumo}
    <h3>Negócios em destaque (≥ R$ 20 mi, por grupo)</h3>${s.trades.grupos.length ? `<table><thead><tr><th>Grupo</th><th class="num">Volume</th><th class="num">Negócios</th><th>Ativos</th><th class="num">Maior</th><th>Spread</th></tr></thead><tbody>${grupos}</tbody></table>` : '<p class="vazio">Nenhum negócio ≥ R$ 20 mi na semana.</p>'}</section>`
}

function parteTecnico(t) {
  const linhasSeg = seg => {
    const x = t[seg]; if (!x) return ''
    const nome = seg === '12431' ? '12.431' : 'Tradicional'
    const ind = (lbl, i) => `<tr><td>${lbl}</td><td class="num">${moneyN(i.valor)}</td><td class="num">${i.anterior == null ? '—' : moneyN(i.anterior)}</td><td class="num">${moneyN(i.variacaoNominal)}</td><td class="num">${pctN(i.variacaoPct)}</td><td class="num">${i.media4Semanas == null ? '—' : moneyN(i.media4Semanas)}</td></tr>`
    return `<div class="card"><h4>${nome}${x.captacaoBruta.diasUteis ? ` <span class="meta">(${x.captacaoBruta.diasUteis} d.u. · até ${fmtD(x.captacaoBruta.dataFonte)})</span>` : ''}</h4>
      <table><thead><tr><th>Indicador</th><th class="num">Semana</th><th class="num">Anterior</th><th class="num">Δ</th><th class="num">Δ%</th><th class="num">Média 4s</th></tr></thead><tbody>
      ${ind('Captação bruta', x.captacaoBruta)}${ind('Resgates', x.resgates)}${ind('Captação líquida', x.captacaoLiquida)}${ind('Emissão CVM', x.volumeEmitidoCVM)}</tbody></table>
      <div class="mini"><b>Maiores líquidas:</b> ${x.destaques.maioresLiquidas.map(d => `${esc(d.gestor)} ${money(d.valor)}`).join(', ') || '—'}</div>
      <div class="mini"><b>Piores líquidas:</b> ${x.destaques.pioresLiquidas.map(d => `${esc(d.gestor)} ${moneyN(d.valor)}`).join(', ') || '—'}</div></div>`
  }
  const ve = t.volumeEmitidoDestaques
  return `<section><h2>3. Técnico</h2>${sintese(t.sintese)}
    <div class="cards">${linhasSeg('12431')}${linhasSeg('trad')}</div>
    <h3>Volume emitido — destaques</h3>
    <div class="mini"><b>Por grupo:</b> ${ve.porGrupo.map(g => `${esc(g.nome)} ${money(g.volume)}`).join(', ') || '—'}</div>
    <div class="mini"><b>Por emissor:</b> ${ve.porEmissor.map(g => `${esc(g.nome)} ${money(g.volume)}`).join(', ') || '—'}</div>
    <div class="mini">12.431 ${money(ve.volume12431)} · Tradicional ${money(ve.volumeTradicional)}</div></section>`
}

export function renderSemanalHtml(rep) {
  const alertas = (rep.alertas || []).length ? `<div class="alerta">${rep.alertas.map(a => esc(a.texto)).join('<br>')}</div>` : ''
  const fontes = Object.entries(rep.sourceDates || {}).map(([k, v]) => `${k}: ${fmtD(v)}`).join(' · ')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(rep.label)} — Luc</title><style>
/* Formatação v2 — ver FORMATACAO_Resumo_Semanal.md. Cantos RETOS nos contêineres
   de dado (exceção: chips e .alerta = arredondados); réguas de tabela em --linha;
   5 tamanhos de fonte (20/16/14/12,5/11); cor semântica disciplinada (classificação
   sempre terracota; vermelho só p/ valor factualmente negativo). */
:root{--bg:#f2ede5;--card:#fff;--terra:#8c5e3a;--carvao:#26211d;--bege:#e8dfd2;--linha:#d5c7b0;--pos:#047857;--neg:#b91c1c;--muted:#7a6f63}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--carvao);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.wrap{max-width:900px;margin:0 auto}h1{font-size:20px;margin:0 0 2px}
section{background:var(--card);border:1px solid var(--bege);border-radius:0;padding:16px;margin-bottom:14px}
h2{font-size:16px;color:var(--terra);margin:0 0 8px;border-bottom:2px solid var(--linha);padding-bottom:6px}
h3{font-size:14px;font-weight:600;margin:16px 0 6px;color:var(--carvao)}h4{font-size:14px;font-weight:600;margin:0 0 4px}
.sintese{margin:0 0 10px;padding-left:18px}.sintese li{margin:2px 0}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}.kpis>div{background:var(--bege);border-radius:0;padding:8px 10px;min-width:120px}
.kpis b{display:block;font-size:14px;font-weight:600}.kpis span{font-size:11px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--linha)}
th{background:var(--bege);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}
.neg{color:var(--neg)}.pos{color:var(--pos)}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.card{background:var(--bg);border:1px solid var(--bege);border-radius:0;padding:10px}
.oferta{border:1px solid var(--bege);border-radius:0;padding:10px;margin:8px 0}.oferta .meta{color:var(--muted);font-size:11px;margin:0 0 6px}
.series th,.series td{font-size:12.5px}.sub{color:var(--muted);font-size:11px}.meta{color:var(--muted);font-size:11px}
.meta.teto{color:var(--carvao)}.meta.teto b{color:var(--terra)}
.tag{background:var(--terra);color:#fff;border-radius:999px;padding:1px 7px;font-size:11px}.tag2{background:var(--muted)}.tag-warn{background:var(--neg)}
.cls{color:var(--terra);font-weight:700}.cls.insuf{color:var(--muted)}
.mini{font-size:11px;margin:4px 0;color:var(--carvao)}.mini b{color:var(--muted);font-weight:600}
.alerta{background:#fdf3e7;border:1px solid var(--terra);border-radius:8px;padding:8px 10px;font-size:11px;margin:8px 0}
.vazio{color:var(--muted);font-size:11px}.fontes{color:var(--muted);font-size:11px;margin-top:10px}
@media(max-width:640px){.cards{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>${esc(rep.label)}</h1><p class="sub">${esc(rep.status === 'partial' ? 'Parcial' : 'Fechado')} · ${fmtD(rep.de)}–${fmtD(rep.ate)}</p>
${alertas}
${parteDebentures(rep.partes.debentures)}
${parteSecundario(rep.partes.secundario)}
${parteTecnico(rep.partes.tecnico)}
<p class="fontes">Fontes: ${esc(fontes)}</p>
</div></body></html>`
}

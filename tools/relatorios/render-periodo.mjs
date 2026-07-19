// Render HTML self-contained do Resumo da Semana/Mes. Identidade visual alinhada
// ao Resumo do Dia (cartao claro, acento terracota). Sem assets externos.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const money = v => { const a = Math.abs(v || 0), s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}R$ ${(a / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`; if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mi`; if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`; return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` }
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const bps = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v} bps`
const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—') }

function capBlock(cap) {
  const one = (seg, nome) => {
    const c = cap[seg]; if (!c || !c.diasUteis) return `<div class="card"><h3>${nome}</h3><p class="muted">Sem dados no período.</p></div>`
    const cmp = c.anterior ? `<p class="muted">Anterior: líquido ${money(c.anterior.liquido)}</p>` : ''
    return `<div class="card"><h3>${nome}</h3>
      <p class="big ${c.liquido >= 0 ? 'pos' : 'neg'}">${money(c.liquido)} <span class="lbl">líquido</span></p>
      <p>Captação ${money(c.captacao)} · Resgate ${money(c.resgate)}</p>
      <p class="muted">PL ${money(c.pl)} (em ${fmtD(c.dataPl)}) · ${c.de ? fmtD(c.de) : '—'}–${c.ate ? fmtD(c.ate) : '—'} · ${c.diasUteis} d.u.</p>${cmp}</div>`
  }
  return `<div class="grid2">${one('12431', '12.431')}${one('trad', 'Tradicional')}</div>`
}
function gestList(rows, titulo) {
  if (!rows || !rows.length) return `<div class="col"><h4>${titulo}</h4><p class="muted">—</p></div>`
  return `<div class="col"><h4>${titulo}</h4><ul>${rows.map(g => `<li><span>${esc(g.gestor)}</span><b class="${g.liquido >= 0 ? 'pos' : 'neg'}">${money(g.liquido)}</b></li>`).join('')}</ul></div>`
}
function anbimaBlock(anb, ida) {
  let idaHtml = ''
  if (ida) idaHtml = `<div class="ida"><h4>Direção agregada de mercado (IDA)</h4>${['12431', 'trad'].map(seg => { const x = ida[seg]; if (!x) return ''; const nome = seg === '12431' ? '12.431' : 'Tradicional'; return `<p><b>${nome}</b> · ${esc(x.indice)}: retorno ${pct(x.retornoPct)}${x.variacaoBps != null ? ` · spread ${x.variacaoBps >= 0 ? 'abriu' : 'fechou'} ${Math.abs(x.variacaoBps)} bps${x.spreadConfiavel ? '' : ' <span class="muted">(aprox./regime)</span>'}` : ''} <span class="muted">(${fmtD(x.dataIni)}→${fmtD(x.dataFim)})</span></p>` }).join('')}</div>`
  if (anb.semAnterior || !anb.porMercado) return `<p class="muted">Variação por ativo indisponível (sem snapshot de fronteira ANBIMA). Usando direção agregada abaixo.</p>${idaHtml}`
  const seg = (s, nome) => {
    const st = anb.porMercado[s]; if (!st || !st.totalComparados) return `<div class="col"><h4>${nome}</h4><p class="muted">Sem ativos comparáveis.</p></div>`
    const li = m => `<li><span>${esc(m.ticker)} <em>${esc(m.grupo || m.emissor)}</em></span><b class="${m.variacaoBps >= 0 ? 'neg' : 'pos'}">${bps(m.variacaoBps)}</b></li>`
    return `<div class="col"><h4>${nome} <span class="muted">(${st.totalComparados} ativos · média ${bps(st.variacaoMediaBps)} · mediana ${bps(st.variacaoMedianaBps)})</span></h4>
      <p class="mini">Maiores aberturas</p><ul>${st.aberturas.map(li).join('') || '<li class="muted">—</li>'}</ul>
      <p class="mini">Maiores fechamentos</p><ul>${st.fechamentos.map(li).join('') || '<li class="muted">—</li>'}</ul></div>`
  }
  return `<div class="grid2">${seg('12431', '12.431')}${seg('trad', 'Tradicional')}</div>${idaHtml}`
}
function perfBlock(perf) {
  const col = (rows, titulo) => `<div class="col"><h4>${titulo}</h4><ul>${(rows && rows.length) ? rows.map(f => `<li><span>${esc(f.nome)} <em>(${esc(f.gestor)})</em></span><b class="${f.retorno >= 0 ? 'pos' : 'neg'}">${pct(f.retorno)}</b></li>`).join('') : '<li class="muted">—</li>'}</ul></div>`
  return `<div class="grid2">${col(perf.top12431Pos, 'Maiores altas · 12.431')}${col(perf.topTradPos, 'Maiores altas · Trad')}</div>
          <div class="grid2">${col(perf.top12431Neg, 'Maiores quedas · 12.431')}${col(perf.topTradNeg, 'Maiores quedas · Trad')}</div>`
}

export function renderPeriodoHtml(rep) {
  const s = rep.sections
  const titulo = rep.periodo === 'weekly' ? 'Resumo da Semana' : 'Resumo do Mês'
  const bullets = (rep.summary || []).map(b => `<li class="${b.tom || ''}">${esc(b.texto)}</li>`).join('') || '<li class="muted">Sem destaques no período.</li>'
  const novas = s.debentures?.novas || []
  const debHtml = novas.length ? `<table><thead><tr><th>Ticker</th><th>Emissor</th><th>Grupo</th><th>Registro</th></tr></thead><tbody>${novas.map(d => `<tr><td>${esc(d.ticker)}${d.incentivada ? ' <span class="tag">12.431</span>' : ''}</td><td>${esc(d.empresa)}</td><td>${esc(d.grupo)}</td><td>${fmtD(d.dataRegistro)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma nova debênture registrada no período.</p>'
  const fundos = s.fundos || {}
  const fundosHtml = fundos.semAnterior ? '<p class="muted">Sem snapshot de fronteira — inclusões/exclusões indisponíveis.</p>'
    : `<div class="grid2"><div class="col"><h4>Incluídos (${(fundos.novos || []).length})</h4><ul>${(fundos.novos || []).slice(0, 15).map(f => `<li><span>${esc(f.nome)}</span></li>`).join('') || '<li class="muted">—</li>'}</ul></div><div class="col"><h4>Excluídos (${(fundos.removidos || []).length})</h4><ul>${(fundos.removidos || []).slice(0, 15).map(f => `<li><span>${esc(f.nome)}</span></li>`).join('') || '<li class="muted">—</li>'}</ul></div></div>`
  const incl = s.inclusoes || {}
  const inclHtml = incl.semAnterior ? '<p class="muted">Sem snapshot de fronteira BLC.</p>' : `<p>Novos no cadastro: <b>${(incl.novosDebentures || []).length}</b> · Passaram a aparecer nas carteiras: <b>${(incl.novosBlc || []).length}</b> · Saíram: <b>${(incl.saiuBlc || []).length}</b></p>`
  const alertas = (s.alertas || []).length ? `<ul>${s.alertas.map(a => `<li>${esc(a.texto)}</li>`).join('')}</ul>` : '<p class="muted">Sem alertas.</p>'
  const gest = s.gestores || {}

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} — ${esc(rep.label)}</title><style>
:root{--bg:#f2ede5;--card:#fff;--ink:#2a2420;--muted:#6b6154;--line:#e8dfd2;--pri:#8c5e3a;--pos:#2f7d5b;--neg:#b4453a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.wrap{max-width:900px;margin:0 auto}h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 16px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#efe6d8;color:var(--pri);margin-left:6px}
.badge.partial{background:#f6ead0;color:#8a6d1f}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 12px}
h2{font-size:15px;margin:0 0 10px;color:var(--pri)}h3{font-size:13px;margin:0 0 6px}h4{font-size:12px;margin:8px 0 4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.big{font-size:20px;font-weight:800;margin:2px 0}.lbl{font-size:12px;font-weight:500;color:var(--muted)}
ul{list-style:none;margin:4px 0;padding:0}li{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-top:1px solid var(--line)}
li em{color:var(--muted);font-style:normal;font-size:11px}.pos{color:var(--pos)}.neg{color:var(--neg)}.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
.tag{font-size:9px;font-weight:700;background:#e7f2ec;color:var(--pos);padding:1px 5px;border-radius:5px}.mini{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin:6px 0 2px}
.ida{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px}.summary li{border:0;padding:2px 0}
</style></head><body><div class="wrap">
<h1>${titulo}<span class="badge ${rep.status === 'partial' ? 'partial' : ''}">${rep.status === 'partial' ? 'Parcial' : 'Fechado'}</span></h1>
<p class="sub">${esc(rep.label)} · ${fmtD(rep.de)}–${fmtD(rep.ate)}</p>
<section><h2>1. Sumário executivo</h2><ul class="summary">${bullets}</ul></section>
<section><h2>2. Novas debêntures</h2>${debHtml}</section>
<section><h2>3. Captação</h2>${capBlock(s.captacao)}</section>
<section><h2>4. Destaques por gestor</h2><div class="grid2">${gestList(gest.top12431Captacao, 'Maiores captações · 12.431')}${gestList(gest.topTradCaptacao, 'Maiores captações · Trad')}</div><div class="grid2">${gestList(gest.top12431Resgate, 'Maiores resgates · 12.431')}${gestList(gest.topTradResgate, 'Maiores resgates · Trad')}</div></section>
<section><h2>5. Variação ANBIMA</h2>${anbimaBlock(s.anbima, s.ida)}</section>
<section><h2>6. Fundos incluídos e excluídos</h2>${fundosHtml}</section>
<section><h2>7. Ativos incluídos nas tabelas</h2>${inclHtml}</section>
<section><h2>8. Performance dos fundos</h2>${perfBlock(s.perf)}</section>
<section><h2>9. Alertas de qualidade</h2>${alertas}</section>
</div></body></html>`
}

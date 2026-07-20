// Logica PURA de agregacao da aba Vencimentos (sem React) — testavel e
// compartilhada pelo VencimentosDashboard.
//
// Modelo dos dados (public/data/Agenda_12m.json, gerado por gerar-agenda-12m.mjs):
//   meses[]   : { mes, label, carteira:{juros,amort,total}, mercado:{...} }
//   porGestor : [{ nome, juros, amort, total }]           (so' carteira, 12m)
//   porGrupo/porEmissor : [{ nome, carteira:{...}, mercado:{...} }]
//   ativos[]  : { ticker, emissor, grupo, incentivada, eventos:[{d,t:'J'|'A',mc,ct,pct}] }
//   porFundo? : [{ cnpj, nome, gestor, segmento, pl, juros, amort, total,
//                  pm:[[mesIndex,juros,amort],...] }]   (ausente ate' rodar o pipeline)
//
// O corte por GESTOR e' feito no cliente cruzando o BLC (agregado por gestor):
// cada evento (valor de carteira `ct`) e' fatiado pela PARTICIPACAO real do
// gestor no ticker. Fundos vem prontos do pipeline (posicao real por CNPJ) —
// nunca rateio proporcional do valor do gestor.
import { parseNum } from './format.js'

export const SEM_GRUPO = '(sem classificacao)'

// Percentual do PL (1 casa), usado nas barras/cards de "% do PL" do MonthBars.
export function pctFmt(x) {
  if (x == null || isNaN(x)) return '—'
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

// Rotulo compacto p/ dentro das barras do MonthBars (sem "R$", com sufixo bi/mi/mil).
export function fmtBar(v) {
  const n = Math.abs(v || 0)
  if (n >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}bi`
  if (n >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mi`
  if (n >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mil`
  return (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

// ticker -> { total, rows:[{ g, v }] } a partir do BLC_tratado (por gestor).
export function buildGestoresPorTicker(blc) {
  const m = new Map()
  for (const r of blc || []) {
    const tk = String(r.CD_ATIVO || '').trim().toUpperCase()
    const v = parseNum(r.VL_ALOCADO)
    if (!tk || v <= 0) continue
    let o = m.get(tk)
    if (!o) { o = { total: 0, rows: [] }; m.set(tk, o) }
    o.total += v
    o.rows.push({ g: String(r.GESTOR || '').trim() || '(sem gestor)', v })
  }
  return m
}

// Eventos individuais achatados (cada um com referencia ao ativo).
export function flattenEventos(data) {
  const out = []
  for (const a of data?.ativos || []) for (const e of a.eventos || []) out.push({ ...e, a })
  return out
}

export function gestorHolds(gpt, ticker, g) {
  const o = gpt.get(ticker)
  return !!o && o.rows.some(r => r.g === g)
}
// Fatia do valor de carteira `ct` que cabe ao gestor g (participacao no ticker).
function fatiaGestor(gpt, ticker, ct, g) {
  const o = gpt.get(ticker)
  if (!o || !o.total || !ct) return 0
  const r = o.rows.find(x => x.g === g)
  return r ? ct * (r.v / o.total) : 0
}
export function matchSegAtivo(a, seg) {
  return seg === 'todos' || (seg === '12431' ? !!a.incentivada : !a.incentivada)
}
export function matchSegFundo(s, seg) {
  return seg === 'todos' || (seg === '12431' ? s === '12431' : s !== '12431')
}

// Valor de um evento na VISAO atual: com gestor, a fatia dele; senao carteira
// usa ct, mercado usa mc.
export function eventoValor(ev, { gestorSel, gpt, persp }) {
  if (gestorSel) return fatiaGestor(gpt, ev.a.ticker, ev.ct, gestorSel)
  return persp === 'mercado' ? ev.mc : ev.ct
}
// Valor de CARTEIRA de um evento (base do %PL): sempre ct (fatiado se gestor).
export function eventoCarteira(ev, { gestorSel, gpt }) {
  return gestorSel ? fatiaGestor(gpt, ev.a.ticker, ev.ct, gestorSel) : ev.ct
}

const zeroMeses = meses => new Map(meses.map(m => [m.mes, { mes: m.mes, label: m.label, juros: 0, amort: 0, total: 0 }]))

// Serie mensal (12 baldes). base: 'view' (perspectiva) ou 'carteira' (base do %PL).
export function aggMeses(data, eventos, gpt, { gestorSel, seg, persp, base = 'view' }) {
  const meses = data?.meses || []
  const persPath = base === 'carteira' ? 'carteira' : persp
  if (!gestorSel && seg === 'todos') {
    return meses.map(m => ({ mes: m.mes, label: m.label, ...m[persPath] }))
  }
  const buckets = zeroMeses(meses)
  for (const ev of eventos) {
    if (!matchSegAtivo(ev.a, seg)) continue
    if (gestorSel && !gestorHolds(gpt, ev.a.ticker, gestorSel)) continue
    const b = buckets.get(ev.d.slice(0, 7))
    if (!b) continue
    const v = base === 'carteira' ? eventoCarteira(ev, { gestorSel, gpt }) : eventoValor(ev, { gestorSel, gpt, persp })
    if (ev.t === 'J') b.juros += v; else b.amort += v
    b.total += v
  }
  return meses.map(m => buckets.get(m.mes))
}

// Total do periodo mostrado: mes selecionado (se houver) ou 12m.
export function totalPeriodo(mesesView, selMes) {
  const src = selMes ? mesesView.filter(m => m.mes === selMes) : mesesView
  return src.reduce((acc, m) => ({
    juros: acc.juros + m.juros, amort: acc.amort + m.amort, total: acc.total + m.total,
  }), { juros: 0, amort: 0, total: 0 })
}

// ─── Tabela principal: GESTORES (sempre todos; NAO filtra pela propria selecao) ──
export function aggGestores(data, eventos, gpt, { seg, selMes }) {
  if (seg === 'todos' && !selMes && data?.porGestor?.length) return data.porGestor
  const m = new Map()
  for (const ev of eventos) {
    if (!matchSegAtivo(ev.a, seg)) continue
    if (selMes && ev.d.slice(0, 7) !== selMes) continue
    if (!ev.ct) continue
    const o = gpt.get(ev.a.ticker)
    if (!o || !o.total) continue
    for (const r of o.rows) {
      const v = ev.ct * (r.v / o.total)
      let x = m.get(r.g)
      if (!x) { x = { nome: r.g, juros: 0, amort: 0 }; m.set(r.g, x) }
      if (ev.t === 'J') x.juros += v; else x.amort += v
    }
  }
  return [...m.values()]
    .map(x => ({ nome: x.nome, juros: x.juros, amort: x.amort, total: x.juros + x.amort }))
    .filter(x => x.total > 0.5)
    .sort((a, b) => b.total - a.total)
}

// ─── Detalhe: GRUPOS ────────────────────────────────────────────────────────
export function aggGrupos(data, eventos, gpt, { gestorSel, seg, selMes, persp }) {
  if (!gestorSel && seg === 'todos' && !selMes && data?.porGrupo?.length) {
    return data.porGrupo.map(o => ({ nome: o.nome, ...(persp === 'mercado' ? o.mercado : o.carteira) }))
      .filter(o => o.total > 0.5)
  }
  const m = new Map()
  for (const ev of eventos) {
    if (!matchSegAtivo(ev.a, seg)) continue
    if (gestorSel && !gestorHolds(gpt, ev.a.ticker, gestorSel)) continue
    if (selMes && ev.d.slice(0, 7) !== selMes) continue
    const v = eventoValor(ev, { gestorSel, gpt, persp })
    if (!v) continue
    const k = ev.a.grupo || SEM_GRUPO
    let x = m.get(k)
    if (!x) { x = { nome: k, juros: 0, amort: 0 }; m.set(k, x) }
    if (ev.t === 'J') x.juros += v; else x.amort += v
  }
  return [...m.values()]
    .map(x => ({ nome: x.nome, juros: x.juros, amort: x.amort, total: x.juros + x.amort }))
    .filter(x => x.total > 0.5)
    .sort((a, b) => b.total - a.total)
}

// ─── Detalhe: ATIVOS (debentures) ───────────────────────────────────────────
export function aggAtivos(data, gpt, { gestorSel, seg, selMes, persp }) {
  const out = []
  for (const a of data?.ativos || []) {
    if (!matchSegAtivo(a, seg)) continue
    if (gestorSel && !gestorHolds(gpt, a.ticker, gestorSel)) continue
    let juros = 0, amort = 0, prox = null
    for (const e of a.eventos || []) {
      if (selMes && e.d.slice(0, 7) !== selMes) continue
      const v = eventoValor({ ...e, a }, { gestorSel, gpt, persp })
      if (e.t === 'J') juros += v; else amort += v
      if (v > 0.5 && (!prox || e.d < prox)) prox = e.d
    }
    const total = juros + amort
    if (total <= 0.5) continue
    out.push({
      ticker: a.ticker, grupo: a.grupo || '—', emissor: a.emissor || '—',
      incentivada: !!a.incentivada, juros, amort, total, proxData: prox,
    })
  }
  return out.sort((x, y) => y.total - x.total)
}

// ─── Detalhe: FUNDOS (posicao REAL por CNPJ; vem do pipeline) ────────────────
// Retorna { disponivel:false } quando nao ha porFundo (nunca fabrica).
// ───────────── Corte de %Deb (filtro global) ─────────────
//
// ATENCAO -- NAO LIGADAS NA UI (jul/2026). Estas funcoes estao corretas e sao
// internamente coerentes (apertar o corte reduz o total, como deve), mas a
// BASE delas nao bate com o aggMeses/aggGestores que a aba usa hoje: no MESMO
// escopo (os 1.686 fundos do 12.431, sem corte nenhum) o porFundo soma
// R$ 33,13 bi e o aggMeses R$ 30,1 bi -- 3 bi de diferenca, ~10%.
//
// Enquanto isso nao for reconciliado, ligar o corte aqui faria o total SUBIR
// ao apertar a regua (30,1 -> 33,1), que le como "menos fundos vencendo mais".
// O seletor de corte fica OCULTO na aba Vencimentos por isso.
//
// P/ reconciliar: entender por que o aggMeses (que fatia por participacao do
// gestor no ticker, via gpt) chega a um carteira menor que a soma direta das
// posicoes por fundo. Suspeita: fundo sem gestor resolvido, ou dupla contagem
// tratada de um lado e nao do outro.
//
// O `carteira` desta aba e' a posicao do universo curado, entao mudar o corte
// muda o numero. So' que os agregados prontos (meses/porGestor/porGrupo) vem
// somados sobre o universo INTEIRO -- p/ cortar e' preciso re-somar a partir do
// porFundo, que e' a unica base com granularidade de CNPJ aqui.
//
// LIMITE do porFundo: ele traz total 12m + quebra por MES (pm), mas NAO por
// ativo. Entao gestores, fundos e as barras mensais sao recomputaveis; grupo e
// ativo NAO -- p/ esses seria preciso posicao (fundo x ativo), que so' existe
// no BLC_PorFundo.csv (11 MB, insumo de build que nao e' deployado).

/** Fundos do porFundo que passam do corte, ja' filtrados por gestor/segmento. */
function fundosNoCorte(data, { gestorSel, seg, cnpjsAceitos }) {
  const pf = data?.porFundo
  if (!Array.isArray(pf)) return null
  return pf.filter(f => {
    if (gestorSel && f.gestor !== gestorSel) return false
    if (!matchSegFundo(f.segmento, seg)) return false
    if (cnpjsAceitos && !cnpjsAceitos.has(String(f.cnpj || '').replace(/\D/g, ''))) return false
    return true
  })
}

/**
 * Barras mensais (juros/amort/total por mes) re-somadas a partir do porFundo,
 * respeitando o corte. Devolve o mesmo shape de `meses[].carteira` p/ ser
 * intercambiavel com o agregado pronto.
 */
export function aggMesesPorFundo(data, { gestorSel, seg, cnpjsAceitos }) {
  const fundos = fundosNoCorte(data, { gestorSel, seg, cnpjsAceitos })
  if (!fundos) return null
  const meses = data?.meses || []
  const out = meses.map(m => ({ mes: m.mes, label: m.label, juros: 0, amort: 0, total: 0 }))
  for (const f of fundos) {
    for (const [i, juros, amort] of (f.pm || [])) {
      const o = out[i]
      if (!o) continue
      o.juros += juros || 0
      o.amort += amort || 0
    }
  }
  for (const o of out) o.total = o.juros + o.amort
  return out
}

/** Ranking de gestores re-somado do porFundo, respeitando o corte. */
export function aggGestoresPorFundo(data, { seg, selMes, cnpjsAceitos }) {
  const fundos = fundosNoCorte(data, { gestorSel: '', seg, cnpjsAceitos })
  if (!fundos) return null
  const mesIndex = selMes ? (data.meses || []).findIndex(m => m.mes === selMes) : -1
  const porGestor = new Map()
  for (const f of fundos) {
    let juros = f.juros, amort = f.amort
    if (mesIndex >= 0) {
      const hit = (f.pm || []).find(p => p[0] === mesIndex)
      juros = hit ? hit[1] : 0
      amort = hit ? hit[2] : 0
    }
    const nome = f.gestor || '(sem gestor)'
    let o = porGestor.get(nome)
    if (!o) { o = { nome, juros: 0, amort: 0, total: 0 }; porGestor.set(nome, o) }
    o.juros += juros
    o.amort += amort
  }
  const rows = []
  for (const o of porGestor.values()) {
    o.total = o.juros + o.amort
    if (o.total > 0.5) rows.push(o)
  }
  rows.sort((a, b) => b.total - a.total)
  return rows
}

export function aggFundos(data, { gestorSel, seg, selMes, cnpjsAceitos }) {
  const pf = data?.porFundo
  if (!Array.isArray(pf)) return { disponivel: false, rows: [] }
  const mesIndex = selMes ? (data.meses || []).findIndex(m => m.mes === selMes) : -1
  const rows = []
  for (const f of pf) {
    if (gestorSel && f.gestor !== gestorSel) continue
    if (!matchSegFundo(f.segmento, seg)) continue
    if (cnpjsAceitos && !cnpjsAceitos.has(String(f.cnpj || '').replace(/\D/g, ''))) continue
    let juros = f.juros, amort = f.amort
    if (mesIndex >= 0) {
      const hit = (f.pm || []).find(p => p[0] === mesIndex)
      juros = hit ? hit[1] : 0
      amort = hit ? hit[2] : 0
    }
    const total = juros + amort
    if (total <= 0.5) continue
    rows.push({
      cnpj: f.cnpj, nome: f.nome || f.cnpj, gestor: f.gestor, segmento: f.segmento,
      pl: f.pl || null, juros, amort, total,
      pctPL: f.pl > 0 ? (total / f.pl) * 100 : null,
    })
  }
  rows.sort((a, b) => b.total - a.total)
  return { disponivel: true, rows }
}

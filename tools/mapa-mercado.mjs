// mapa-mercado.mjs -- consolida a base Mercado_Verdadeiro.csv nos 90 pregoes:
// por ativo (volume de mercado, dias, spread mediano/recente) + tendencia mensal.
//   node tools/mapa-mercado.mjs [topN=40]
// Saida: terminal + public/Mapa_Mercado_90d.csv. Ver METODOLOGIA_Mercado_Verdadeiro.md.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { splitQ, num } from './lib-mercado.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB = path.join(ROOT, 'public')
const SRC = path.join(PUB, 'Mercado_Verdadeiro.csv'), OUT = path.join(PUB, 'Mapa_Mercado_90d.csv')
const TOP = Math.max(1, parseInt(process.argv[2] || '40', 10))
const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }
const fmtSpread = (rot, unid, v) => v == null ? '--' : (unid === '%' ? `${rot} +${v.toFixed(2)}%` : `${rot} ${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}bps`)

const L = fs.readFileSync(SRC, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
// COLS: Data,Ativo,Indexador,DurationAnos,FonteDur,VolMercado,nNegMercado,PU_mid,Taxa_mid,RefSpread,Spread,SpreadFmt,VolDobradoTotal,VolSobraDobrada,PctMercadoEcon
const at = new Map()
let gVolMerc = 0, gEcon = 0
const porMes = new Map()
for (const l of L) {
  const c = l.split(',')
  const [data, ativo, idx] = c, dur = num(c[3]), volMerc = num(c[5]) || 0, ref = c[9], sp = num(c[10]), volDobrado = num(c[12]) || 0
  const econ = volDobrado / 2
  gVolMerc += volMerc; gEcon += econ
  const mes = data.slice(0, 7); const pm = porMes.get(mes) || { m: 0, e: 0 }; pm.m += volMerc; pm.e += econ; porMes.set(mes, pm)
  let a = at.get(ativo); if (!a) { a = { ativo, idx, dur, ref, diasMerc: 0, diasRel: 0, volMerc: 0, econ: 0, spreads: [], ultimo: null, ultimoData: '' }; at.set(ativo, a) }
  a.diasRel++; a.econ += econ; if (idx) a.idx = idx; if (dur) a.dur = dur
  if (volMerc > 0) {
    a.diasMerc++; a.volMerc += volMerc
    if (ref) a.ref = ref
    if (sp != null) { a.spreads.push(sp); if (data > a.ultimoData) { a.ultimoData = data; a.ultimo = sp } }
  }
}
const unidDe = a => a.ref === 'CDI' ? '%' : 'bps'
const linhas = [...at.values()].filter(a => a.volMerc > 0).sort((x, y) => y.volMerc - x.volMerc)

console.log(`\n=== MAPA DO MERCADO -- 90 pregoes (base Mercado_Verdadeiro.csv) ===`)
console.log(`  Volume MERCADO: ${brl(gVolMerc)} | economico total: ${brl(gEcon)} | MERCADO = ${(gVolMerc / gEcon * 100).toFixed(1)}% (resto direta/orfao)`)
console.log(`  Ativos com negocio de mercado: ${linhas.length}`)
console.log(`\n  Tendencia mensal (share de mercado):`)
for (const [m, v] of [...porMes].sort()) console.log(`    ${m}: mercado ${brl(v.m).padStart(16)} / econ ${brl(v.e).padStart(16)} = ${(v.m / v.e * 100).toFixed(0)}%`)

console.log(`\n  Top ${Math.min(TOP, linhas.length)} ativos por VOLUME DE MERCADO (90d):`)
console.log(`  Ativo    Idx          Dur  DiasM  VolMercado90d      Spread med.     Spread recente`)
for (const a of linhas.slice(0, TOP)) {
  const u = unidDe(a)
  console.log(`  ${a.ativo.padEnd(8)} ${(a.idx || '').padEnd(12)} ${(a.dur ? a.dur.toFixed(1) : '--').padStart(4)}  ${String(a.diasMerc).padStart(4)}  ${brl(a.volMerc).padStart(16)}  ${fmtSpread(a.ref, u, med(a.spreads)).padStart(14)}  ${fmtSpread(a.ref, u, a.ultimo)} (${a.ultimoData.slice(5)})`)
}

// CSV completo
const out = [['Ativo', 'Indexador', 'DurationAnos', 'RefSpread', 'DiasMercado', 'DiasRelevante', 'VolMercado90d', 'VolMercadoMedioDia', 'SpreadMediano', 'SpreadRecente', 'DataRecente'].join(',')]
for (const a of linhas) {
  const m = med(a.spreads)
  out.push([a.ativo, a.idx || '', a.dur ? a.dur.toFixed(2) : '', a.ref || '', a.diasMerc, a.diasRel,
    Math.round(a.volMerc), Math.round(a.volMerc / a.diasMerc), m != null ? (unidDe(a) === '%' ? m.toFixed(4) : Math.round(m)) : '',
    a.ultimo != null ? (unidDe(a) === '%' ? a.ultimo.toFixed(4) : Math.round(a.ultimo)) : '', a.ultimoData].join(','))
}
fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8')
console.log(`\n  -> ${path.relative(ROOT, OUT)} (${linhas.length} ativos)`)

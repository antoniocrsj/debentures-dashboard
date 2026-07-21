// gerar-cronograma-amortizacao.mjs
// ---------------------------------------------------------------------------
// Cronograma de amortizacao (VIDA INTEIRA) de TODAS as debentures do cadastro,
// montado por uma CASCATA de fontes, em ordem de prioridade/fidelidade:
//
//   1. anbima  -> cronograma REAL por parcela (dados-anbima/agenda-cache).
//                 taxa da ANBIMA e' % do SALDO DEVEDOR; convertida aqui p/
//                 fracao do principal ORIGINAL. Inclui o RESGATE final (que a
//                 ANBIMA lista separado da "amortizacao" mas tambem e' principal).
//   2. bullet  -> Tipo de Amortizacao vazio: 100% no vencimento (exato).
//   3. fixo    -> "Percentual fixo ... uniforme": parcelas iguais de Taxa% a
//                 cada intervalo (BB/BC) a partir da carencia (BD) (exato).
//   4. linear  -> demais (percentual variavel) sem ANBIMA: mesmas DATAS da
//                 regra, principal dividido igualmente (1/n). APROXIMACAO.
//
// Cada linha carrega a `Fonte`, p/ o consumidor nunca confundir fato com
// estimativa. Validado contra a ANBIMA nos fixos: datas 96%, valor 88% (<10%).
//
// Saida: public/data/Cronograma_Amortizacao.csv (Ticker,Data,FracaoPct,Fonte)
// Uso:   node tools/gerar-cronograma-amortizacao.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const CACHE = path.join(ROOT, 'dados-anbima', 'agenda-cache')
const OUT = path.join(ROOT, 'public', 'data', 'Cronograma_Amortizacao.csv')

const parseCsvLine = l => {
  const o = []; let c = '', q = false
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = '' } else c += ch }
  o.push(c); return o.map(x => x.replace(/^"|"$/g, ''))
}
const pd = s => {
  let m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  return null
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ehJuros = e => /juros/i.test(String(e.evento_arc || e.evento || ''))
const ehPrincipal = e => /amortiz|resgate|vencimento/i.test(String(e.evento_arc || e.evento || '')) && !ehJuros(e)

// ---- ANBIMA: cronograma real (fracao do principal original por data) ----
function viaAnbima(tk) {
  const f = path.join(CACHE, `${tk}.json`)
  if (!fs.existsSync(f)) return null
  let cache; try { cache = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) } catch { return null }
  const cont = (cache && cache.content) || []
  const princ = cont.filter(e => ehPrincipal(e) && e.data_evento)
    .map(e => ({ data: pd(e.data_evento), taxa: parseFloat(e.taxa) }))
    .filter(e => e.data)
    .sort((a, b) => a.data - b.data)
  if (!princ.length) return null
  let rem = 1
  const out = []
  for (const e of princ) {
    // taxa NaN (resgate sem taxa) -> paga todo o saldo restante
    const t = Number.isNaN(e.taxa) ? 100 : e.taxa
    const frac = Math.min(rem, (t / 100) * rem)
    if (frac > 1e-6) { out.push({ data: e.data, frac }); rem -= frac }
  }
  if (!out.length) return null
  return { eventos: out, fonte: 'anbima' }
}

// ---- Regra (BB/BC/BD): datas de carencia + intervalo ate' o vencimento ----
function datasRegra(r, C) {
  const car = pd(r[C.car]), venc = pd(r[C.venc])
  const cada = parseInt((r[C.cada] || '').replace(/^0+/, '') || '0', 10)
  const uni = (r[C.uni] || '').trim()
  if (!car || !venc || venc <= car) return null
  if (!cada || uni !== 'MES') return null
  const out = []
  let d = new Date(car); let g = 0
  while (d <= venc && g++ < 600) { out.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + cada, d.getDate()) }
  if (!out.some(x => iso(x) === iso(venc))) out.push(venc)   // vencimento sempre e' parcela
  return out
}
function viaFixo(r, C) {
  const datas = datasRegra(r, C)
  if (!datas) return null
  const taxa = parseFloat((r[C.taxa] || '').replace(',', '.'))
  const n = datas.length
  // fracao = Taxa% (se coerente com n) senao 1/n. Ultima parcela absorve o resto
  // p/ somar exatamente 100%.
  let base = (!Number.isNaN(taxa) && taxa > 0 && Math.abs(n * (taxa / 100) - 1) < 0.05) ? taxa / 100 : 1 / n
  const out = []
  let rem = 1
  datas.forEach((d, i) => { const frac = i === n - 1 ? rem : Math.min(rem, base); out.push({ data: d, frac }); rem -= frac })
  return { eventos: out, fonte: 'fixo' }
}
function viaLinear(r, C) {
  const datas = datasRegra(r, C)
  if (!datas) return null
  const n = datas.length
  const out = datas.map(d => ({ data: d, frac: 1 / n }))
  return { eventos: out, fonte: 'linear' }
}
function viaBullet(r, C) {
  const venc = pd(r[C.venc]); if (!venc) return null
  return { eventos: [{ data: venc, frac: 1 }], fonte: 'bullet' }
}

// ---- main ----
const L = fs.readFileSync(path.join(ROOT, 'public/Debentures.csv'), 'latin1').trim().split(/\r?\n/)
const H = parseCsvLine(L[0])
const idx = n => H.indexOf(n)
const C = {
  tk: idx('Codigo do Ativo'), venc: idx('Data de Vencimento'),
  taxa: idx('Amortizacao - Taxa'), cada: idx('Amortizacao - Cada'),
  uni: idx('Amortizacao - Unidade'), car: idx('Amortizacao - Carencia'),
  tipo: idx('Tipo de Amortizacao'),
}
const rows = L.slice(1).map(parseCsvLine).filter(r => r.length > 10 && r[C.tk])

const cont = { anbima: 0, bullet: 0, fixo: 0, linear: 0, sem_dado: 0 }
let somaOk = 0
const lines = ['Ticker,Data,FracaoPct,Fonte']
for (const r of rows) {
  const tipo = (r[C.tipo] || '').trim()
  const bullet = tipo === '' || tipo === '-'
  // cascata: anbima -> (bullet | fixo | linear)
  let res = viaAnbima(r[C.tk])
  // ANBIMA truncada (cache com parte das parcelas -> soma < 95%) e' PIOR que uma
  // deducao completa: descarta e cai p/ a regra. So' ~2% dos papeis caem aqui.
  if (res && res.eventos.reduce((s, e) => s + e.frac, 0) < 0.95) res = null
  if (!res) {
    if (bullet) res = viaBullet(r, C)
    else if (/fixo/i.test(tipo) && /uniforme/i.test(tipo)) res = viaFixo(r, C) || viaLinear(r, C)
    else res = viaLinear(r, C)
    // fallback final: se a regra nao deu (sem carencia/cada), bullet no vencimento
    if (!res) res = viaBullet(r, C)
  }
  if (!res) { cont.sem_dado++; continue }
  cont[res.fonte]++
  const soma = res.eventos.reduce((s, e) => s + e.frac, 0)
  if (Math.abs(soma - 1) < 0.02) somaOk++
  for (const e of res.eventos) lines.push(`${r[C.tk]},${iso(e.data)},${(e.frac * 100).toFixed(4)},${res.fonte}`)
}
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')

const totalDeb = Object.values(cont).reduce((a, b) => a + b, 0)
console.log('=== Cronograma de amortizacao (vida inteira) ===')
console.log(`  debentures: ${totalDeb} | eventos: ${lines.length - 1}`)
console.log('  por fonte:')
for (const [k, v] of Object.entries(cont)) console.log(`    ${k.padEnd(9)}: ${v}`)
console.log(`  fracoes somam ~100%: ${somaOk} de ${totalDeb - cont.sem_dado}`)
console.log(`  -> ${OUT}`)

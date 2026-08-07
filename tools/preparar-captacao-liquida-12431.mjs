// preparar-captacao-liquida-12431.mjs
// ---------------------------------------------------------------------------
// Captacao LIQUIDA mensal dos FI-Infra 12.431, separada por FAIXA DE IDADE do
// fundo (0-6m carencia / 6-24m 67% / >24m 85%). Captacao liquida do dia =
// CAPTC_DIA - RESG_DIA (Informe Diario da CVM); somada por fundo dentro do mes e
// jogada no balde da idade que o fundo tinha naquele mes. E' o outro lado do gap:
// quanto dinheiro NOVO entrou (e em que estagio de enquadramento) — pressao real
// de compra de incentivadas.
//
// Saida: public/data/Captacao_Liquida_12431.json
//   serie:[{ mes:'AAAA-MM', cap1,cap2,cap3, capTot, n }]  (R$; cap1/2/3 = baldes de idade)
//   serieGestora:{ gestora:[{cap1,cap2,cap3} por mes, alinhado com serie] }
//
// Limite: so' existe Informe Diario a partir de jul/25 localmente (14 meses). Fluxo
// REAL, sem futuro. Universo curado = tools/Fundos_12431.csv; idade da 1a cota.
//
// Uso: node tools/preparar-captacao-liquida-12431.mjs [--cvm "C:\...\CVM _informe_diario"]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public'), DATA = path.join(PUB, 'data')
const OUT = path.join(DATA, 'Captacao_Liquida_12431.json')

function argCvm() {
  const i = process.argv.indexOf('--cvm')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env.CVM_INFORME_DIR || ('C:\\Projeto Cr' + String.fromCharCode(233) + 'dito\\CVM _informe_diario')
}
const CVM = argCvm()
const digits = s => String(s || '').replace(/\D/g, '')
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
function pl(l){const o=[];let c='',q=false;for(const ch of l){if(q){if(ch==='"')q=false;else c+=ch}else{if(ch==='"')q=true;else if(ch===','){o.push(c);c=''}else c+=ch}}o.push(c);return o}
const ymOf = k => [+String(k).slice(0, 4), +String(k).slice(4, 6)]
const monthsBetween = (a, b) => (b[0] - a[0]) * 12 + (b[1] - a[1])

async function main() {
  // universo curado
  const uni = new Set()
  { const F = fs.readFileSync(path.join(__dirname, 'Fundos_12431.csv'), 'utf8').split(/\r?\n/).filter(x => x).slice(1)
    for (const l of F) uni.add(digits(pl(l)[0])) }
  if (!uni.size) { console.error('[captacao] universo vazio (Fundos_12431.csv)'); return }
  // 1a cota (AAAAMM) -> idade
  const firstCota = {}
  { const pc = fs.readFileSync(path.join(DATA, 'Fundos_PrimeiraCota.csv'), 'utf8').split(/\r?\n/).filter(x => x)
    const ph = pc[0].split(','); const iC = ph.indexOf('CNPJ'), iM = ph.indexOf('PrimeiraCotaMes')
    for (const r of pc.slice(1)) { const c = r.split(','); firstCota[digits(c[iC])] = c[iM] } }
  // gestora (apelido) por fundo
  const gestoraDe = {}
  { const cx = fs.readFileSync(path.join(DATA, 'Caixa_Potencial_Fundos.csv'), 'utf8').split(/\r?\n/).filter(x => x)
    const h = pl(cx[0]); const iC = h.indexOf('CNPJ'), iG = h.indexOf('Gestor')
    if (iC >= 0 && iG >= 0) for (const r of cx.slice(1)) { const c = pl(r); gestoraDe[digits(c[iC])] = (c[iG] || '—').trim() || '—' } }

  if (!fs.existsSync(CVM)) { console.error(`[captacao] Informe Diario nao encontrado em "${CVM}". Pulei.`); return }
  const zips = fs.readdirSync(CVM).filter(f => /^inf_diario_fi_\d{6}\.zip$/i.test(f)).sort()
  if (!zips.length) { console.error('[captacao] nenhum inf_diario_fi_*.zip'); return }

  // capLiq[mes][cnpj] = soma (CAPTC_DIA - RESG_DIA) do mes
  const capLiq = {}
  for (const zname of zips) {
    const mes = zname.replace(/^inf_diario_fi_/, '').replace(/\.zip$/i, '')
    const dir = await unzipper.Open.file(path.join(CVM, zname))
    const csv = dir.files.find(f => /\.csv$/i.test(f.path)); if (!csv) continue
    const txt = (await csv.buffer()).toString('latin1')
    const nl = txt.indexOf('\n'); const header = txt.slice(0, nl).split(';')
    const iC = header.indexOf('CNPJ_FUNDO_CLASSE') >= 0 ? header.indexOf('CNPJ_FUNDO_CLASSE') : header.indexOf('CNPJ_FUNDO')
    const iCap = header.indexOf('CAPTC_DIA'), iRes = header.indexOf('RESG_DIA')
    if (iC < 0 || iCap < 0 || iRes < 0) { console.error(`  ${zname}: cabecalho inesperado, pulado`); continue }
    const acc = capLiq[mes] || (capLiq[mes] = {})
    let pos = nl + 1; const N = txt.length
    while (pos < N) {
      let end = txt.indexOf('\n', pos); if (end < 0) end = N
      const line = txt.charCodeAt(end - 1) === 13 ? txt.slice(pos, end - 1) : txt.slice(pos, end)
      pos = end + 1; if (!line) continue
      const c = line.split(';'); if (c.length <= iRes) continue
      const cnpj = digits(c[iC]); if (!uni.has(cnpj)) continue
      acc[cnpj] = (acc[cnpj] || 0) + (num(c[iCap]) - num(c[iRes]))
    }
  }

  const meses = Object.keys(capLiq).sort()
  const serie = []
  const porGestora = {}
  for (const mes of meses) {
    const ai = serie.length; const alvo = ymOf(mes)
    let cap1 = 0, cap2 = 0, cap3 = 0, n = 0
    for (const c in capLiq[mes]) {
      const v = capLiq[mes][c]; if (!v) continue
      const fc = firstCota[c]; if (!fc) continue   // sem 1ª cota não dá p/ classificar a idade (fundo fora do Caixa_Potencial); pular em vez de jogar no 0-6m
      n++
      const idade = monthsBetween(ymOf(fc), alvo)
      const g = gestoraDe[c] || '—'
      const arr = porGestora[g] || (porGestora[g] = [])
      while (arr.length <= ai) arr.push({ cap1: 0, cap2: 0, cap3: 0 })
      if (idade < 6) { cap1 += v; arr[ai].cap1 += v } else if (idade < 24) { cap2 += v; arr[ai].cap2 += v } else { cap3 += v; arr[ai].cap3 += v }
    }
    serie.push({ mes: `${alvo[0]}-${String(alvo[1]).padStart(2, '0')}`, cap1: Math.round(cap1), cap2: Math.round(cap2), cap3: Math.round(cap3), capTot: Math.round(cap1 + cap2 + cap3), n })
  }
  for (const g in porGestora) {
    const arr = porGestora[g]; while (arr.length < serie.length) arr.push({ cap1: 0, cap2: 0, cap3: 0 })
    porGestora[g] = arr.map(o => ({ cap1: Math.round(o.cap1), cap2: Math.round(o.cap2), cap3: Math.round(o.cap3) }))
  }

  const meta = { geradoEm: new Date().toISOString(), fonte: 'Informe Diario (CAPTC_DIA - RESG_DIA)', serie, serieGestora: porGestora }
  fs.writeFileSync(OUT, JSON.stringify(meta) + '\n', 'utf8')
  console.log(`[captacao] ${serie.length} meses (${serie[0]?.mes}..${serie.at(-1)?.mes})`)
  const b = x => (x / 1e9).toFixed(2)
  for (const p of serie) console.log(`  ${p.mes}: 0-6 ${b(p.cap1).padStart(6)} | 6-24 ${b(p.cap2).padStart(6)} | >24 ${b(p.cap3).padStart(6)} | tot ${b(p.capTot).padStart(6)} bi (${p.n} fundos)`)
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main().catch(e => { console.error('[captacao] erro:', e.message); process.exitCode = 1 })

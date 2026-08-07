// preparar-demanda-movel-12431.mjs
// ---------------------------------------------------------------------------
// Demanda MOVEL a frente do enquadramento 12.431: em cada mes-ancora M (desde
// jan/25 ate' o ultimo mes de CDA MADURO), quanto os FI-Infra precisavam comprar
// nos proximos 3 e 6 meses. Usa a carteira 12.431 REAL de cada mes (do CDA daquele
// mes) + as idades (1a cota) cruzando os degraus 6m/24m + PL_ref de M. SEM
// amortizacao (necessidade bruta) — a carteira fica parada em M e so' a exigencia
// (idade) muda ao longo do horizonte. E' um indicador ANTECEDENTE de demanda por
// incentivadas (a "foto do mes" fica colada no zero; a pressao e' toda a frente).
//
// Saida: public/data/Demanda_Movel_12431.json
//   { geradoEm, ancoraMax, media:'mensal', serie:[{ mes:'AAAA-MM', c0,c3,c6,n3,n6 }] }
//   c0/c3/c6 = compra necessaria (R$) hoje/+3m/+6m; n3/n6 = fundos desenq. no horizonte.
//
// Fontes: CDA (BLC_4 + PL mensal, em CdaDir) + Debentures.csv (flag) + universo
// curado (tools/Fundos_12431.csv) + 1a cota (Fundos_PrimeiraCota.csv) + maturidade
// do BLC (public/BLC_maturidade.json -> ultimo mes-ancora confiavel).
//
// Uso: node tools/preparar-demanda-movel-12431.mjs [--cda "C:\...\CVM _cda"]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public'), DATA = path.join(PUB, 'data')
const OUT = path.join(DATA, 'Demanda_Movel_12431.json')
const ANCORA_INI = 202501   // primeiro mes-ancora

function argCda() {
  const i = process.argv.indexOf('--cda')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env.CDA_DIR || ('C:\\Projeto Cr' + String.fromCharCode(233) + 'dito\\CVM _cda')
}
const CDA = argCda()
const digits = s => String(s || '').replace(/\D/g, '')
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
function pl(l){const o=[];let c='',q=false;for(const ch of l){if(q){if(ch==='"')q=false;else c+=ch}else{if(ch==='"')q=true;else if(ch===','){o.push(c);c=''}else c+=ch}}o.push(c);return o}
const ymOf = k => [+String(k).slice(0, 4), +String(k).slice(4, 6)]
const monthsBetween = (a, b) => (b[0] - a[0]) * 12 + (b[1] - a[1])

function main() {
  // flag 12.431
  const deb = fs.readFileSync(path.join(PUB, 'Debentures.csv'), 'utf8').split(/\r?\n/).filter(x => x)
  const dh = pl(deb[0]); const iCo = dh.indexOf('Codigo do Ativo'), iIn = dh.indexOf('Deb. Incent. (Lei 12.431)')
  const set12431 = new Set(); for (const r of deb.slice(1).map(pl)) { if (/^s$/i.test((r[iIn] || '').trim())) set12431.add((r[iCo] || '').trim().toUpperCase()) }
  // universo curado
  const uni = new Set()
  { const F = fs.readFileSync(path.join(__dirname, 'Fundos_12431.csv'), 'utf8').split(/\r?\n/).filter(x => x).slice(1)
    for (const l of F) uni.add(digits(pl(l)[0])) }
  // 1a cota (AAAAMM)
  const firstCota = {}
  { const pc = fs.readFileSync(path.join(DATA, 'Fundos_PrimeiraCota.csv'), 'utf8').split(/\r?\n/).filter(x => x)
    const ph = pc[0].split(','); const iC = ph.indexOf('CNPJ'), iM = ph.indexOf('PrimeiraCotaMes')
    for (const r of pc.slice(1)) { const c = r.split(','); firstCota[digits(c[iC])] = c[iM] } }
  // maturidade do BLC -> ultimo mes-ancora confiavel
  let ancoraMax = 202603
  try { const selo = JSON.parse(fs.readFileSync(path.join(PUB, 'BLC_maturidade.json'), 'utf8')); if (/^\d{6}$/.test(String(selo.mesAno || ''))) ancoraMax = +selo.mesAno } catch { /* default */ }

  if (!fs.existsSync(CDA)) { console.error(`[demanda-movel] CDA nao encontrado em "${CDA}". Pulei.`); return }
  // meses a ler: 6 de warmup (media) antes de ANCORA_INI ate' ancoraMax
  const meses = []
  { let y = 2024, m = 8   // 202408
    while (y * 100 + m <= ancoraMax) { meses.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } } }

  function lerMes(mes) {
    const dir = path.join(CDA, `cda_extraido_${mes}`); const pos = {}, plMap = {}
    const fb = path.join(dir, `cda_fi_BLC_4_${mes}.csv`)
    if (fs.existsSync(fb)) {
      const L = fs.readFileSync(fb, 'latin1').split(/\r?\n/); const H = L[0].split(';')
      const iC = H.indexOf('CNPJ_FUNDO_CLASSE') >= 0 ? H.indexOf('CNPJ_FUNDO_CLASSE') : H.indexOf('CNPJ_FUNDO')
      const iA = H.indexOf('CD_ATIVO'), iV = H.indexOf('VL_MERC_POS_FINAL'), iT = H.indexOf('TP_ATIVO')
      for (let i = 1; i < L.length; i++) { const ce = L[i].split(';'); if (ce.length <= iV) continue; const c = digits(ce[iC]); if (!uni.has(c)) continue; if (iT >= 0 && !/deb/i.test(ce[iT] || '')) continue; if (!set12431.has((ce[iA] || '').trim().toUpperCase())) continue; pos[c] = (pos[c] || 0) + num(ce[iV]) }
    }
    const fp = path.join(dir, `cda_fi_PL_${mes}.csv`)
    if (fs.existsSync(fp)) {
      const L = fs.readFileSync(fp, 'latin1').split(/\r?\n/); const H = L[0].split(';')
      const iC = H.indexOf('CNPJ_FUNDO_CLASSE') >= 0 ? H.indexOf('CNPJ_FUNDO_CLASSE') : H.indexOf('CNPJ_FUNDO'); const iP = H.indexOf('VL_PATRIM_LIQ')
      for (let i = 1; i < L.length; i++) { const ce = L[i].split(';'); if (ce.length <= iP) continue; const c = digits(ce[iC]); if (!uni.has(c)) continue; plMap[c] = (plMap[c] || 0) + num(ce[iP]) }
    }
    return { pos, plMap }
  }
  const dados = {}; for (const m of meses) dados[m] = lerMes(m)
  const media = (c, idx) => { const pts = []; for (let k = 0; k < 6; k++) { const mm = meses[idx - k]; if (mm) { const v = dados[mm].plMap[c]; if (v > 0) pts.push(v) } } return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 0 }

  const serie = []
  for (let i = 0; i < meses.length; i++) {
    const M = meses[i]; if (+M < ANCORA_INI) continue
    const [y, m] = ymOf(M); let c0 = 0, c3 = 0, c6 = 0, n3 = 0, n6 = 0
    for (const c in dados[M].pos) {
      const elig = dados[M].pos[c]; const plM = dados[M].plMap[c] || 0; if (plM <= 0) continue
      const md = media(c, i); const plRef = Math.min(plM, md > 0 ? md : plM)
      const fc = firstCota[c]
      for (const h of [0, 3, 6]) {
        const idade = fc ? monthsBetween(ymOf(fc), [y, m + h]) : 0
        const pct = idade < 6 ? 0 : (idade < 24 ? 0.67 : 0.85)
        const cmp = Math.max(0, plRef * pct - elig)   // SEM amortizacao: elig parado em M
        if (h === 0) c0 += cmp; else if (h === 3) { c3 += cmp; if (cmp > 0) n3++ } else { c6 += cmp; if (cmp > 0) n6++ }
      }
    }
    serie.push({ mes: `${y}-${String(m).padStart(2, '0')}`, c0: Math.round(c0), c3: Math.round(c3), c6: Math.round(c6), n3, n6 })
  }

  const meta = { geradoEm: new Date().toISOString(), ancoraMax: `${String(ancoraMax).slice(0, 4)}-${String(ancoraMax).slice(4, 6)}`, media: 'mensal (6 fotos)', semAmortizacao: true, serie }
  fs.writeFileSync(OUT, JSON.stringify(meta) + '\n', 'utf8')
  console.log(`[demanda-movel] ${serie.length} ancoras (${serie[0]?.mes}..${serie.at(-1)?.mes}) | ancora max ${meta.ancoraMax}`)
  console.log(`  ultimo: +3m R$ ${((serie.at(-1)?.c3 || 0) / 1e9).toFixed(1)} bi | +6m R$ ${((serie.at(-1)?.c6 || 0) / 1e9).toFixed(1)} bi`)
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main()

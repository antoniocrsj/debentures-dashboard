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
// Saida: public/data/Demanda_Movel_12431.json  (serie desde jan/24 ate' o mes do BLC)
//   serie:[{ mes,c0,c3,c6,c12,n3,n6,n12, t6,t24, b1,b2,b3 }]
//   c0/c3/c6/c12 = compra necessaria (R$) hoje/+3m/+6m/+12m; nH = fundos desenq. no horizonte.
//   t6/t24 = PL_ref que CRUZA 6m/24m no mes (aniversario, real); b1/b2/b3 = PL_ref por faixa
//   de idade (0-6/6-24/>24m) no mes. Sao a METADE HISTORICA REAL dos graficos que na projecao
//   (preparar-enquadramento) vem de serieMensal (trig6/trig24/b1/b2/b3). Por gestora:
//   serieGestora {c0,c3,c6,c12}, serieAnivGestora {t6,t24}, serieBucketGestora {b1,b2,b3}.
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
const ANCORA_INI = 202401   // primeiro mes-ancora

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
  // gestora (apelido) por fundo — p/ a série por gestora (filtro no gráfico)
  const gestoraDe = {}
  { const cx = fs.readFileSync(path.join(DATA, 'Caixa_Potencial_Fundos.csv'), 'utf8').split(/\r?\n/).filter(x => x)
    const h = pl(cx[0]); const iC = h.indexOf('CNPJ'), iG = h.indexOf('Gestor')
    if (iC >= 0 && iG >= 0) for (const r of cx.slice(1)) { const c = pl(r); gestoraDe[digits(c[iC])] = (c[iG] || '—').trim() || '—' } }
  // media 180 DIAS (diaria) por fundo x ref-mes (AAAAMM) — MESMA base do enquadramento
  // (plRefNoMes). Sem isso a media mensal (6 fotos) SUPERESTIMA fundos novos (0-6m):
  // o aporte recente entra cheio na media, enquanto a regra legal e' a media de 180d
  // (dilui o aporte). Cai na media mensal so' onde a diaria nao existe (antes do warmup).
  const media180 = {}
  { const f = path.join(DATA, 'Fundos_PL_Media180.csv')
    if (fs.existsSync(f)) { const L = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(x => x); const h = L[0].split(','); const iC = h.indexOf('CNPJ'), iR = h.indexOf('Ref'), iM = h.indexOf('Media180')
      for (const r of L.slice(1)) { const c = r.split(','); const cn = digits(c[iC]); (media180[cn] || (media180[cn] = {}))[(c[iR] || '').trim()] = num(c[iM]) } } }
  // maturidade do BLC -> ultimo mes-ancora confiavel
  let ancoraMax = 202603
  try { const selo = JSON.parse(fs.readFileSync(path.join(PUB, 'BLC_maturidade.json'), 'utf8')); if (/^\d{6}$/.test(String(selo.mesAno || ''))) ancoraMax = +selo.mesAno } catch { /* default */ }

  if (!fs.existsSync(CDA)) { console.error(`[demanda-movel] CDA nao encontrado em "${CDA}". Pulei.`); return }
  // meses a ler: 6 de warmup (media) antes de ANCORA_INI ate' ancoraMax
  const meses = []
  { let y = 2023, m = 8   // 202308 (6 de warmup p/ a media antes de ANCORA_INI=202401)
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
  const porGestora = {}       // gestora -> [{c0,c3,c6,c12} por âncora, alinhado com serie]
  const porGestoraAniv = {}   // gestora -> [{t6,t24} por âncora] (PL_ref que cruza 6m/24m no mês)
  const porGestoraBucket = {} // gestora -> [{b1,b2,b3} por âncora] (PL_ref por faixa de idade)
  for (let i = 0; i < meses.length; i++) {
    const M = meses[i]; if (+M < ANCORA_INI) continue
    const ai = serie.length   // índice desta âncora no array serie
    const [y, m] = ymOf(M)
    let c0 = 0, c3 = 0, c6 = 0, c12 = 0, n3 = 0, n6 = 0, n12 = 0
    let t6 = 0, t24 = 0, b1 = 0, b2 = 0, b3 = 0   // aniversário + buckets NO mês-âncora (foto real)
    for (const c in dados[M].pos) {
      const elig = dados[M].pos[c]; const plM = dados[M].plMap[c] || 0; if (plM <= 0) continue
      const md180 = media180[c]?.[M]; const md = md180 > 0 ? md180 : media(c, i)   // 180d diaria; fallback mensal
      const plRef = Math.min(plM, md > 0 ? md : plM)
      const fc = firstCota[c]; let f0 = 0, f3 = 0, f6 = 0, f12 = 0
      for (const h of [0, 3, 6, 12]) {   // h=0 = foto do mês (estoque do gap real do mês)
        const idade = fc ? monthsBetween(ymOf(fc), [y, m + h]) : 0
        const pct = idade < 6 ? 0 : (idade < 24 ? 0.67 : 0.85)
        const cmp = Math.max(0, plRef * pct - elig)   // SEM amortizacao: elig parado em M
        if (h === 0) { c0 += cmp; f0 = cmp } else if (h === 3) { c3 += cmp; if (cmp > 0) n3++; f3 = cmp } else if (h === 6) { c6 += cmp; if (cmp > 0) n6++; f6 = cmp } else { c12 += cmp; if (cmp > 0) n12++; f12 = cmp }
      }
      // idade NO mês-âncora (h=0): buckets por faixa + gatilho de aniversário 6m/24m.
      // SÓ quem tem 1ª cota (mesma base curada da projeção): sem ela, `idade` cairia em
      // 0 e um fundo grande/velho (ex.: 27 bi fora do Caixa_Potencial) seria jogado no
      // 0-6m com PL cheio — inflava o b1 e criava o degrau no seam. Sem 1ª cota, o gap
      // (h-loop acima) já contribui 0 (idade 0 → carência), então isto não afeta o gap.
      const g = gestoraDe[c] || '—'
      if (fc) {
        const idadeM = monthsBetween(ymOf(fc), [y, m])
        const bg = porGestoraBucket[g] || (porGestoraBucket[g] = [])
        while (bg.length <= ai) bg.push({ b1: 0, b2: 0, b3: 0 })
        if (idadeM < 6) { b1 += plRef; bg[ai].b1 += plRef } else if (idadeM < 24) { b2 += plRef; bg[ai].b2 += plRef } else { b3 += plRef; bg[ai].b3 += plRef }
        if (idadeM === 6 || idadeM === 24) {
          const ag = porGestoraAniv[g] || (porGestoraAniv[g] = [])
          while (ag.length <= ai) ag.push({ t6: 0, t24: 0 })
          if (idadeM === 6) { t6 += plRef; ag[ai].t6 += plRef } else { t24 += plRef; ag[ai].t24 += plRef }
        }
      }
      if (f0 > 0 || f3 > 0 || f6 > 0 || f12 > 0) {
        const arr = porGestora[g] || (porGestora[g] = [])
        while (arr.length <= ai) arr.push({ c0: 0, c3: 0, c6: 0, c12: 0 })
        arr[ai].c0 += f0; arr[ai].c3 += f3; arr[ai].c6 += f6; arr[ai].c12 += f12
      }
    }
    serie.push({ mes: `${y}-${String(m).padStart(2, '0')}`, c0: Math.round(c0), c3: Math.round(c3), c6: Math.round(c6), c12: Math.round(c12), n3, n6, n12, t6: Math.round(t6), t24: Math.round(t24), b1: Math.round(b1), b2: Math.round(b2), b3: Math.round(b3) })
  }
  // pad + arredonda as séries por gestora (alinhadas com serie)
  for (const g in porGestora) {
    const arr = porGestora[g]; while (arr.length < serie.length) arr.push({ c0: 0, c3: 0, c6: 0, c12: 0 })
    porGestora[g] = arr.map(o => ({ c0: Math.round(o.c0), c3: Math.round(o.c3), c6: Math.round(o.c6), c12: Math.round(o.c12) }))
  }
  for (const g in porGestoraAniv) {
    const arr = porGestoraAniv[g]; while (arr.length < serie.length) arr.push({ t6: 0, t24: 0 })
    porGestoraAniv[g] = arr.map(o => ({ t6: Math.round(o.t6), t24: Math.round(o.t24) }))
  }
  for (const g in porGestoraBucket) {
    const arr = porGestoraBucket[g]; while (arr.length < serie.length) arr.push({ b1: 0, b2: 0, b3: 0 })
    porGestoraBucket[g] = arr.map(o => ({ b1: Math.round(o.b1), b2: Math.round(o.b2), b3: Math.round(o.b3) }))
  }

  const meta = { geradoEm: new Date().toISOString(), ancoraMax: `${String(ancoraMax).slice(0, 4)}-${String(ancoraMax).slice(4, 6)}`, media: '180d diaria (fallback mensal antes do warmup)', semAmortizacao: true, serie, serieGestora: porGestora, serieAnivGestora: porGestoraAniv, serieBucketGestora: porGestoraBucket }
  fs.writeFileSync(OUT, JSON.stringify(meta) + '\n', 'utf8')
  console.log(`[demanda-movel] ${serie.length} ancoras (${serie[0]?.mes}..${serie.at(-1)?.mes}) | ancora max ${meta.ancoraMax}`)
  console.log(`  ultimo: +3m R$ ${((serie.at(-1)?.c3 || 0) / 1e9).toFixed(1)} | +6m R$ ${((serie.at(-1)?.c6 || 0) / 1e9).toFixed(1)} | +12m R$ ${((serie.at(-1)?.c12 || 0) / 1e9).toFixed(1)} bi`)
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main()

// lib-mercado.mjs
// --------------------------------------------------------------------------
// Nucleo COMPARTILHADO da separacao MERCADO x DIRETA no tape BDI (Negocio a
// Negocio, DEB) e do calculo de spread (CDI+ / NTN-B+). Usado por
// varredura-mercado.mjs (gera a base) e lupa-mercado.mjs (inspeciona).
// Fonte unica de verdade da logica -- ver METODOLOGIA_Mercado_Verdadeiro.md.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// -------- parametros da logica (calibrados com o usuario, jul/2026) --------
export const MIN_VOL_DOBRADO = 10e6   // relevancia: soma dobrada por ativo/dia < 10MM -> descarta
export const FEE_LO = 0.0001          // fee minimo = 1 bp  x duration (fracao de PU)
export const FEE_HI = 0.0002          // fee maximo = 2 bps x duration
export const PU_DP = 4                // casas decimais p/ agrupar PU

// -------- helpers --------
export const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : null }
export const splitQ = l => (l.match(/"((?:[^"]|"")*)"/g) || []).map(x => x.slice(1, -1).replace(/""/g, '"'))
export const parseMs = v => { const s = String(v == null ? '' : v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]); m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]); return null }
export const anoDe = v => { const ms = parseMs(v); return ms == null ? null : new Date(ms).getUTCFullYear() }

// -------- cadastros: duration / vencimento / NTN-B de referencia --------
export function lerAnbima(PUB) {
  const m = new Map(); const p = path.join(PUB, 'Anbima_Tx.csv'); if (!fs.existsSync(p)) return m
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
    const f = splitQ(l); if (f.length < 14) continue
    // ticker(0) tipoTaxa(2) indexador(4) dataVenc(6) durAnos(8) ntnbRef(12) codNtnb(13) taxaNtnb(15?)
    m.set(f[0], { durAnos: num(f[8]), venc: f[6], idx: f[2], ntnbRef: f[12] || null, codNtnb: f[13] || null })
  }
  return m
}
export function lerVenc(PUB) {
  const m = new Map(); const p = path.join(PUB, 'Debentures.csv'); if (!fs.existsSync(p)) return m
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
    const f = splitQ(l); if (f.length < 13) continue          // Codigo do Ativo(0) / Data de Vencimento(12)
    if (f[0] && !m.has(f[0])) m.set(f[0], f[12])
  }
  return m
}
export const vencDe = (ativo, anbima, vencDeb) => anbima.get(ativo)?.venc || vencDeb.get(ativo) || null
const anosAte = (venc, diaISO) => { const a = (parseMs(venc) - Date.UTC(...diaISO.split('-').map((x, i) => i === 1 ? +x - 1 : +x))) / (365.25 * 864e5); return a > 0 ? a : null }
// Duration: ANBIMA (durationAnbimaAnos) quando ha; senao 0,70 x (anos ate o vencimento).
export function durationDe(ativo, dia, anbima, vencDeb) {
  const a = anbima.get(ativo)
  if (a?.durAnos > 0) return { D: a.durAnos, fonte: 'anbima', idx: a.idx }
  const venc = a?.venc || vencDeb.get(ativo); if (venc) { const y = anosAte(venc, dia); if (y) return { D: 0.70 * y, fonte: '0.70xprazo', idx: a?.idx || '' } }
  return null
}

// -------- curva TPF por dia (REUNE_Curvas.csv) --------
export function lerCurvas(PUB) {
  const m = new Map(); const p = path.join(PUB, 'REUNE_Curvas.csv'); if (!fs.existsSync(p)) return m
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
    const f = splitQ(l); if (f.length < 4) continue; const [data, tipo, venc, taxa] = f, t = num(taxa); if (t == null) continue
    let o = m.get(data); if (!o) { o = { ntnb: [], ltn: [] }; m.set(data, o) }
    if (tipo === 'NTN-B') o.ntnb.push({ venc, taxa: t }); else if (tipo === 'LTN') o.ltn.push({ venc, taxa: t })
  }
  return m
}
const refProx = (arr, venc) => { const alvo = parseMs(venc); if (alvo == null || !arr?.length) return null; let best = null, bd = Infinity; for (const p of arr) { const ms = parseMs(p.venc); if (ms == null) continue; const d = Math.abs(ms - alvo); if (d < bd) { bd = d; best = p } } return best }
export function curvaDoDia(curvas, dia) { if (curvas.has(dia)) return { c: curvas.get(dia), usada: dia }; const ds = [...curvas.keys()].filter(d => d <= dia).sort(); if (!ds.length) return null; const u = ds[ds.length - 1]; return { c: curvas.get(u), usada: u } }

// taxaMid (yield do meio das pontas) -> spread. DI_SPREAD -> CDI+ (a taxa JA e' o
// spread). IPCA_SPREAD -> NTN-B+ bps sobre a NTN-B que a ANBIMA DESIGNA
// (codigoNtnbExibicao/ntnbReferencia -- pela duration, nao pelo vencimento), com
// o yield desse ponto na curva do dia. Fallback: NTN-B de vencimento do papel.
export function spreadDe(ativo, dia, taxaMid, idx, anbima, vencDeb, curvas) {
  if (taxaMid == null) return null
  if (idx === 'DI_SPREAD') return { fmt: `CDI +${taxaMid.toFixed(2)}%`, num: +taxaMid.toFixed(4), unid: '%', rot: 'CDI' }
  if (idx === 'IPCA_SPREAD') {
    const cv = curvaDoDia(curvas, dia); if (!cv) return null
    const a = anbima.get(ativo)
    const refVenc = a?.ntnbRef || vencDe(ativo, anbima, vencDeb)
    const r = refProx(cv.c.ntnb, refVenc); if (!r) return null
    const bps = Math.round((taxaMid - r.taxa) * 100)
    const cod = a?.codNtnb || ('B' + String((anoDe(r.venc) || 0) % 100).padStart(2, '0'))
    return { fmt: `${cod} ${bps < 0 ? '−' : '+'}${Math.abs(bps)}bps`, num: bps, unid: 'bps', rot: cod, ref: r.taxa, fb: cv.usada !== dia ? cv.usada : null }
  }
  return null
}

// -------- carrega um pregao e agrupa por PU, por ativo --------
// Retorna Map(ativo -> grupos[]), grupo = {pu, qtd, vol, txSum, txN}.
export function gruposDoDia(BDIDIR, dia) {
  const txt = zlib.gunzipSync(fs.readFileSync(path.join(BDIDIR, `DEB_${dia}.csv.gz`))).toString('utf8')
  const porAtivo = new Map()
  for (const l of txt.split(/\r?\n/).slice(1).filter(Boolean)) {
    const f = splitQ(l); if (f.length < 9) continue
    // Data,Ativo,Emissor,Qtd,Preco,Volume,Taxa,Origem,Horario,...
    const ativo = f[1], qtd = num(f[3]), preco = num(f[4]), vol = num(f[5]), taxa = num(f[6])
    if (qtd == null || preco == null || vol == null) continue
    const pu = Math.round(preco * 10 ** PU_DP) / 10 ** PU_DP, k = pu.toFixed(PU_DP)
    let mp = porAtivo.get(ativo); if (!mp) { mp = new Map(); porAtivo.set(ativo, mp) }
    let g = mp.get(k); if (!g) { g = { pu, qtd: 0, vol: 0, txSum: 0, txN: 0 }; mp.set(k, g) }
    g.qtd += qtd; g.vol += vol; if (taxa != null) { g.txSum += taxa * qtd; g.txN += qtd }
  }
  const out = new Map()
  for (const [ativo, mp] of porAtivo) out.set(ativo, [...mp.values()])
  return out
}

// -------- VARREDURA GULOSA (o coracao da logica) --------
// Ignora o HORARIO (variavel nao confiavel). Do PU mais baixo pra cima, procura
// a contraparte em PU*(1+fee), fee em [1bp,2bps] x duration; preenche o par ate a
// quantidade do leg baixo (puxando de 1+ alvos na banda); consome; pares somem;
// loop. Sem contraparte na banda -> DIRETA/orfao (sai). Retorna {pares, sobra}.
//   par  = {puL, puH, qtd, mid, txMid, feeBps}
//   sobra= {pu, qtd}   (direta ou orfao)
export function varrer(grupos, D) {
  const fLo = FEE_LO * D, fHi = FEE_HI * D, fMid = (fLo + fHi) / 2
  const rem = grupos.map(g => ({ ...g })).sort((a, b) => a.pu - b.pu)
  const pares = [], sobra = []
  const vivos = () => rem.filter(g => g.qtd > 1e-6)
  let guard = 0
  while (guard++ < 100000) {
    const v = vivos(); if (!v.length) break
    const low = v[0], tLo = low.pu * (1 + fLo), tHi = low.pu * (1 + fHi), tgt = low.pu * (1 + fMid)
    const cands = rem.filter(g => g.qtd > 1e-6 && g.pu > low.pu && g.pu >= tLo && g.pu <= tHi).sort((a, b) => Math.abs(a.pu - tgt) - Math.abs(b.pu - tgt))
    const txLow = low.txN ? low.txSum / low.txN : null
    if (!cands.length) { sobra.push({ pu: low.pu, qtd: low.qtd }); low.qtd = 0; continue }
    let need = low.qtd
    for (const c of cands) {
      if (need <= 1e-6) break
      const m = Math.min(need, c.qtd), mid = (low.pu + c.pu) / 2
      const txC = c.txN ? c.txSum / c.txN : null, txMid = (txLow != null && txC != null) ? (txLow + txC) / 2 : (txLow != null ? txLow : txC)
      pares.push({ puL: low.pu, puH: c.pu, qtd: m, mid, txMid, feeBps: (c.pu / low.pu - 1) * 1e4 })
      need -= m; c.qtd -= m
    }
    if (need > 1e-6) sobra.push({ pu: low.pu, qtd: need })
    low.qtd = 0
  }
  return { pares, sobra }
}

// Agrega os pares de mercado de um ativo/dia -> volume, PU_mid e taxa_mid (vwap).
export function agregarMercado(pares) {
  const volMerc = pares.reduce((s, p) => s + p.qtd * p.mid, 0)
  const qM = pares.reduce((s, p) => s + p.qtd, 0)
  const comTx = pares.filter(p => p.txMid != null), qTx = comTx.reduce((s, p) => s + p.qtd, 0)
  return {
    volMerc, nPares: pares.length,
    puMid: qM > 0 ? pares.reduce((s, p) => s + p.mid * p.qtd, 0) / qM : null,
    txMid: qTx > 0 ? comTx.reduce((s, p) => s + p.txMid * p.qtd, 0) / qTx : null,
  }
}

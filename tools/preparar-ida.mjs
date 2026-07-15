// Coletor do historico dos indices IDA (Indice de Debentures ANBIMA) + calculo
// do SPREAD de credito AGREGADO do mercado.
//
// Fonte: arquivos ESTATICOS no S3 da ANBIMA (publicos, sem auth/token):
//   https://s3-data-prd-use1-precos.s3.us-east-1.amazonaws.com/arquivos/indices-historico/{CODIGO}-HISTORICO.xls
// Cada arquivo e' um xlsx (aba "Historico") com a serie DIARIA desde o inicio do
// indice: Numero Indice (nivel), variacoes (dia/mes/ano/12m/24m) e Duration.
//
// Saidas:
//   public/data/Ida_Historico.csv         (indices IDA: nivel/retornos/duration)
//   public/data/Ida_Spread_Historico.csv  (spread de credito agregado por data)
//   public/data/Ida_Meta.json             (updatedAt, fonte, indices, ancoras, metodo)
//
// SPREAD AGREGADO (o IDA e' retorno total, nao tem taxa/spread embutido):
//   - Excesso de retorno do indice de credito sobre o govt livre de risco
//     (IDA-DI vs IMA-S; IDA-IPCA vs IMA-B) -> sinal de REGIME (abre/fecha spread).
//   - Nivel IMPLICITO por decomposicao de retorno + duration, ancorado no spread
//     REAL de hoje (mediana do Anbima_Tx.csv): excesso = carrego - D*dSpread ->
//     dSpread = (carrego - excesso)/D, integrado de tras pra frente a partir do hoje.
//     Proxy AGREGADA (nao por ativo); ha' residuo de descasamento de duration IDA/IMA.
//
// Sem dependencias externas: le o xlsx (zip + XML) so' com modulos nativos.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')
const PUBLIC_DATA = join(PUBLIC, 'data')
const S3_BASE = 'https://s3-data-prd-use1-precos.s3.us-east-1.amazonaws.com/arquivos/indices-historico'

// Indices IDA (gravados em Ida_Historico.csv).
const INDICES = [
  { codigo: 'IDAGERAL',                nome: 'IDA-Geral' },
  { codigo: 'IDADI',                   nome: 'IDA-DI' },
  { codigo: 'IDAIPCA',                 nome: 'IDA-IPCA' },
  { codigo: 'IDAIPCAINFRAESTRUTURA',   nome: 'IDA-IPCA Infraestrutura' },
  { codigo: 'IDAIPCAEXINFRAESTRUTURA', nome: 'IDA-IPCA ex-Infraestrutura' },
]
// Benchmarks govt livres de risco (baixados so' pro calculo do spread).
const BENCH = [
  { codigo: 'IMAS', nome: 'IMA-S' },   // LFT/Selic -> livre de risco do CDI+
  { codigo: 'IMAB', nome: 'IMA-B' },   // NTN-B     -> livre de risco do IPCA+
]
// Pares credito x govt pro spread agregado.
//   ExcRet252 (regime, excesso de retorno anualizado) sai pra TODOS.
//   SpreadNivelBps (nivel implicito) so' pro CDI: la o livre de risco (IMA-S/LFT)
//   tem duration ~zero, entao o excesso e' credito PURO e a integracao fecha. No
//   IPCA a dinamica da curva de juro real (curva/convexidade/roll) NAO cancela e
//   se acumula na integracao longa -> nivel nao confiavel; so' regime. (O nivel
//   IPCA por ativo virah do arquivo diario de secundario, track a' parte.)
const PARES = [
  { par: 'CDI',       credito: 'IDADI',                 govt: 'IMAS', ancora: 'cdi',       nivel: true  },
  { par: 'IPCA',      credito: 'IDAIPCA',               govt: 'IMAB', ancora: 'ipca',      nivel: false },
  { par: 'IPCAINFRA', credito: 'IDAIPCAINFRAESTRUTURA', govt: 'IMAB', ancora: 'ipcaInfra', nivel: false },
]
const WIN = 252  // janela do excesso de retorno anualizado (dias uteis ~ 1 ano)

// ─── ZIP: le uma entrada pelo diretorio central (robusto a data-descriptor) ──
function zipEntries(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('EOCD nao encontrado (zip invalido)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compSize, localOff })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}
function zipRead(buf, entries, name) {
  const e = entries.get(name)
  if (!e) throw new Error(`entrada ${name} ausente no zip`)
  const nameLen = buf.readUInt16LE(e.localOff + 26)
  const extraLen = buf.readUInt16LE(e.localOff + 28)
  const start = e.localOff + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + e.compSize)
  return e.method === 0 ? Buffer.from(data) : inflateRawSync(data)
}
// ─── XLSX -> registros {data, ni, vd, vm, va, v12, v24, dur} ─────────────────
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function parseSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si>(.*?)<\/si>/gs)) {
    out.push(decodeXml([...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(x => x[1]).join('')))
  }
  return out
}
function serialToISO(n) { return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) }
function parseSheet(xml, shared) {
  const rows = []
  for (const rm of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells = {}
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?\st="([a-z]+)")?[^>]*>(?:<v>(.*?)<\/v>)?<\/c>/gs)) {
      cells[cm[1]] = cm[3] == null ? null : (cm[2] === 's' ? (shared[parseInt(cm[3], 10)] ?? '') : cm[3])
    }
    rows.push(cells)
  }
  return rows
}
function nz(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
async function fetchIndex(codigo) {
  const r = await fetch(`${S3_BASE}/${codigo}-HISTORICO.xls`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const entries = zipEntries(buf)
  const shared = parseSharedStrings(zipRead(buf, entries, 'xl/sharedStrings.xml').toString('utf8'))
  const sheet = entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()].find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const rows = parseSheet(zipRead(buf, entries, sheet).toString('utf8'), shared)
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]; if (c.B == null) continue
    out.push({ data: serialToISO(Number(c.B)), ni: nz(c.C), vd: nz(c.D), vm: nz(c.E), va: nz(c.F), v12: nz(c.G), v24: nz(c.H), dur: nz(c.I) })
  }
  return out
}

// ─── Ancoras: spread REAL de hoje (mediana do Anbima_Tx.csv por ativo) ───────
function splitCsvLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur); return out
}
function mediana(arr) {
  const a = arr.filter(x => Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
function parseNumPt(s) {
  if (s == null) return null
  let t = String(s).trim().replace(/%/g, '').trim()
  if (t === '' || t === '-' || t === '--') return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t); return Number.isFinite(n) ? n : null
}
// Mapa ticker -> incentivada (Lei 12.431) do Debentures.csv, pra separar a
// ancora do Infra (so' incentivadas) da ancora do IPCA amplo (todas).
function incentivadaMap() {
  const path = join(PUBLIC, 'Debentures.csv')
  const map = new Map()
  if (!existsSync(path)) return map
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  const H = splitCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, ''))
  const iCod = H.indexOf('Codigo do Ativo'), iInc = H.indexOf('Deb. Incent. (Lei 12.431)')
  if (iCod < 0 || iInc < 0) return map
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]).map(x => x.replace(/^"|"$/g, ''))
    const tk = (f[iCod] || '').trim().toUpperCase()
    if (tk) map.set(tk, (f[iInc] || '').trim().toUpperCase() === 'S')
  }
  return map
}
function ancoras() {
  // Retorna { cdi, ipca, ipcaInfra } em DECIMAL (0.021 = 2,1% = 210 bps).
  const path = join(PUBLIC, 'Anbima_Tx.csv')
  if (!existsSync(path)) return { cdi: null, ipca: null, ipcaInfra: null }
  const inc = incentivadaMap()
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  const H = splitCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, ''))
  const iTk = H.indexOf('ticker'), iIdx = H.indexOf('indexadorAnbima'), iTx = H.indexOf('txAnbimaFormatada'), iNtnb = H.indexOf('spreadNtnbBps')
  const cdi = [], ipca = [], ipcaInfra = []
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]).map(x => x.replace(/^"|"$/g, ''))
    const idx = (f[iIdx] || '').toUpperCase(), tx = f[iTx] || ''
    if (idx.startsWith('DI')) {                          // CDI+ : "CDI + 0,70%"
      const m = tx.match(/CDI\s*([+-])\s*([\d.,]+)\s*%/i)
      if (m) { const v = parseNumPt(m[2]); if (v != null) cdi.push((m[1] === '-' ? -v : v) / 100) }
    } else if (idx.startsWith('IPCA')) {                 // NTN-B+ : spreadNtnbBps
      const b = parseNumPt(f[iNtnb])
      if (b != null) { ipca.push(b / 10000); if (inc.get((f[iTk] || '').trim().toUpperCase())) ipcaInfra.push(b / 10000) }
    }
  }
  return { cdi: mediana(cdi), ipca: mediana(ipca), ipcaInfra: mediana(ipcaInfra),
           nCdi: cdi.length, nIpca: ipca.length, nInfra: ipcaInfra.length }
}

// ─── Spread agregado por par (regime + nivel implicito ancorado) ─────────────
function calcSpread(credito, govt, anchor, computeLevel) {
  // alinha por datas comuns (ordem crescente)
  const gmap = new Map(govt.map(r => [r.data, r]))
  const rows = credito.filter(r => gmap.has(r.data)).map(r => ({ c: r, g: gmap.get(r.data) }))
  const n = rows.length
  const exc = new Array(n).fill(null)   // excesso de retorno anualizado (regime), em %
  for (let i = WIN; i < n; i++) {
    const rc = rows[i].c.ni / rows[i - WIN].c.ni
    const rg = rows[i].g.ni / rows[i - WIN].g.ni
    exc[i] = (rc / rg - 1) * 100
  }
  // nivel implicito (bps): integra dSpread de tras pra frente ancorando no hoje.
  const nivel = new Array(n).fill(null)
  if (computeLevel && anchor != null && Number.isFinite(anchor) && n > 1) {
    nivel[n - 1] = anchor
    for (let i = n - 1; i >= 1; i--) {
      const excD = ((rows[i].c.vd ?? 0) - (rows[i].g.vd ?? 0)) / 100   // excesso do dia (decimal)
      const D = Math.max(0.1, (rows[i].c.dur ?? 252) / 252)            // duration em anos (piso p/ estabilidade)
      // exc = S_{t-1}/252 - D*(S_t - S_{t-1})  ->  S_{t-1} = (exc + D*S_t)/(D + 1/252)
      nivel[i - 1] = (excD + D * nivel[i]) / (D + 1 / 252)
    }
  }
  return rows.map((r, i) => ({
    data: r.c.data,
    exc: exc[i] == null ? '' : exc[i].toFixed(3),
    nivelBps: nivel[i] == null ? '' : Math.round(nivel[i] * 10000),
  }))
}

async function main() {
  mkdirSync(PUBLIC_DATA, { recursive: true })
  const series = {}   // codigo -> registros[]
  const metaIdx = []

  // 1) Indices IDA (+ Ida_Historico.csv)
  const csv = ['Codigo,Data,NumeroIndice,VarDiaria,VarMes,VarAno,Var12m,Var24m,Duration']
  for (const ix of [...INDICES, ...BENCH]) {
    try {
      const rows = await fetchIndex(ix.codigo)
      series[ix.codigo] = rows
      const isIda = INDICES.some(x => x.codigo === ix.codigo)
      if (isIda) {
        for (const r of rows) csv.push([ix.codigo, r.data, r.ni ?? '', r.vd ?? '', r.vm ?? '', r.va ?? '', r.v12 ?? '', r.v24 ?? '', r.dur ?? ''].join(','))
        metaIdx.push({ codigo: ix.codigo, nome: ix.nome, dias: rows.length, dataInicio: rows[0]?.data, dataFim: rows.at(-1)?.data })
      }
      console.log(`  [${ix.codigo}] ${rows.length} dias  ${rows[0]?.data} -> ${rows.at(-1)?.data}`)
    } catch (e) { console.error(`  [${ix.codigo}] FALHOU: ${e.message}`) }
  }
  writeFileSync(join(PUBLIC_DATA, 'Ida_Historico.csv'), csv.join('\n') + '\n')

  // 2) Ancoras (spread real de hoje) + spread agregado por par
  const anc = ancoras()
  const bps = x => x != null ? Math.round(x * 10000) : null
  console.log(`  ancoras hoje (bps): CDI+ ${bps(anc.cdi)} (${anc.nCdi || 0}) | NTN-B+ amplo ${bps(anc.ipca)} (${anc.nIpca || 0}) | NTN-B+ incentiv. ${bps(anc.ipcaInfra)} (${anc.nInfra || 0})`)
  const spCsv = ['Par,Data,ExcRet252,SpreadNivelBps']
  const metaPar = []
  for (const p of PARES) {
    const cr = series[p.credito], gv = series[p.govt]
    if (!cr || !gv) { console.error(`  [spread ${p.par}] serie ausente`); continue }
    const anchor = p.ancora === 'cdi' ? anc.cdi : p.ancora === 'ipcaInfra' ? anc.ipcaInfra : anc.ipca
    const out = calcSpread(cr, gv, anchor, p.nivel)
    for (const r of out) spCsv.push([p.par, r.data, r.exc, r.nivelBps].join(','))
    const ult = out.at(-1)
    console.log(`  [spread ${p.par}] ${out.length} dias  ${out[0]?.data} -> ${ult?.data}  exc12m=${ult?.exc}%  nivel=${p.nivel ? ult?.nivelBps + 'bps' : '(so regime)'}`)
    metaPar.push({ par: p.par, credito: p.credito, govt: p.govt, nivel: !!p.nivel, dias: out.length, ancoraBps: bps(anchor) })
  }
  writeFileSync(join(PUBLIC_DATA, 'Ida_Spread_Historico.csv'), spCsv.join('\n') + '\n')

  // 3) Meta
  writeFileSync(join(PUBLIC_DATA, 'Ida_Meta.json'), JSON.stringify({
    updatedAt: process.env.IDA_UPDATED_AT || new Date().toISOString(),
    fonte: 'ANBIMA - Indice de Debentures (IDA) + familia IMA, arquivos historicos S3 (indices-historico)',
    indices: metaIdx,
    spread: {
      metodo: 'ExcRet252 = excesso de retorno anualizado credito vs govt (REGIME, todos os pares). SpreadNivelBps = nivel implicito por decomposicao retorno+duration ancorado no spread real de hoje (mediana Anbima_Tx) — SO no CDI (IMA-S/LFT tem duration ~0 -> excesso e credito puro). No IPCA a curva de juro real nao cancela e se acumula na integracao -> so regime. Nivel IPCA por ativo virah do secundario diario. Ancoras: CDI+ e NTN-B+ amplo (todas IPCA) e NTN-B+ incentivadas (12.431).',
      ancorasBps: { cdi: bps(anc.cdi), ipca: bps(anc.ipca), ipcaInfra: bps(anc.ipcaInfra) },
      pares: metaPar,
    },
  }, null, 2) + '\n')
  console.log(`Gravado: Ida_Historico.csv (${csv.length - 1}) + Ida_Spread_Historico.csv (${spCsv.length - 1}) + Ida_Meta.json`)
}
main().catch(e => { console.error(e); process.exit(1) })

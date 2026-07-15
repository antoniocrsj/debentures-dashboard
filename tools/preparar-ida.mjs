// Coletor do historico dos indices IDA (Indice de Debentures ANBIMA).
//
// Fonte: arquivos ESTATICOS no S3 da ANBIMA (publicos, sem auth/token):
//   https://s3-data-prd-use1-precos.s3.us-east-1.amazonaws.com/arquivos/indices-historico/{CODIGO}-HISTORICO.xls
// Cada arquivo e' um xlsx (uma aba "Historico") com a serie DIARIA desde o inicio
// do indice: Numero Indice (nivel), variacoes (dia/mes/ano/12m/24m) e Duration.
//
// Indices coletados (regua de regime de mercado):
//   IDAGERAL  - mercado agregado de debentures
//   IDADI     - debentures indexadas ao CDI  (regua do Tradicional/CDI)
//   IDAIPCA   - debentures IPCA+
//   IDAIPCAINFRAESTRUTURA    - incentivadas 12.431 (regua do Incentivados)
//   IDAIPCAEXINFRAESTRUTURA  - IPCA ex-infra
//
// Saida:
//   public/data/Ida_Historico.csv   (Codigo,Data,NumeroIndice,VarDiaria,VarMes,VarAno,Var12m,Var24m,Duration)
//   public/data/Ida_Meta.json       (updatedAt, fonte, indices[] com periodo/linhas)
//
// Sem dependencias externas: le o xlsx (zip + XML) so' com modulos nativos.

import { writeFileSync, mkdirSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DATA = join(__dirname, '..', 'public', 'data')
const S3_BASE = 'https://s3-data-prd-use1-precos.s3.us-east-1.amazonaws.com/arquivos/indices-historico'

const INDICES = [
  { codigo: 'IDAGERAL',                nome: 'IDA-Geral' },
  { codigo: 'IDADI',                   nome: 'IDA-DI' },
  { codigo: 'IDAIPCA',                 nome: 'IDA-IPCA' },
  { codigo: 'IDAIPCAINFRAESTRUTURA',   nome: 'IDA-IPCA Infraestrutura' },
  { codigo: 'IDAIPCAEXINFRAESTRUTURA', nome: 'IDA-IPCA ex-Infraestrutura' },
]

// ─── ZIP: le uma entrada pelo diretorio central (robusto a data-descriptor) ──
function zipEntries(buf) {
  // acha o End Of Central Directory (assinatura PK\x05\x06), varrendo do fim
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('EOCD nao encontrado (zip invalido)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)   // offset do diretorio central
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
  // pula o local header (30 + nameLen + extraLen) e le compSize bytes
  const nameLen = buf.readUInt16LE(e.localOff + 26)
  const extraLen = buf.readUInt16LE(e.localOff + 28)
  const start = e.localOff + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + e.compSize)
  return e.method === 0 ? Buffer.from(data) : inflateRawSync(data)
}

// ─── XLSX: sharedStrings + celulas da aba (por letra de coluna) ──────────────
function parseSharedStrings(xml) {
  const out = []
  const re = /<si>(.*?)<\/si>/gs
  let m
  while ((m = re.exec(xml))) {
    // concatena todos os <t> dentro do <si> (rich text) e decodifica entidades
    const txt = [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(x => x[1]).join('')
    out.push(decodeXml(txt))
  }
  return out
}
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function colLetters(ref) { return ref.replace(/[0-9]+$/, '') }  // "B12" -> "B"

// serial Excel -> 'YYYY-MM-DD' (epoca 1899-12-30; 25569 dias ate' 1970-01-01)
function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400000)
  return new Date(ms).toISOString().slice(0, 10)
}

function parseSheet(xml, shared) {
  const rows = []
  for (const rm of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells = {}
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?\st="([a-z]+)")?[^>]*>(?:<v>(.*?)<\/v>)?<\/c>/gs)) {
      const col = cm[1], type = cm[2], v = cm[3]
      if (v == null) { cells[col] = null; continue }
      cells[col] = type === 's' ? (shared[parseInt(v, 10)] ?? '') : v
    }
    rows.push(cells)
  }
  return rows
}

async function fetchBuf(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : '' }

async function main() {
  mkdirSync(PUBLIC_DATA, { recursive: true })
  const linhas = ['Codigo,Data,NumeroIndice,VarDiaria,VarMes,VarAno,Var12m,Var24m,Duration']
  const meta = []

  for (const ix of INDICES) {
    const url = `${S3_BASE}/${ix.codigo}-HISTORICO.xls`
    let buf
    try { buf = await fetchBuf(url) }
    catch (e) { console.error(`  [${ix.codigo}] FALHOU: ${e.message}`); continue }

    const entries = zipEntries(buf)
    const shared = parseSharedStrings(zipRead(buf, entries, 'xl/sharedStrings.xml').toString('utf8'))
    // aba unica "Historico" -> sheet1; se nao, pega a primeira worksheet
    const sheetName = entries.has('xl/worksheets/sheet1.xml')
      ? 'xl/worksheets/sheet1.xml'
      : [...entries.keys()].find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    const rows = parseSheet(zipRead(buf, entries, sheetName).toString('utf8'), shared)

    let count = 0, dataIni = null, dataFim = null
    for (let i = 1; i < rows.length; i++) {   // linha 0 = cabecalho
      const c = rows[i]
      if (c.B == null) continue
      const data = serialToISO(Number(c.B))
      linhas.push([ix.codigo, data, num(c.C), num(c.D), num(c.E), num(c.F), num(c.G), num(c.H), num(c.I)].join(','))
      count++; if (!dataIni) dataIni = data; dataFim = data
    }
    console.log(`  [${ix.codigo}] ${count} dias  ${dataIni} -> ${dataFim}`)
    meta.push({ codigo: ix.codigo, nome: ix.nome, dias: count, dataInicio: dataIni, dataFim })
  }

  writeFileSync(join(PUBLIC_DATA, 'Ida_Historico.csv'), linhas.join('\n') + '\n')
  const stamp = process.env.IDA_UPDATED_AT || new Date().toISOString()
  writeFileSync(join(PUBLIC_DATA, 'Ida_Meta.json'), JSON.stringify({
    updatedAt: stamp,
    fonte: 'ANBIMA - Indice de Debentures (IDA), arquivos historicos S3 (indices-historico)',
    indices: meta,
  }, null, 2) + '\n')
  console.log(`Gravado: Ida_Historico.csv (${linhas.length - 1} linhas) + Ida_Meta.json`)
}

main().catch(e => { console.error(e); process.exit(1) })

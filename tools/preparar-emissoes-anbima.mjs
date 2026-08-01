// preparar-emissoes-anbima.mjs
// ---------------------------------------------------------------------------
// Converte o "Boletim de Mercado de Capitais" (xlsx, ANBIMA) na base estatica
// que o app consome no grafico de Emissoes da aba Tecnico:
//   public/Emissoes_ANBIMA.csv       (uma linha por mes: Mes,Total,Fundos)
//   public/Emissoes_ANBIMA_meta.json (data de referencia + conciliacao)
//
// FONTE: aba "08-05-Vlr-Det" = "Volume Subscritores RF" das DEBENTURES por tipo
// de investidor (rito "All"). Dela tiramos DOIS numeros por mes:
//   Total  = soma de TODOS os tipos de investidor (= emissao subscrita do mes;
//            bate com a aba 07-02 de emissao)
//   Fundos = coluna "Fundos de Investimento"
// Usar a MESMA aba para os dois garante Fundos <= Total (auto-consistente).
//
// Layout da aba (pivot): cabecalho na linha 13 -> col B = "Data" (rotulo
// "Mmm/AA" ou o ano), cols C..G = tipos de investidor. Linhas de ano (sem
// "/AA") sao ignoradas. Colunas casadas por TEXTO do cabecalho, nao por posicao.
//
// CUIDADO (documentado p/ o app): os 1-2 meses mais recentes SUBESTIMAM Fundos
// (ofertas nao "encerradas" ficam em "Intermediarios" e so' depois migram).
//
// Uso:  node tools/preparar-emissoes-anbima.mjs [caminho_do_xlsx]
//   sem argumento, procura o .xlsx mais recente em "Anbima - Boletim/".
// Dep: exceljs (devDependency; usada SO' aqui, nunca no bundle do app).

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const IN_DIR = path.join(ROOT, 'Anbima - Boletim')
const OUT_CSV = path.join(ROOT, 'public', 'Emissoes_ANBIMA.csv')
const OUT_META = path.join(ROOT, 'public', 'Emissoes_ANBIMA_meta.json')

const SHEET = '08-05-Vlr-Det'        // subscritores de debentures por tipo (rito All = todos)
const SHEET_12431 = '09-06-Vlr-Det'  // subscritores de debentures 12.431 por tipo
const HEADER_ROW = 13                // linha do cabecalho (Data | tipos de investidor)
const COL_DATA = 2                   // col B
// Total/Fundos = mercado TODO; Total12431/Fundos12431 = so' incentivadas.
// O Tradicional o app deriva (Total - Total12431). Assim o grafico reage ao
// toggle 12.431/Tradicional da aba Tecnico.
const COLS = ['Mes', 'Total', 'Fundos', 'Total12431', 'Fundos12431']

const MESES = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' }

const log = (m) => process.stdout.write(m + '\n')
const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function cellVal(cell) {
  const v = cell && cell.value
  if (v == null) return null
  if (typeof v === 'object') {
    if ('result' in v) return v.result
    if ('text' in v) return v.text
    if ('richText' in v) return v.richText.map(t => t.text).join('')
    return null
  }
  return v
}
function toNum(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/\s/g, '')
  const n = (s.includes(',') && s.includes('.')) ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
    : (s.includes(',') ? parseFloat(s.replace(',', '.')) : parseFloat(s))
  return Number.isFinite(n) ? n : 0
}
// Rotulo "Mmm/AA" -> "AAAA-MM"; linhas de ano (ou nao-mes) -> null.
export function monthKey(label) {
  const s = norm(label)
  const m = s.match(/^([a-z]{3})[a-z.]*[/\-]\s*(\d{2,4})$/)
  if (!m) return null
  const mm = MESES[m[1]]
  if (!mm) return null
  const yy = m[2].length === 2 ? '20' + m[2] : m[2]
  return `${yy}-${mm}`
}

// Descobre, na linha de cabecalho, os indices das colunas de valor (tipos de
// investidor) e qual e' a de "Fundos de Investimento". Robusto a reordenacao.
export function resolveHeader(sheet) {
  const row = sheet.getRow(HEADER_ROW)
  const valueCols = []
  let fundosCol = null
  row.eachCell((cell, col) => {
    if (col <= COL_DATA) return
    const h = norm(cellVal(cell))
    if (!h) return
    valueCols.push(col)
    if (h.startsWith('fundos')) fundosCol = col
  })
  if (!valueCols.length) throw new Error('sem colunas de tipo de investidor na linha ' + HEADER_ROW)
  if (!fundosCol) throw new Error('coluna "Fundos de Investimento" nao encontrada')
  return { valueCols, fundosCol }
}

// Le a aba de subscritores -> [{mes, total, fundos}] (ordenado por mes).
export function lerEmissoes(sheet) {
  const { valueCols, fundosCol } = resolveHeader(sheet)
  const out = []
  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const mk = monthKey(cellVal(row.getCell(COL_DATA)))
    if (!mk) continue
    const total = valueCols.reduce((s, c) => s + toNum(cellVal(row.getCell(c))), 0)
    const fundos = toNum(cellVal(row.getCell(fundosCol)))
    if (total <= 0 && fundos <= 0) continue
    out.push({ mes: mk, total: Math.round(total), fundos: Math.round(fundos) })
  }
  out.sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))
  return out
}

function listXlsx() {
  if (!fs.existsSync(IN_DIR)) return []
  return fs.readdirSync(IN_DIR)
    .filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map(f => { const full = path.join(IN_DIR, f); return { name: f, full, mtime: fs.statSync(full).mtimeMs } })
    .sort((a, b) => b.mtime - a.mtime)
}
function csvField(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"' }
function toCsv(rows) {
  const linhas = [COLS.map(csvField).join(',')]
  for (const r of rows) linhas.push([r.mes, r.total, r.fundos, r.total12431, r.fundos12431].map(csvField).join(','))
  return linhas.join('\r\n') + '\r\n'
}
function preservarAnterior(motivo) {
  const existe = fs.existsSync(OUT_CSV)
  log(`  AVISO: ${motivo}.`)
  log(existe ? '  PRESERVANDO o public/Emissoes_ANBIMA.csv anterior (nao sobrescreve).'
    : '  Sem snapshot anterior — o grafico de Emissoes fica sem dados (o app segue sem ele).')
  fs.writeFileSync(OUT_META, JSON.stringify({ fonte: null, preservado: existe, motivo, geradoEm: new Date().toISOString() }, null, 2) + '\n', 'utf8')
}

async function main() {
  log('')
  log('=== Preparar Emissoes ANBIMA (boletim de mercado de capitais) ===')
  const arg = process.argv[2]
  let file
  if (arg) {
    if (!fs.existsSync(arg)) { preservarAnterior(`arquivo nao encontrado: ${arg}`); return }
    file = { name: path.basename(arg), full: arg }
  } else {
    const cand = listXlsx()
    if (!cand.length) { preservarAnterior(`nenhum .xlsx em "${path.relative(ROOT, IN_DIR)}/"`); return }
    file = cand[0]
  }
  log(`  arquivo: ${file.name}`)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file.full)
  const sheetAll = wb.getWorksheet(SHEET)
  if (!sheetAll) { preservarAnterior(`sem a aba '${SHEET}' (nao parece o boletim ANBIMA)`); return }
  const sheet12431 = wb.getWorksheet(SHEET_12431)   // opcional: sem ela, 12.431 = 0

  let allRows, incRows
  try {
    allRows = lerEmissoes(sheetAll)
    incRows = sheet12431 ? lerEmissoes(sheet12431) : []
  } catch (e) { preservarAnterior(`falha ao ler subscritores: ${e.message}`); return }
  if (!allRows.length) { preservarAnterior('nenhum mes valido na aba'); return }

  // Junta por mes: mercado TODO (08-05) + incentivadas (09-06). Tradicional o
  // app deriva depois (Total - Total12431).
  const inc = new Map(incRows.map(r => [r.mes, r]))
  const rows = allRows.map(r => {
    const i = inc.get(r.mes)
    return { mes: r.mes, total: r.total, fundos: r.fundos, total12431: i ? i.total : 0, fundos12431: i ? i.fundos : 0 }
  })

  fs.writeFileSync(OUT_CSV, toCsv(rows), 'utf8')
  const ref = rows[rows.length - 1].mes
  const meta = {
    fonte: 'ANBIMA - Boletim de Mercado de Capitais (aba 08-05 Subscritores RF Debentures)',
    sourceFile: file.name,
    dataReferencia: ref,
    meses: rows.length,
    primeiroMes: rows[0].mes,
    ultimoMes: ref,
    geradoEm: new Date().toISOString(),
    preservado: false,
    aviso: 'Os 1-2 meses mais recentes subestimam Fundos (ofertas nao encerradas ficam em Intermediarios).',
  }
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  const ult = rows.slice(-6)
  const bi = v => (v / 1e9).toFixed(1)
  log(`  OK: ${rows.length} meses (${rows[0].mes} -> ${ref}) -> ${path.relative(ROOT, OUT_CSV)}`)
  log('  ultimos 6 meses (R$ bi) -- total (12.431 | trad) · fundos:')
  for (const r of ult) {
    log(`     ${r.mes}: ${bi(r.total)} (12.431 ${bi(r.total12431)} | trad ${bi(r.total - r.total12431)})  · fundos ${bi(r.fundos)} (12.431 ${bi(r.fundos12431)})`)
  }
}

// Roda so' quando chamado direto; ao ser importado por um teste, expoe os helpers.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { log('  ERRO: ' + e.message); process.exit(1) })
}

// preparar-anbima-be.mjs
// ---------------------------------------------------------------------------
// Converte o xlsx "PU Par + Prêmio" da ANBIMA (recompra antecipada / breakeven)
// numa base estatica e auditavel que o app consome:
//   public/Anbima_BE.csv       (uma linha por ticker, schema unico)
//   public/Anbima_BE_meta.json (data de referencia + conciliacao)
//
// Duas abas no xlsx:
//   "No Período de Exercício"   -> ativo JA pode ser recomprado  (status "Em exercício")
//   "Fora do Período de Exercício" -> exercicio FUTURO           (status "Futuro")
//
// Regras (ver enunciado): ticker trim+UPPER; datas -> YYYY-MM-DD; taxas como
// numero (ponto decimal); %PU Par como fator decimal (1.045245); nao inventar
// valores ('-' e vazio viram null, status mantido); localizar o xlsx valido mais
// recente por DATA DE REFERENCIA interna (nao pelo nome datado); preservar o
// ultimo Anbima_BE.csv valido se a planilha faltar/estiver invalida; reportar
// tickers da planilha ausentes em public/Debentures.csv (nunca silencioso).
//
// Uso: node tools/preparar-anbima-be.mjs
// Dep: exceljs (devDependency; usada SO' aqui, nunca no bundle do app).

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BE_DIR = path.join(ROOT, 'Anbima - BE')
const OUT_CSV = path.join(ROOT, 'public', 'Anbima_BE.csv')
const OUT_META = path.join(ROOT, 'public', 'Anbima_BE_meta.json')
const DEB_CSV = path.join(ROOT, 'public', 'Debentures.csv')

export const SHEETS = [
  { nome: 'No Período de Exercício', status: 'Em exercício', tipoTaxa: 'implícita' },
  { nome: 'Fora do Período de Exercício', status: 'Futuro', tipoTaxa: 'breakeven' },
]
// Colunas por ABA, casadas pelo TEXTO do cabecalho (linha 3), nao por posicao.
const MAP_EXERCICIO = {
  ticker: 'código', remuneracao: 'remuneração', dataEvento: 'próximo evento',
  taxaEvento: 'taxa pu par + prêmio no próximo evento', pctPuPar: '% pu par estimado no próximo evento',
}
const MAP_FUTURO = {
  ticker: 'código', remuneracao: 'remuneração', dataEvento: 'data início resgate',
  diasUteisAteEvento: 'dias úteis para o início do resgate', pctPuPar: '%pupar estimado', taxaEvento: 'taxa break even',
}
const COLS = ['ticker', 'statusExercicio', 'dataEvento', 'diasUteisAteEvento', 'pctPuPar', 'taxaEvento', 'tipoTaxa', 'remuneracao', 'dataReferencia', 'origemAba']

const log = (m) => process.stdout.write(m + '\n')
export const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
export const isMissing = (v) => v == null || ['', '-', '—', 'n/d', 'nd', 'na'].includes(String(v).trim().toLowerCase())

function cellVal(cell) {
  const v = cell && cell.value
  if (v == null) return null
  if (typeof v === 'object') {
    if (v instanceof Date) return v
    if ('result' in v) return v.result          // formula -> resultado
    if ('text' in v) return v.text              // hyperlink
    if ('richText' in v) return v.richText.map(t => t.text).join('')
    return null
  }
  return v
}
export function toISO(v) {
  if (isMissing(v)) return null
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}
export function toNum(v) {
  if (isMissing(v)) return null
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/\s/g, '').replace(/%$/, '')
  const n = (s.includes(',') && s.includes('.')) ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
    : (s.includes(',') ? parseFloat(s.replace(',', '.')) : parseFloat(s))
  return Number.isFinite(n) ? n : null
}
// Cabecalho -> indice da coluna (na linha 3), casando por texto normalizado.
function headerIndex(sheet, headerRow = 3) {
  const row = sheet.getRow(headerRow)
  const idx = {}
  row.eachCell((cell, col) => { idx[norm(cellVal(cell))] = col })
  return idx
}
function resolveCols(idx, mapa) {
  const out = {}
  for (const [campo, header] of Object.entries(mapa)) {
    const col = idx[norm(header)]
    if (!col) throw new Error(`coluna '${header}' nao encontrada (aba tem: ${Object.keys(idx).join(' | ')})`)
    out[campo] = col
  }
  return out
}

// --- Localiza o xlsx valido mais recente por DATA DE REFERENCIA interna --------
function listXlsx() {
  if (!fs.existsSync(BE_DIR)) return []
  return fs.readdirSync(BE_DIR)
    .filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map(f => { const full = path.join(BE_DIR, f); return { name: f, full, mtime: fs.statSync(full).mtimeMs } })
}
async function abrirEValidar(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file.full)
  for (const s of SHEETS) if (!wb.getWorksheet(s.nome)) throw new Error(`sem a aba '${s.nome}'`)
  // data de referencia = celula B1 da 1a aba (rotulo "Data"/"Data:") -> ISO
  const ref = toISO(cellVal(wb.getWorksheet(SHEETS[0].nome).getRow(1).getCell(2)))
  if (!ref) throw new Error('sem data de referencia (B1) legivel')
  return { wb, ref, file }
}

// --- Leitura de uma aba -> registros normalizados -----------------------------
// Normaliza uma linha CRUA (valores de celula) para o schema unico. Puro e
// testavel: aplica ticker UPPER/trim, datas -> ISO, numeros (negativo preservado),
// '-'/vazio -> null, e a classificacao (status/tipoTaxa) vem do cfg da aba.
export function normalizarRegistro(raw, cfg, dataRef) {
  return {
    ticker: String(raw.ticker).trim().toUpperCase(),
    statusExercicio: cfg.status,
    dataEvento: toISO(raw.dataEvento),
    diasUteisAteEvento: raw.diasUteisAteEvento === undefined ? null : toNum(raw.diasUteisAteEvento),
    pctPuPar: toNum(raw.pctPuPar),
    taxaEvento: toNum(raw.taxaEvento),
    tipoTaxa: cfg.tipoTaxa,
    remuneracao: isMissing(raw.remuneracao) ? '' : String(raw.remuneracao).trim(),
    dataReferencia: dataRef,
    origemAba: cfg.nome,
  }
}

function lerAba(wb, cfg, mapa, dataRef) {
  const sheet = wb.getWorksheet(cfg.nome)
  const cols = resolveCols(headerIndex(sheet), mapa)
  const registros = []
  const HEADER_ROW = 3
  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const rawTicker = cellVal(row.getCell(cols.ticker))
    if (isMissing(rawTicker)) continue
    registros.push(normalizarRegistro({
      ticker: rawTicker,
      remuneracao: cellVal(row.getCell(cols.remuneracao)),
      dataEvento: cellVal(row.getCell(cols.dataEvento)),
      diasUteisAteEvento: cols.diasUteisAteEvento ? cellVal(row.getCell(cols.diasUteisAteEvento)) : undefined,
      pctPuPar: cellVal(row.getCell(cols.pctPuPar)),
      taxaEvento: cellVal(row.getCell(cols.taxaEvento)),
    }, cfg, dataRef))
  }
  return registros
}

function csvField(v) {
  if (v == null) return '""'
  return '"' + String(v).replace(/"/g, '""') + '"'
}
function toCsv(registros) {
  const linhas = [COLS.map(csvField).join(',')]
  for (const reg of registros) {
    linhas.push(COLS.map(c => {
      const v = reg[c]
      if (v == null) return '""'
      return csvField(v)   // numeros viram string com ponto decimal (Number->String)
    }).join(','))
  }
  return linhas.join('\r\n') + '\r\n'
}

function tickersDoCadastro() {
  if (!fs.existsSync(DEB_CSV)) return null
  const txt = fs.readFileSync(DEB_CSV, 'utf8')
  const linhas = txt.replace(/\r/g, '').split('\n').filter(Boolean)
  if (linhas.length < 2) return new Set()
  const set = new Set()
  for (let i = 1; i < linhas.length; i++) {
    const m = linhas[i].match(/^"([^"]*)"/)   // 1a coluna = Codigo do Ativo
    if (m && m[1].trim()) set.add(m[1].trim().toUpperCase())
  }
  return set
}

function preservarAnterior(motivo, extraMeta = {}) {
  const existe = fs.existsSync(OUT_CSV)
  log(`  AVISO: ${motivo}.`)
  log(existe ? '  PRESERVANDO o public/Anbima_BE.csv anterior (nao sobrescreve).'
    : '  Sem snapshot anterior — a base de recompra/BE fica indisponivel (o app segue sem ela).')
  const meta = { fonte: null, dataReferencia: null, preservado: existe, motivo, geradoEm: new Date().toISOString(), ...extraMeta }
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n', 'utf8')
}

async function main() {
  log('')
  log('=== Preparar base ANBIMA recompra/breakeven (PU Par + Premio) ===')
  const candidatos = listXlsx()
  if (candidatos.length === 0) { preservarAnterior('nenhum .xlsx em "Anbima - BE/"'); return }

  // Abre cada candidato, valida estrutura e le a data de referencia; escolhe a
  // MAIOR data de referencia (empate: mtime mais novo). Determinístico e por
  // conteudo, sem depender do nome datado.
  const validos = []
  for (const c of candidatos) {
    try { validos.push(await abrirEValidar(c)) }
    catch (e) { log(`  ignorado '${c.name}': ${e.message}`) }
  }
  if (validos.length === 0) { preservarAnterior('nenhum .xlsx valido (estrutura/data de referencia)'); return }
  validos.sort((a, b) => (a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : b.file.mtime - a.file.mtime))
  const escolhido = validos[0]
  log(`  ${candidatos.length} arquivo(s); usando: ${escolhido.file.name} (ref ${escolhido.ref})`)

  // Le as duas abas.
  const emExerc = lerAba(escolhido.wb, SHEETS[0], MAP_EXERCICIO, escolhido.ref)
  const futuro = lerAba(escolhido.wb, SHEETS[1], MAP_FUTURO, escolhido.ref)

  // Dedup: cada ticker no MAXIMO uma vez. As abas nao devem se sobrepor; se
  // houver colisao, mantemos a 1a (Em exercicio) e reportamos.
  const vistos = new Map()
  const dupsEntreAbas = []
  const registros = []
  for (const reg of [...emExerc, ...futuro]) {
    if (vistos.has(reg.ticker)) { dupsEntreAbas.push(reg.ticker); continue }
    vistos.set(reg.ticker, true); registros.push(reg)
  }

  if (registros.length === 0) { preservarAnterior('planilha sem registros validos', { sourceFile: escolhido.file.name }); return }

  // Conciliacao com o cadastro de debentures.
  const cadastro = tickersDoCadastro()
  const naoEncontrados = cadastro ? registros.filter(r => !cadastro.has(r.ticker)).map(r => r.ticker) : []
  const incompletos = registros.filter(r => r.taxaEvento == null || r.dataEvento == null).map(r => r.ticker)

  // Grava CSV + meta.
  fs.writeFileSync(OUT_CSV, toCsv(registros), 'utf8')
  const meta = {
    fonte: 'ANBIMA PU Par + Premio (xlsx)',
    sourceFile: escolhido.file.name,
    dataReferencia: escolhido.ref,
    geradoEm: new Date().toISOString(),
    total: registros.length,
    emExercicio: emExerc.length,
    futuro: futuro.length,
    tickersNoCadastro: cadastro ? registros.length - naoEncontrados.length : null,
    tickersNaoEncontrados: naoEncontrados,
    registrosIncompletos: incompletos,
    dupsEntreAbas,
    preservado: false,
  }
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  // Relatorio (resumo tecnico).
  log(`  OK: ${registros.length} ativos -> ${path.relative(ROOT, OUT_CSV)}`)
  log(`     Em exercício: ${emExerc.length} | Futuro: ${futuro.length}`)
  log(`     no cadastro: ${cadastro ? registros.length - naoEncontrados.length : 'n/d (Debentures.csv ausente)'} | nao encontrados: ${naoEncontrados.length}`)
  if (naoEncontrados.length) log('       ' + naoEncontrados.slice(0, 20).join(', ') + (naoEncontrados.length > 20 ? ` … (+${naoEncontrados.length - 20})` : ''))
  log(`     registros incompletos (sem taxa/data): ${incompletos.length}` + (incompletos.length ? ' -> ' + incompletos.slice(0, 20).join(', ') : ''))
  if (dupsEntreAbas.length) log(`     ATENCAO tickers em ambas as abas (mantida a 1a): ${dupsEntreAbas.join(', ')}`)
}

// Roda o pipeline so' quando chamado direto (node tools/preparar-anbima-be.mjs);
// ao ser importado por um teste, apenas expoe os helpers puros acima.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { log('  ERRO: ' + e.message); process.exit(1) })
}

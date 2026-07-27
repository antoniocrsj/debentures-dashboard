// preparar-reune-curvas-historico.mjs
// --------------------------------------------------------------------------
// BACKFILL historico da curva TPF (REUNE_Curvas.csv) a partir do Tesouro Direto /
// Tesouro Transparente. A API da ANBIMA (preparar-reune-curvas.ps1) so' devolve ~5
// dias de precos, entao nao consegue cobrir historico longo. Este script usa o
// dataset publico do Tesouro (sem auth/captcha), que traz o historico COMPLETO de
// taxas por titulo e data.
//
//   NTN-B (curva IPCA)  <- "Tesouro IPCA+" / "Tesouro IPCA+ com Juros Semestrais"
//   LTN   (curva pre)   <- "Tesouro Prefixado"
//   taxa = media (compra+venda)/2  (proxy da indicativa ANBIMA)
//
// INCREMENTAL e NAO-DESTRUTIVO: mantem as datas ja' presentes em REUNE_Curvas
// (tipicamente os dias recentes vindos da ANBIMA, com a ETTJ interpolada, mais
// densa) e so' adiciona as datas do REUNE_Historico que ainda faltam. O Tesouro
// traz so' os vencimentos NEGOCIADOS (curva mais esparsa que a da ANBIMA), entao
// o "vencimento de referencia mais proximo" pode ser um pouco mais grosso -- ok
// p/ historico. Autorizado pelo usuario (fonte publica).
//
// Uso: node tools/preparar-reune-curvas-historico.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const HIST = path.join(PUBLIC, 'REUNE_Historico.csv')
const CURVAS = path.join(PUBLIC, 'REUNE_Curvas.csv')
const META = path.join(PUBLIC, 'REUNE_Curvas_meta.json')
const URL_TD = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv'

const isoToBR = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const brToIso = br => { const [d, m, y] = br.split('/'); return `${y}-${m}-${d}` }
// col Data e' o 2o campo do CSV quoted do REUNE_Historico: "TICKER","YYYY-MM-DD",...
function datasDoHistorico() {
  const linhas = fs.readFileSync(HIST, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  const s = new Set()
  for (const l of linhas) { const m = l.match(/^"[^"]*","(\d{4}-\d{2}-\d{2})"/); if (m) s.add(m[1]) }
  return [...s].sort()
}
function curvasExistentes() {
  if (!fs.existsSync(CURVAS)) return { linhas: [], datas: new Set() }
  const linhas = fs.readFileSync(CURVAS, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  const datas = new Set()
  for (const l of linhas) { const m = l.match(/^"(\d{4}-\d{2}-\d{2})"/); if (m) datas.add(m[1]) }
  return { linhas, datas }
}

async function main() {
  console.log('\n=== Backfill historico da curva TPF (Tesouro Direto) ===')
  const datasHist = datasDoHistorico()
  const { linhas: linhasExist, datas: datasExist } = curvasExistentes()
  const faltantes = datasHist.filter(d => !datasExist.has(d))
  console.log(`  REUNE: ${datasHist.length} data(s) | ja' na curva: ${datasExist.size} | faltando: ${faltantes.length}`)
  if (!faltantes.length) { console.log('  Nada a fazer (curva ja cobre todo o historico).'); return }

  const alvoBR = new Set(faltantes.map(isoToBR))   // Data Base (DD/MM/YYYY) a capturar
  console.log('  Baixando Tesouro Direto (stream + filtro)...')

  const res = await fetch(URL_TD)
  if (!res.ok) throw new Error(`Tesouro Direto HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = '', primeira = true
  const novas = []   // linhas no formato de REUNE_Curvas
  const num = s => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null }

  const processarLinha = (linha) => {
    if (primeira) { primeira = false; return }         // cabecalho
    if (!linha) return
    const c = linha.split(';')
    if (c.length < 5) return
    const dataBase = c[2].trim()
    if (!alvoBR.has(dataBase)) return
    const tipo = c[0].trim()
    const ehNtnb = tipo.includes('IPCA')
    const ehLtn = tipo === 'Tesouro Prefixado'
    if (!ehNtnb && !ehLtn) return
    const compra = num(c[3]), venda = num(c[4])
    const mid = (compra != null && venda != null) ? (compra + venda) / 2
      : (venda != null ? venda : compra)
    if (mid == null) return
    const venc = c[1].trim()
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(venc) || !/^\d{2}\/\d{2}\/\d{4}$/.test(dataBase)) return
    novas.push(`"${brToIso(dataBase)}","${ehNtnb ? 'NTN-B' : 'LTN'}","${brToIso(venc)}","${mid.toFixed(4)}"`)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      processarLinha(buf.slice(0, nl).replace(/\r$/, ''))
      buf = buf.slice(nl + 1)
    }
  }
  if (buf) processarLinha(buf.replace(/\r$/, ''))

  const datasNovas = new Set(novas.map(l => l.slice(1, 11)))
  console.log(`  Tesouro: ${novas.length} ponto(s) em ${datasNovas.size} data(s).`)

  // Merge NAO-destrutivo + ordena por data (linha ISO ordena lexicograficamente).
  const todas = [...linhasExist, ...novas].sort()
  fs.writeFileSync(CURVAS, '"data","tipo","vencimento","taxa"\n' + todas.join('\n') + '\n', 'utf8')

  const cobertas = datasHist.filter(d => datasExist.has(d) || datasNovas.has(d)).length
  const meta = {
    fonte: 'MISTA: ANBIMA Data API (dias recentes, ETTJ interpolada) + Tesouro Transparente / Tesouro Direto (backfill historico, media compra/venda por vencimento negociado)',
    totalPontos: todas.length,
    datasCobertas: cobertas,
    datasHistorico: datasHist.length,
    datasSemCurva: datasHist.filter(d => !datasExist.has(d) && !datasNovas.has(d)),
    obs: 'NTN-B = Tesouro IPCA+; LTN = Tesouro Prefixado. Tesouro traz so os vencimentos negociados (mais esparso que a ETTJ da ANBIMA).',
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  fs.writeFileSync(META, JSON.stringify(meta, null, 4) + '\n', 'utf8')
  console.log(`  OK: ${todas.length} ponto(s), ${cobertas}/${datasHist.length} data(s) cobertas -> ${CURVAS}`)
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })

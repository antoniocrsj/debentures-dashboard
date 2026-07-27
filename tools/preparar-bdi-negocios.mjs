// preparar-bdi-negocios.mjs
// --------------------------------------------------------------------------
// Puxa o tape TRADE-A-TRADE de DEBENTURES da B3 ("Negocio a Negocio", tabela
// 528 do BDI / DATA VISUALIZATION) e mantem um arquivo por pregao em
// public/bdi/DEB_AAAA-MM-DD.csv + um manifesto public/bdi/index.json.
//
// POR QUE UM ARQUIVO POR DIA: sao ~6.3 mil negocios de debenture POR PREGAO;
// 90 pregoes dariam ~570 mil linhas (~50 MB) num CSV unico -- pesado demais p/
// servir no browser. Por dia, cada arquivo fica ~600 KB e o app carrega sob
// demanda so' o pregao em foco (dado intraday, granularidade individual).
//
// FONTE (publica, sem auth/captcha): gateway do BDI da B3. Descoberta por
// engenharia reversa do SPA (config.serverUrl=/bdi). A rota de dados e' POST:
//   POST https://arquivos.b3.com.br/bdi/table/Trade/{dini}/{dfim}/{pagina}/{take}
//   Content-Type: application/json   Body: {}   (o corpo {} = sem filtro)
// Retorna { table:{ columns, values, pageCount, ... }, lastUpdateDate }.
// values = array de arrays; filtramos col[2] == 'DEB'. take maximo = 1000.
// Calendario de pregoes: GET /bdi/table/workdays?date=<hoje>&hasHistory=true
// (lista decrescente a partir de hoje). Autorizado pelo usuario (fonte publica).
//
// INCREMENTAL: um pregao ja' gravado e' pulado; os 2 pregoes mais recentes sao
// sempre refeitos (a B3 ajusta os negocios em D+1). Dedup por Cod. do negocio.
//
// Uso:
//   node tools/preparar-bdi-negocios.mjs           (ultimos 90 pregoes)
//   node tools/preparar-bdi-negocios.mjs 30        (ultimos 30 pregoes)

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUTDIR = path.join(ROOT, 'public', 'bdi')
const INDEX = path.join(OUTDIR, 'index.json')

const BASE = 'https://arquivos.b3.com.br/bdi'
const TAKE = 1000                 // teto do endpoint
const REFRESH_RECENTES = 2        // sempre refaz os N pregoes mais recentes (ajuste D+1)
const DIAS = Math.max(1, parseInt(process.argv[2] || '90', 10))

// Colunas uteis do tape (indices na resposta). Descartamos as 3 "Data negocio"
// duplicadas (1,11), o InstrumentType (2, sempre DEB aqui) e o IdSer (16).
//  0 Data | 3 Emissor | 4 CodIF | 5 Qtd | 6 Preco | 7 Volume | 8 Taxa
//  9 Origem | 10 Horario | 12 Cod.negocio | 13 ISIN | 14 Liquidacao | 15 Situacao
const COLS = ['Data', 'Ativo', 'Emissor', 'Quantidade', 'Preco', 'Volume',
  'Taxa', 'Origem', 'Horario', 'IdNegocio', 'ISIN', 'Liquidacao', 'Situacao']

// O fetch do Node (undici) as vezes estoura um assert interno (`!this.paused`)
// sob muitas requisicoes sequenciais -- vem como excecao NAO-capturavel pelo
// try/catch do await. Saimos limpo (exit 1) p/ o laco externo re-rodar; como o
// puxador e' incremental, ele retoma de onde parou (pula dias ja' gravados).
process.on('uncaughtException', e => { console.error('  [uncaught]', e?.message || e); process.exit(1) })
process.on('unhandledRejection', e => { console.error('  [unhandled]', e?.message || e); process.exit(1) })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isoDate = s => (s == null ? '' : String(s).slice(0, 10))   // "..T00:00:00" -> "YYYY-MM-DD"
const csvField = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
const numStr = v => (v == null || v === '' ? '' : String(v))     // mantem ponto decimal cru

async function fetchJson(url, init, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, init)
      if (r.ok) return await r.json()
      if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1)); continue }
      throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      if (i === tentativas - 1) throw e
      await sleep(600 * (i + 1))
    }
  }
}

const postInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }

// Pega os N pregoes mais recentes (calendario oficial da B3, decrescente).
async function pregoesRecentes(n) {
  const hoje = new Date().toISOString().slice(0, 10)
  const arr = await fetchJson(`${BASE}/table/workdays?date=${hoje}&hasHistory=true`, undefined)
  const dias = [...new Set(arr.map(isoDate))].filter(d => d && d <= hoje).sort().reverse()
  return dias.slice(0, n)
}

// Puxa TODOS os negocios de DEBENTURE de um pregao (pagina a pagina), dedup por
// Cod. do negocio. Retorna { linhas:[[...COLS]], stats }.
async function puxarDia(dia) {
  const vistos = new Set()
  const linhas = []
  let volume = 0
  const ativos = new Set()
  let page = 1, pageCount = 1
  do {
    const j = await fetchJson(`${BASE}/table/Trade/${dia}/${dia}/${page}/${TAKE}`, postInit)
    pageCount = j?.table?.pageCount || 1
    const vals = j?.table?.values || []
    for (const v of vals) {
      if (v[2] !== 'DEB') continue
      const id = String(v[12] ?? '')
      const chave = id || `${v[4]}|${v[10]}|${v[7]}`   // fallback se sem id
      if (vistos.has(chave)) continue
      vistos.add(chave)
      linhas.push([
        isoDate(v[0]), v[4] ?? '', v[3] ?? '', numStr(v[5]), numStr(v[6]),
        numStr(v[7]), numStr(v[8]), v[9] ?? '', v[10] ?? '', id, v[13] ?? '',
        isoDate(v[14]), v[15] ?? '',
      ])
      const vol = parseFloat(v[7]); if (Number.isFinite(vol)) volume += vol
      if (v[4]) ativos.add(v[4])
    }
    page++
    await sleep(40)
  } while (page <= pageCount)
  // ordena por horario (col 8 dos COLS = indice 8) p/ leitura cronologica
  linhas.sort((a, b) => (a[8] < b[8] ? -1 : a[8] > b[8] ? 1 : 0))
  return { linhas, stats: { trades: linhas.length, ativos: ativos.size, volume: Math.round(volume) } }
}

// Gravado como .csv.gz (o tape e' grande: ~155 MB cru em 90 dias -> ~20 MB
// gzipado). O browser descompacta nativo com DecompressionStream ao consumir.
const arqDia = dia => path.join(OUTDIR, `DEB_${dia}.csv.gz`)

function gravarDia(dia, linhas) {
  const buf = [COLS.join(',')]
  for (const l of linhas) buf.push(l.map(csvField).join(','))
  fs.writeFileSync(arqDia(dia), zlib.gzipSync(buf.join('\n') + '\n', { level: 9 }))
}

function contarTrades(dia) {
  try {
    const txt = zlib.gunzipSync(fs.readFileSync(arqDia(dia))).toString('utf8')
    return Math.max(0, txt.split('\n').filter(Boolean).length - 1)
  } catch { return 0 }
}

async function main() {
  console.log('\n=== Preparar BDI Negocio a Negocio (debentures, trade-a-trade) ===')
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true })

  const dias = await pregoesRecentes(DIAS)
  if (!dias.length) { console.error('  Nenhum pregao retornado pela B3.'); process.exit(1) }
  console.log(`  Alvo: ${dias.length} pregoes (${dias[dias.length - 1]} .. ${dias[0]})`)

  const naRecente = new Set(dias.slice(0, REFRESH_RECENTES))
  const byDay = {}
  let baixados = 0, pulados = 0

  for (const dia of dias) {
    if (fs.existsSync(arqDia(dia)) && !naRecente.has(dia)) {
      byDay[dia] = { trades: contarTrades(dia) }   // reaproveita; conta p/ o manifesto
      pulados++
      continue
    }
    process.stdout.write(`  ${dia} ... `)
    try {
      const { linhas, stats } = await puxarDia(dia)
      gravarDia(dia, linhas)
      byDay[dia] = stats
      baixados++
      console.log(`${stats.trades} negocios | ${stats.ativos} ativos | vol R$ ${stats.volume.toLocaleString('pt-BR')}`)
    } catch (e) {
      console.log(`FALHOU (${e.message})`)
    }
  }

  const diasOk = Object.keys(byDay).sort().reverse()
  const totalTrades = diasOk.reduce((s, d) => s + (byDay[d].trades || 0), 0)
  const manifesto = {
    fonte: 'B3 BDI / DATA VISUALIZATION -- tabela 528 "Negocio a Negocio" (trade-a-trade), filtro DEB. POST /bdi/table/Trade/{dini}/{dfim}/{pag}/{take} body {}.',
    colunas: COLS,
    formato: 'csv.gz (gzip; descompactar com DecompressionStream no browser)',
    take: TAKE,
    dias: diasOk.length,
    data_recente: diasOk[0] || null,
    data_antiga: diasOk[diasOk.length - 1] || null,
    total_trades: totalTrades,
    por_dia: byDay,
    gerado_em: new Date().toISOString(),
  }
  fs.writeFileSync(INDEX, JSON.stringify(manifesto, null, 2) + '\n', 'utf8')

  console.log(`\n  OK: ${diasOk.length} pregoes (${baixados} baixados, ${pulados} reaproveitados), ${totalTrades.toLocaleString('pt-BR')} negocios DEB.`)
  console.log(`  -> ${path.relative(ROOT, OUTDIR)}\\DEB_*.csv.gz  +  index.json`)
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })

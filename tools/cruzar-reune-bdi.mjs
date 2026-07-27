// cruzar-reune-bdi.mjs
// --------------------------------------------------------------------------
// Cruza REUNE (ANBIMA) x BDI Negocio-a-Negocio (B3) por Ativo x Data para:
//   (1) VOLUME: por um numero R$ real de volume onde o REUNE so' tem FAIXA
//       ("Ate 1MM" / "Entre 1MM e 5MM" / "Superior a 5MM").
//   (2) PU: confrontar o "PU Medio" do REUNE contra o VWAP do BDI (robustez).
//
// REUNE  = public/REUNE_Historico.csv (Ativo,Data,Tx min/med/max,PU Medio,Faixa)
//          -- ja' filtrado por dispersao + so' DEB. E' um SUBCONJUNTO de ativos.
// BDI    = public/bdi/DEB_*.csv.gz (cada negocio; Volume = Preco*Qtd).
//          origem "...Voice" (corretora, tem taxa) vs "Registro" (bloco, 00:00).
//          VWAP = sum(Volume)/sum(Qtd). Comparamos PU do REUNE com a NEGOCIACAO
//          (voice), e reportamos volume voice E total.
//
// Saida: um CSV de cruzamento (arg 1 ou scratchpad) + um resumo no console.
// Uso: node tools/cruzar-reune-bdi.mjs [saida.csv]

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const REUNE = path.join(ROOT, 'public', 'REUNE_Historico.csv')
const BDIDIR = path.join(ROOT, 'public', 'bdi')
const OUT = process.argv[2] || path.join(ROOT, 'REUNE_BDI_Cruzamento.csv')

const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : null }
const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }
const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p / 100 * b.length))] }
const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

// -- REUNE: mapa "Ativo|Data" -> {pu, faixa, txMed}
function lerReune() {
  const L = fs.readFileSync(REUNE, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  const m = new Map()
  const datas = new Set()
  for (const l of L) {
    const c = l.match(/"((?:[^"]|"")*)"/g)
    if (!c || c.length < 7) continue
    const f = c.map(x => x.slice(1, -1))
    const [ativo, data, , txMed, , puMedio, faixa] = f
    m.set(`${ativo}|${data}`, { pu: num(puMedio), faixa, txMed: num(txMed) })
    datas.add(data)
  }
  return { reune: m, datas }
}

// -- BDI de um dia: agrega por Ativo -> voice/all (vol, qtd, precos, taxa)
function agregarDiaBDI(dia) {
  const p = path.join(BDIDIR, `DEB_${dia}.csv.gz`)
  if (!fs.existsSync(p)) return null
  const txt = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8')
  const L = txt.split(/\r?\n/).slice(1).filter(Boolean)
  const agg = new Map()   // ativo -> acumuladores
  for (const l of L) {
    const c = l.match(/"((?:[^"]|"")*)"/g); if (!c || c.length < 13) continue
    const f = c.map(x => x.slice(1, -1))
    // COLS: Data,Ativo,Emissor,Qtd,Preco,Volume,Taxa,Origem,Horario,IdNeg,ISIN,Liq,Sit
    const ativo = f[1], qtd = num(f[3]), preco = num(f[4]), vol = num(f[5]), taxa = num(f[6]), origem = f[7]
    if (qtd == null || vol == null) continue
    const voice = /voice/i.test(origem) || taxa != null
    let a = agg.get(ativo)
    if (!a) { a = { volAll: 0, qtdAll: 0, nAll: 0, volV: 0, qtdV: 0, nV: 0, precosV: [], taxasV: [] }; agg.set(ativo, a) }
    a.volAll += vol; a.qtdAll += qtd; a.nAll++
    if (voice) { a.volV += vol; a.qtdV += qtd; a.nV++; if (preco != null) a.precosV.push(preco); if (taxa != null) a.taxasV.push(taxa) }
  }
  return agg
}

function main() {
  console.log('\n=== Cruzamento REUNE x BDI (Ativo x Data) ===')
  const { reune, datas } = lerReune()
  const diasBDI = fs.readdirSync(BDIDIR).filter(f => /^DEB_\d{4}-\d{2}-\d{2}\.csv\.gz$/.test(f)).map(f => f.slice(4, 14))
  const setBDI = new Set(diasBDI)

  const linhas = [['Ativo', 'Data', 'REUNE_PU', 'BDI_VWAP_voice', 'BDI_PUmedSimples_voice',
    'deltaPU_pct', 'REUNE_Faixa', 'BDI_Vol_voice', 'BDI_Vol_total', 'BDI_nTrades_voice',
    'BDI_nTrades_total', 'REUNE_TxMed', 'BDI_TxMed_voice'].join(',')]

  const deltasVwap = [], deltasMean = []
  const faixaVol = { 'Até 1MM': [], 'Entre 1MM e 5MM': [], 'Superior a 5MM': [] }   // vol voice real por faixa
  let matched = 0, semBDIdia = 0, semAtivoNoBDI = 0

  // itera so' as datas do REUNE que existem no BDI
  for (const dia of [...datas].sort()) {
    if (!setBDI.has(dia)) { // conta pares REUNE nesse dia sem BDI
      for (const k of reune.keys()) if (k.endsWith('|' + dia)) semBDIdia++
      continue
    }
    const agg = agregarDiaBDI(dia)
    for (const [k, rv] of reune) {
      if (!k.endsWith('|' + dia)) continue
      const ativo = k.slice(0, k.length - dia.length - 1)
      const a = agg.get(ativo)
      if (!a || a.nV === 0) { semAtivoNoBDI++; continue }
      const vwap = a.qtdV > 0 ? a.volV / a.qtdV : null
      const puMean = med(a.precosV)
      const txMed = med(a.taxasV)
      const dV = (vwap != null && rv.pu) ? (vwap - rv.pu) / rv.pu * 100 : null
      const dM = (puMean != null && rv.pu) ? (puMean - rv.pu) / rv.pu * 100 : null
      if (dV != null) { deltasVwap.push(Math.abs(dV)); if (faixaVol[rv.faixa]) faixaVol[rv.faixa].push(a.volV) }
      if (dM != null) deltasMean.push(Math.abs(dM))
      matched++
      linhas.push([ativo, dia,
        rv.pu != null ? rv.pu.toFixed(4) : '',
        vwap != null ? vwap.toFixed(4) : '',
        puMean != null ? puMean.toFixed(4) : '',
        dV != null ? dV.toFixed(3) : '',
        rv.faixa,
        Math.round(a.volV), Math.round(a.volAll), a.nV, a.nAll,
        rv.txMed != null ? rv.txMed.toFixed(2) : '',
        txMed != null ? txMed.toFixed(2) : '',
      ].join(','))
    }
  }

  fs.writeFileSync(OUT, linhas.join('\n') + '\n', 'utf8')

  // ---- Resumo ----
  const totReune = reune.size
  console.log(`\n  REUNE: ${totReune} pares Ativo x Data | BDI dias: ${setBDI.size}`)
  console.log(`  Cruzados (match c/ negociacao voice no BDI): ${matched}`)
  console.log(`  Sem dia no BDI (fora da janela): ${semBDIdia} | Ativo REUNE sem voice no BDI no dia: ${semAtivoNoBDI}`)

  console.log(`\n  --- PU: |REUNE_PU vs BDI| (% do PU) ---`)
  console.log(`  VWAP   : mediana ${med(deltasVwap)?.toFixed(3)}% | p90 ${pct(deltasVwap, 90)?.toFixed(3)}% | n=${deltasVwap.length}`)
  console.log(`  MedSimp: mediana ${med(deltasMean)?.toFixed(3)}% | p90 ${pct(deltasMean, 90)?.toFixed(3)}%`)
  const conc = deltasVwap.filter(d => d <= 0.5).length
  console.log(`  |delta VWAP| <= 0,5% em ${conc}/${deltasVwap.length} (${(conc / deltasVwap.length * 100).toFixed(1)}%)`)

  console.log(`\n  --- VOLUME real (BDI voice) por FAIXA do REUNE ---`)
  for (const fx of ['Até 1MM', 'Entre 1MM e 5MM', 'Superior a 5MM']) {
    const v = faixaVol[fx]
    if (!v.length) { console.log(`  ${fx.padEnd(18)}: (sem amostra)`); continue }
    console.log(`  ${fx.padEnd(18)}: n=${v.length} | mediana ${brl(med(v))} | p10 ${brl(pct(v, 10))} | p90 ${brl(pct(v, 90))}`)
  }
  console.log(`\n  -> ${path.relative(ROOT, OUT)}`)
}

main()

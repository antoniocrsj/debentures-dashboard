// preparar-pl-media180.mjs
// ---------------------------------------------------------------------------
// Media do PL dos ULTIMOS 180 DIAS (diaria, "de cota") por fundo, para o
// patrimonio de referencia do enquadramento 12.431. Antes usavamos a media de 6
// fotos de FIM DE MES (Caixa_Potencial_Historico), que engana: perde a variacao
// intra-mes e pondera errado fundos que captaram em datas especificas. O correto
// e' a media diaria dos ultimos 180 dias corridos, com base no Informe Diario
// da CVM (VL_PATRIM_LIQ por dia; soma subclasses por classe/dia).
//
// Saida: public/data/Fundos_PL_Media180.csv (CNPJ, Ref, Media180, NDias), onde
// Ref e' 'AAAAMM' (media terminando no fim daquele mes) ou 'HOJE' (ultima data).
// O enquadramento usa a Ref do mes-alvo (passado) ou 'HOJE' (mes corrente/futuro).
//
// Universo: os fundos de Caixa_Potencial_Fundos.csv (curados). Fonte: zips do
// Informe Diario (inf_diario_fi_AAAAMM.zip) em CvmDir.
//
// Uso: node tools/preparar-pl-media180.mjs [--cvm "C:\...\CVM _informe_diario"]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', 'public', 'data')
const OUT = path.join(DATA, 'Fundos_PL_Media180.csv')
const JANELA_DIAS = 180   // dias corridos

function argCvm() {
  const i = process.argv.indexOf('--cvm')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env.CVM_INFORME_DIR || ('C:\\Projeto Cr' + String.fromCharCode(233) + 'dito\\CVM _informe_diario')
}
const CVM = argCvm()
const digits = s => String(s || '').replace(/\D/g, '')
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const dayMs = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null }
const monthEndMs = yyyymm => { const y = +yyyymm.slice(0, 4), mo = +yyyymm.slice(4, 6); return Date.UTC(y, mo, 0) }

async function main() {
  // universo (CNPJs de Caixa_Potencial)
  const cxFile = path.join(DATA, 'Caixa_Potencial_Fundos.csv')
  if (!fs.existsSync(cxFile)) { console.error('[media180] sem Caixa_Potencial_Fundos.csv'); return }
  const alvo = new Set()
  { const lines = fs.readFileSync(cxFile, 'utf8').split(/\r?\n/).filter(l => l.length)
    const iC = lines[0].split(',').indexOf('CNPJ')
    for (let i = 1; i < lines.length; i++) { const c = digits(lines[i].split(',')[iC]); if (c) alvo.add(c) } }
  if (!alvo.size) { console.error('[media180] universo vazio'); return }

  if (!fs.existsSync(CVM)) { console.error(`[media180] Informe Diario nao encontrado em "${CVM}". Pulei.`); return }
  const zips = fs.readdirSync(CVM).filter(f => /^inf_diario_fi_\d{6}\.zip$/i.test(f)).sort()
  if (!zips.length) { console.error('[media180] nenhum inf_diario_fi_*.zip'); return }

  // serie diaria por fundo: cnpj -> Map(dayMs -> soma VL_PATRIM_LIQ das subclasses)
  const serie = new Map()
  let maxDia = 0
  for (const zname of zips) {
    const dir = await unzipper.Open.file(path.join(CVM, zname))
    const csv = dir.files.find(f => /\.csv$/i.test(f.path)); if (!csv) continue
    const txt = (await csv.buffer()).toString('latin1')
    const nl = txt.indexOf('\n'); const header = txt.slice(0, nl).split(';')
    const iC = header.indexOf('CNPJ_FUNDO_CLASSE') >= 0 ? header.indexOf('CNPJ_FUNDO_CLASSE') : header.indexOf('CNPJ_FUNDO')
    const iD = header.indexOf('DT_COMPTC'), iP = header.indexOf('VL_PATRIM_LIQ')
    if (iC < 0 || iD < 0 || iP < 0) { console.error(`  ${zname}: cabecalho inesperado, pulado`); continue }
    let pos = nl + 1
    const N = txt.length
    while (pos < N) {
      let end = txt.indexOf('\n', pos); if (end < 0) end = N
      const line = txt.charCodeAt(end - 1) === 13 ? txt.slice(pos, end - 1) : txt.slice(pos, end)
      pos = end + 1
      if (!line) continue
      const c = line.split(';')
      if (c.length <= iP) continue
      const cnpj = digits(c[iC]); if (!alvo.has(cnpj)) continue
      const ms = dayMs(c[iD]); if (ms == null) continue
      const pl = num(c[iP])
      let m = serie.get(cnpj); if (!m) { m = new Map(); serie.set(cnpj, m) }
      m.set(ms, (m.get(ms) || 0) + pl)   // soma subclasses do mesmo dia
      if (ms > maxDia) maxDia = ms
    }
  }
  console.error(`[media180] ${serie.size} fundo(s) com serie diaria | ultima data ${new Date(maxDia).toISOString().slice(0, 10)}`)

  // datas de referencia: fim de cada mes coberto + HOJE (ultima data do informe)
  const mesesRef = []
  { const first = [...serie.values()].reduce((mn, m) => Math.min(mn, ...m.keys()), Infinity)
    let d = new Date(first)
    let y = d.getUTCFullYear(), mo = d.getUTCMonth()
    // comeca 6 meses depois do 1o dado (antes disso a janela de 180d fica curta)
    let cur = Date.UTC(y, mo + 6, 0)
    while (cur <= maxDia) { mesesRef.push({ ref: `${new Date(cur).getUTCFullYear()}${String(new Date(cur).getUTCMonth() + 1).padStart(2, '0')}`, ms: cur }); cur = Date.UTC(new Date(cur).getUTCFullYear(), new Date(cur).getUTCMonth() + 2, 0) }
  }
  const refs = mesesRef.concat([{ ref: 'HOJE', ms: maxDia }])

  // media diaria trailing 180d por fundo x ref
  const media = (dias, fimMs) => {
    const ini = fimMs - JANELA_DIAS * 86400000
    let soma = 0, n = 0
    for (const [ms, pl] of dias) { if (ms > ini && ms <= fimMs) { soma += pl; n++ } }
    return n ? { m: soma / n, n } : null
  }
  const rows = []
  for (const [cnpj, dias] of serie) {
    for (const r of refs) {
      const mm = media(dias, r.ms); if (!mm) continue
      rows.push(`${cnpj},${r.ref},${Math.round(mm.m)},${mm.n}`)
    }
  }
  fs.writeFileSync(OUT, 'CNPJ,Ref,Media180,NDias\r\n' + rows.join('\r\n') + '\r\n', 'utf8')
  console.error(`[media180] refs: ${refs.map(r => r.ref).join(', ')}`)
  console.error(`[media180] ${rows.length} linha(s) -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main().catch(e => { console.error('[media180] erro:', e.message); process.exitCode = 1 })

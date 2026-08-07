// backfill-pl-hist-cda.mjs
// ---------------------------------------------------------------------------
// Backfill ÚNICO da história do CDA para 2021-2022, só o PL (patrimônio), pra
// DATAR a 1ª cota real dos fundos que já existiam antes de jan/23. Sem isso, o
// CDA local começa em jan/23 e TODO fundo pré-2023 é carimbado com 1ª cota =
// jan/23 → "faz 24 meses" junto em jan/25 (torre artificial no "PL Ref (Fim da
// Carência)" e degrau no "PL Ref (Por Idade)"). Com 2021-2022, cada um cruza 24m
// no mês verdadeiro. (O piso passa a ser jan/21; fundos ainda mais velhos seguem
// no piso, mas cruzam 24m em jan/23 — fora da janela dos gráficos.)
//
// A CVM guarda o CDA pré-2023 como zips ANUAIS em .../CDA/DADOS/HIST, e o PL vem
// num único CSV por ano (cda_fi_PL_AAAA.csv) com DT_COMPTC (fim de mês). Este
// script FATIA por mês e grava CDA/cda_extraido_AAAAMM/cda_fi_PL_AAAAMM.csv, no
// formato que preparar-primeira-cota.mjs já lê (CNPJ_FUNDO + VL_PATRIM_LIQ).
//
// Baixe os zips uma vez (≈275 MB) e rode apontando a pasta deles:
//   curl -L -o cda_fi_2021.zip https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/HIST/cda_fi_2021.zip
//   curl -L -o cda_fi_2022.zip https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/HIST/cda_fi_2022.zip
//   node tools/backfill-pl-hist-cda.mjs <pasta-dos-zips>
// Depois: preparar-primeira-cota.mjs → preparar-{enquadramento,demanda-movel,
// captacao-liquida}-12431.mjs (todos consomem a 1ª cota). É one-time: os PL
// mensais ficam no CDA e o painel diário não precisa reexecutar este passo.
import fs from 'node:fs'
import path from 'node:path'
import unzipper from 'unzipper'

const CDA = process.env.CDA_DIR || ('C:\\Projeto Cr' + String.fromCharCode(233) + 'dito\\CVM _cda')
const SP = process.argv[2]
const ANOS = ['2021', '2022']

async function main() {
  if (!SP) { console.error('uso: node tools/backfill-pl-hist-cda.mjs <pasta-com-cda_fi_2021.zip-e-2022.zip>'); process.exitCode = 1; return }
  let total = 0
  for (const y of ANOS) {
    const zpath = path.join(SP, `cda_fi_${y}.zip`)
    if (!fs.existsSync(zpath)) { console.error(`[hist] falta ${zpath} (baixe do HIST da CVM)`); continue }
    const dir = await unzipper.Open.file(zpath)
    const e = dir.files.find(f => new RegExp(`cda_fi_PL_${y}\\.csv$`, 'i').test(f.path))
    if (!e) { console.error(`[hist] sem cda_fi_PL_${y}.csv em ${zpath}`); continue }
    const txt = (await e.buffer()).toString('latin1')
    const nl = txt.indexOf('\n')
    const header = txt.slice(0, nl).replace(/\r$/, '')
    const iD = header.split(';').indexOf('DT_COMPTC')
    if (iD < 0) { console.error(`[hist] cda_fi_PL_${y}.csv sem DT_COMPTC`); continue }
    const buckets = new Map()
    let pos = nl + 1; const N = txt.length
    while (pos < N) {
      let end = txt.indexOf('\n', pos); if (end < 0) end = N
      const line = txt.charCodeAt(end - 1) === 13 ? txt.slice(pos, end - 1) : txt.slice(pos, end)
      pos = end + 1; if (!line) continue
      const c = line.split(';'); if (c.length <= iD) continue
      const mes = c[iD].slice(0, 4) + c[iD].slice(5, 7)
      if (!/^\d{6}$/.test(mes)) continue
      let arr = buckets.get(mes); if (!arr) { arr = []; buckets.set(mes, arr) }
      arr.push(line)
    }
    for (const [mes, arr] of [...buckets].sort()) {
      const outDir = path.join(CDA, `cda_extraido_${mes}`)
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, `cda_fi_PL_${mes}.csv`), header + '\r\n' + arr.join('\r\n') + '\r\n', 'latin1')
      console.log(`  ${mes}: ${arr.length} linhas`)
      total++
    }
  }
  console.log(`[hist] ${total} mês(es) de PL gravado(s) no CDA. Rode preparar-primeira-cota.mjs em seguida.`)
}
main().catch(e => { console.error('[hist] erro:', e.message); process.exitCode = 1 })

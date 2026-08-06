// preparar-primeira-cota.mjs
// ---------------------------------------------------------------------------
// Descobre a DATA DA 1ª COTA de cada fundo = 1º mês em que ele aparece com
// PL > 0 no CDA da CVM (cda_fi_PL_AAAAMM.csv). É o proxy correto da 1ª
// integralização: "sem cota o fundo ainda não existe". O registro CVM
// (Fundos_Atributos.Data_Inicio) costuma anteceder a 1ª cota em vários meses,
// o que envelhecia o fundo cedo demais e inflava o enquadramento (carência 6m
// e degrau 24m começando antes da hora).
//
// Saída: public/data/Fundos_PrimeiraCota.csv (CNPJ, PrimeiraCotaMes, PrimeiraCotaData).
// Restrito ao universo do app (CNPJs de Caixa_Potencial_Fundos.csv).
//
// Uso:  node tools/preparar-primeira-cota.mjs [--cda "C:\Projeto Credito\CVM _cda"]
// O diretório do CDA vem de --cda, do env CDA_DIR, ou do default abaixo.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public')
const DATA = path.join(PUB, 'data')
const OUT = path.join(DATA, 'Fundos_PrimeiraCota.csv')

// Diretório do CDA (mesmo do preparar-blc.ps1). Overridável por --cda / CDA_DIR.
function argCda() {
  const i = process.argv.indexOf('--cda')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env.CDA_DIR || ('C:\\Projeto Cr' + String.fromCharCode(233) + 'dito\\CVM _cda')
}
const CDA = argCda()

const digits = s => String(s || '').replace(/\D/g, '')
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }

function main() {
  // universo: CNPJs de Caixa_Potencial (o que o app acompanha)
  const alvo = new Set()
  const cxFile = path.join(DATA, 'Caixa_Potencial_Fundos.csv')
  if (fs.existsSync(cxFile)) {
    const lines = fs.readFileSync(cxFile, 'utf8').split(/\r?\n/).filter(l => l.length)
    const head = lines[0].split(',')
    const iC = head.indexOf('CNPJ')
    for (let i = 1; i < lines.length; i++) { const c = digits(lines[i].split(',')[iC]); if (c) alvo.add(c) }
  }
  if (!alvo.size) { console.error('[primeira-cota] sem Caixa_Potencial_Fundos.csv — nada a fazer'); return }

  if (!fs.existsSync(CDA)) {
    console.error(`[primeira-cota] CDA não encontrado em "${CDA}". Pulei (o enquadramento cai no registro CVM).`)
    return
  }
  // meses disponíveis: pastas cda_extraido_AAAAMM, em ordem crescente
  const meses = fs.readdirSync(CDA)
    .map(d => /^cda_extraido_(\d{6})$/.exec(d))
    .filter(Boolean).map(m => m[1]).sort()
  if (!meses.length) { console.error('[primeira-cota] nenhuma pasta cda_extraido_* no CDA'); return }

  const first = {}   // cnpj -> 'AAAAMM' (1ª aparição com PL>0)
  let lidos = 0
  for (const mes of meses) {
    const f = path.join(CDA, `cda_extraido_${mes}`, `cda_fi_PL_${mes}.csv`)
    if (!fs.existsSync(f)) continue
    const lines = fs.readFileSync(f, 'latin1').split(/\r?\n/)
    if (!lines.length) continue
    const H = lines[0].split(';')
    // CVM renomeou a coluna no fim de 2023: meses antigos = CNPJ_FUNDO,
    // 202312+ = CNPJ_FUNDO_CLASSE. Aceita as duas.
    const iC = H.indexOf('CNPJ_FUNDO_CLASSE') >= 0 ? H.indexOf('CNPJ_FUNDO_CLASSE') : H.indexOf('CNPJ_FUNDO')
    const iP = H.indexOf('VL_PATRIM_LIQ')
    if (iC < 0 || iP < 0) continue
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(';'); if (cells.length <= iP) continue
      const c = digits(cells[iC])
      if (!alvo.has(c) || first[c]) continue          // já achado -> 1ª aparição vence
      if (num(cells[iP]) > 0) first[c] = mes
    }
    lidos++
  }

  const linhas = Object.entries(first)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, mes]) => `${c},${mes},${mes.slice(0, 4)}-${mes.slice(4, 6)}-01`)
  const csv = 'CNPJ,PrimeiraCotaMes,PrimeiraCotaData\r\n' + linhas.join('\r\n') + '\r\n'
  fs.writeFileSync(OUT, csv, 'utf8')

  const semCota = [...alvo].filter(c => !first[c]).length
  console.log(`[primeira-cota] ${meses.length} mês(es) de CDA (${meses[0]}..${meses[meses.length - 1]}), ${lidos} PL lidos`)
  console.log(`  1ª cota encontrada p/ ${linhas.length} fundo(s) | sem cota no CDA: ${semCota} (cairão no registro CVM)`)
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main()

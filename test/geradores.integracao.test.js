// Testes de INTEGRACAO dos geradores Node (gerar-periodos / gerar-relatorios).
// Rodam os scripts reais contra os dados de public/ e verificam determinismo
// (idempotencia) e as contagens dos indices. Pulam graciosamente se as bases
// nao estiverem presentes (ex.: checkout parcial), para nunca quebrar o CI puro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const R = p => path.join(ROOT, p)
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
// Estes testes RODAM os geradores reais e reescrevem arquivos em public/reports/.
// Por isso ficam atras de um gate (RUN_GEN_TESTS=1) para o `npm test` padrao
// nunca sujar a arvore de trabalho. Rode-os de proposito com:
//   RUN_GEN_TESTS=1 node --test test/geradores.integracao.test.js
const temBases =
  fs.existsSync(R('public/data/Fluxo_Diario_12431.csv')) &&
  fs.existsSync(R('public/reports/snapshots/anbima'))
const ativo = process.env.RUN_GEN_TESTS === '1' && temBases
const runNode = script => execFileSync('node', [R(script)], { cwd: ROOT, encoding: 'utf8' })

test('periodos: indices com 5 semanas e 5 meses + idempotencia (testes 12 e 14)', { skip: !ativo }, () => {
  runNode('tools/gerar-periodos.mjs')
  const wA = fs.readFileSync(R('public/reports/weekly/index.json'), 'utf8')
  const mA = fs.readFileSync(R('public/reports/monthly/index.json'), 'utf8')
  const idxW = JSON.parse(wA), idxM = JSON.parse(mA)

  assert.equal(idxW.reports.length, 5, 'indice semanal com 5 periodos')
  assert.equal(idxM.reports.length, 5, 'indice mensal com 5 periodos')
  // Sem ids duplicados no indice.
  assert.equal(new Set(idxW.reports.map(r => r.id)).size, 5)
  assert.equal(new Set(idxM.reports.map(r => r.id)).size, 5)
  // Cada entrada aponta pra um json/html existente com os campos exigidos.
  for (const r of [...idxW.reports, ...idxM.reports]) {
    for (const k of ['id', 'label', 'de', 'ate', 'status', 'json', 'html', 'sourceDates']) {
      assert.ok(k in r, `entrada do indice tem ${k}`)
    }
    assert.ok(['partial', 'closed'].includes(r.status), 'status parcial/fechado')
    assert.ok(fs.existsSync(R(r.json.replace(/^\//, 'public/'))), `existe ${r.json}`)
    assert.ok(fs.existsSync(R(r.html.replace(/^\//, 'public/'))), `existe ${r.html}`)
  }

  // Idempotencia: rodar de novo produz indices byte-a-byte identicos e um
  // relatorio de amostra tambem identico (nada de duplicacao/rewrite espurio).
  const amostra = R(idxW.reports[0].json.replace(/^\//, 'public/'))
  const repA = fs.readFileSync(amostra, 'utf8')
  runNode('tools/gerar-periodos.mjs')
  assert.equal(fs.readFileSync(R('public/reports/weekly/index.json'), 'utf8'), wA, 'indice semanal estavel')
  assert.equal(fs.readFileSync(R('public/reports/monthly/index.json'), 'utf8'), mA, 'indice mensal estavel')
  assert.equal(fs.readFileSync(amostra, 'utf8'), repA, 'relatorio de amostra estavel')
})

test('diario: preserva 5 relatorios + snapshots de fronteira apos re-rodar (teste 13)', { skip: !ativo }, () => {
  const snapDir = R('public/reports/snapshots/anbima')
  const antes = new Set(fs.readdirSync(snapDir))
  runNode('tools/gerar-relatorios.mjs')
  const idx = readJson(R('public/reports/daily/index.json'))
  assert.ok(idx.reports.length >= 1 && idx.reports.length <= 5, 'no maximo 5 relatorios diarios')
  assert.equal(new Set(idx.reports.map(r => r.date)).size, idx.reports.length, 'sem datas duplicadas')
  // A poda ciente de fronteira nunca remove um snapshot ja existente aqui (todos
  // recentes/fronteira); confirma que nenhum foi perdido.
  const depois = new Set(fs.readdirSync(snapDir))
  for (const f of antes) assert.ok(depois.has(f), `snapshot ${f} preservado`)
})

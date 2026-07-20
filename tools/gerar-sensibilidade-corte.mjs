// gerar-sensibilidade-corte.mjs
// --------------------------------------------------------------------------
// Varre o corte de %Deb (10%-80%) e soma a captacao REAL do universo candidato
// nesse corte -- nunca uma estimativa. Fontes:
//   tools/Universo_Candidatos.csv        (selecionar-fundos.ps1: CNPJ -> %Deb)
//   public/data/Fluxo_Diario_Candidatos.csv (preparar-fluxo.ps1 -IncluirCandidatos)
// Saida: public/data/Sensibilidade_Corte_Deb.json
//
// Se as fontes nao existirem (usuario ainda nao rodou selecionar-fundos.ps1 +
// preparar-fluxo.ps1 -IncluirCandidatos), o script AVISA e sai sem erro -- best
// effort, nao trava o pipeline principal (mesmo padrao de gerar-relatorios.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCSV } from '../src/utils/csv.js'
import { parseNum } from '../src/utils/format.js'
import { cortesRange, aggSensibilidade } from '../src/utils/sensibilidade.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const TOOLS = __dirname
const DATA = path.join(ROOT, 'public', 'data')
const digits = s => String(s || '').replace(/\D/g, '')
const readCsv = f => (fs.existsSync(f) ? (() => { try { return parseCSV(fs.readFileSync(f, 'utf8')) } catch { return [] } })() : null)

const JANELAS = { total: null, '12m': 12, '6m': 6 }

function main() {
  const universoPath = path.join(TOOLS, 'Universo_Candidatos.csv')
  const fluxoPath = path.join(DATA, 'Fluxo_Diario_Candidatos.csv')
  const universoRows = readCsv(universoPath)
  const fluxoRows = readCsv(fluxoPath)
  if (!universoRows || !fluxoRows) {
    console.log('  Sensibilidade de corte: fontes ausentes (rode selecionar-fundos.ps1 e preparar-fluxo.ps1 -IncluirCandidatos primeiro). Pulando.')
    return
  }
  if (!universoRows.length || !fluxoRows.length) {
    console.log('  Sensibilidade de corte: fontes vazias. Pulando.')
    return
  }

  const universo = universoRows.map(r => ({
    cnpj: digits(r.CNPJ_FUNDO_CLASSE), segmento: (r.Segmento || '').trim(),
    pctDeb: parseNum(r.Pct_Debentures), pl: parseNum(r.PL),
  })).filter(u => u.cnpj)
  const fluxo = fluxoRows.map(r => ({
    dia: r.Dia, cnpj: digits(r.CNPJ_Fundo),
    captacao: parseNum(r.Captacao), resgate: parseNum(r.Resgate), pl: parseNum(r.PL),
  })).filter(r => r.dia && r.cnpj)

  const cortes = cortesRange(10, 80, 1)
  const resultado = aggSensibilidade({ universo, fluxo, cortes, janelas: JANELAS })

  const out = {
    geradoEm: new Date().toISOString(),
    anchorKey: resultado.anchorKey,
    cortes: resultado.cortes,
    janelas: Object.keys(JANELAS),
    universoTotal: universo.length,
    porSegmento: resultado.porSegmento,
  }
  ensureDir(DATA)
  fs.writeFileSync(path.join(DATA, 'Sensibilidade_Corte_Deb.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
  const n12431 = universo.filter(u => u.segmento === '12431').length
  const nCdi = universo.length - n12431
  console.log(`  Sensibilidade de corte: ${cortes.length} pontos (10%-80%) x ${Object.keys(JANELAS).length} janelas | universo: ${n12431} (12.431) + ${nCdi} (Tradicional) | ancora: ${resultado.anchorKey}`)
  console.log('  -> public/data/Sensibilidade_Corte_Deb.json')
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }

main()

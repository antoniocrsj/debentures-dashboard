// varredura-mercado.mjs
// --------------------------------------------------------------------------
// Gera a base MERCADO VERDADEIRO: separa trade a mercado de direta no tape BDI
// (Negocio a Negocio, DEB) e calcula volume, taxa_mid e SPREAD (CDI+/NTN-B+) por
// ativo x DATA DE LIQUIDACAO (jul/2026: era data-do-trade). Sem relevancia minima,
// banda 0,7-2,3 bps. Logica em lib-mercado.mjs; ver METODOLOGIA_Mercado_Verdadeiro.md.
// Uso: node tools/varredura-mercado.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { gruposPorLiquidacao, durationDe, varrer, agregarMercado, spreadDe,
  lerAnbima, lerVenc, lerCurvas } from './lib-mercado.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB = path.join(ROOT, 'public'), BDIDIR = path.join(PUB, 'bdi')
const OUT = path.join(PUB, 'Mercado_Verdadeiro.csv'), META = path.join(PUB, 'Mercado_Verdadeiro_meta.json')

const anbima = lerAnbima(PUB), vencDeb = lerVenc(PUB), curvas = lerCurvas(PUB)
const dias = fs.readdirSync(BDIDIR).filter(f => /^DEB_\d{4}-\d{2}-\d{2}\.csv\.gz$/.test(f)).map(f => f.slice(4, 14)).sort()
const porLiqDia = gruposPorLiquidacao(BDIDIR, dias)   // Map(liqISO -> Map(ativo -> grupos[]))
const liqDatas = [...porLiqDia.keys()].sort()

console.log(`\n=== Varredura MERCADO x DIRETA + spread (BDI DEB, ${dias.length} pregoes -> ${liqDatas.length} datas de liquidacao) ===`)
// 'Data' = data de LIQUIDACAO (nao data do trade). So' as colunas que o app usa
// (enrichMercado) -- o diagnostico dobrado/sobra/pct/nNeg saiu p/ enxugar o CSV
// (vem do tape cru via lupa-mercado + dos totais no meta).
const COLS = ['Data', 'Ativo', 'Indexador', 'DurationAnos', 'VolMercado',
  'PU_mid', 'Taxa_mid', 'RefSpread', 'Spread', 'SpreadFmt']
const linhas = [COLS.join(',')]
let gDobrado = 0, gMercado = 0, gAtivosDia = 0, gSemDur = 0, gComSpread = 0

for (const dia of liqDatas) {          // 'dia' = data de LIQUIDACAO
  const porAtivo = porLiqDia.get(dia)
  for (const [ativo, grupos] of porAtivo) {
    const volDobrado = grupos.reduce((s, g) => s + g.vol, 0)
    // relevancia >10MM REMOVIDA (jul/2026): todo ativo-dia entra.
    const dd = durationDe(ativo, dia, anbima, vencDeb); if (!dd) { gSemDur++; continue }
    gDobrado += volDobrado; gAtivosDia++
    const { pares } = varrer(grupos, dd.D)
    const a = agregarMercado(pares)
    const sp = a.volMerc > 0 ? spreadDe(ativo, dia, a.txMid, dd.idx, anbima, vencDeb, curvas) : null
    if (sp) gComSpread++
    gMercado += a.volMerc
    // Grava so' ativo-dia COM mercado. Os 100% direta (volMerc=0) nao tem nada p/ o
    // app mostrar (enrichMercado ja' filtra volMerc>0) e triplicavam o CSV. O
    // denominador economico (gDobrado) ja' contou todos acima -- pct do meta segue certo.
    if (a.volMerc <= 0) continue
    linhas.push([dia, ativo, dd.idx || '', dd.D.toFixed(2),
      Math.round(a.volMerc), a.puMid != null ? a.puMid.toFixed(4) : '', a.txMid != null ? a.txMid.toFixed(4) : '',
      sp ? sp.rot : '', sp ? sp.num : '', sp ? sp.fmt : ''].join(','))
  }
}

fs.writeFileSync(OUT, linhas.join('\n') + '\n', 'utf8')
const econGlobal = gDobrado / 2
const datasBase = [...new Set(linhas.slice(1).map(l => l.slice(0, 10)))].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
const meta = {
  fonte: 'Varredura MERCADO x DIRETA sobre BDI Negocio a Negocio (DEB), por DATA DE LIQUIDACAO. Guloso por PU, fee [0,7bps,2,3bps] x duration, sem relevancia minima. Spread CDI+/NTN-B+ (ref ANBIMA).',
  chave: 'liquidacao', fee_banda: '0,7bps..2,3bps x duration', relevancia_min: 'removida (jul/2026)',
  dias: datasBase.length, data_recente: datasBase[datasBase.length - 1] || null, data_antiga: datasBase[0] || null,
  linhas: linhas.length - 1, ativos_dia: gAtivosDia, com_spread: gComSpread, sem_duration: gSemDur,
  vol_mercado_total: Math.round(gMercado), vol_econ_total: Math.round(econGlobal),
  pct_mercado_do_econ: econGlobal > 0 ? +(gMercado / econGlobal * 100).toFixed(1) : null,
  gerado_em: new Date().toISOString(),
}
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log(`  Ativos-dia (por liquidacao): ${gAtivosDia} | com spread: ${gComSpread} | sem duration: ${gSemDur}`)
console.log(`  Vol MERCADO: R$ ${Math.round(gMercado).toLocaleString('pt-BR')} = ${meta.pct_mercado_do_econ}% do economico (resto = direta/orfao)`)
console.log(`  -> ${path.relative(ROOT, OUT)}`)

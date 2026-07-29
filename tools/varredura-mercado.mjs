// varredura-mercado.mjs
// --------------------------------------------------------------------------
// Gera a base MERCADO VERDADEIRO: separa trade a mercado de direta no tape BDI
// (Negocio a Negocio, DEB) e calcula volume, taxa_mid e SPREAD (CDI+/NTN-B+) por
// ativo/dia. Toda a logica esta em lib-mercado.mjs; ver
// METODOLOGIA_Mercado_Verdadeiro.md. Uso: node tools/varredura-mercado.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { MIN_VOL_DOBRADO, gruposDoDia, durationDe, varrer, agregarMercado, spreadDe,
  lerAnbima, lerVenc, lerCurvas } from './lib-mercado.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB = path.join(ROOT, 'public'), BDIDIR = path.join(PUB, 'bdi')
const OUT = path.join(PUB, 'Mercado_Verdadeiro.csv'), META = path.join(PUB, 'Mercado_Verdadeiro_meta.json')

const anbima = lerAnbima(PUB), vencDeb = lerVenc(PUB), curvas = lerCurvas(PUB)
const dias = fs.readdirSync(BDIDIR).filter(f => /^DEB_\d{4}-\d{2}-\d{2}\.csv\.gz$/.test(f)).map(f => f.slice(4, 14)).sort()

console.log('\n=== Varredura MERCADO x DIRETA + spread (BDI DEB, 90 pregoes) ===')
const COLS = ['Data', 'Ativo', 'Indexador', 'DurationAnos', 'FonteDur', 'VolMercado', 'nNegMercado',
  'PU_mid', 'Taxa_mid', 'RefSpread', 'Spread', 'SpreadFmt', 'VolDobradoTotal', 'VolSobraDobrada', 'PctMercadoEcon']
const linhas = [COLS.join(',')]
let gDobrado = 0, gMercado = 0, gAtivosDia = 0, gSemDur = 0, gComSpread = 0

for (const dia of dias) {
  const porAtivo = gruposDoDia(BDIDIR, dia)
  for (const [ativo, grupos] of porAtivo) {
    const volDobrado = grupos.reduce((s, g) => s + g.vol, 0)
    if (volDobrado < MIN_VOL_DOBRADO) continue
    const dd = durationDe(ativo, dia, anbima, vencDeb); if (!dd) { gSemDur++; continue }
    // Conta o denominador (dobrado) p/ TODO ativo relevante -- inclusive os 100%
    // direta (volMerc=0). Excluir estes inflaria o % de mercado.
    gDobrado += volDobrado; gAtivosDia++
    const { pares } = varrer(grupos, dd.D)
    const a = agregarMercado(pares)
    const sp = a.volMerc > 0 ? spreadDe(ativo, dia, a.txMid, dd.idx, anbima, vencDeb, curvas) : null
    if (sp) gComSpread++
    gMercado += a.volMerc
    const sobraDobrada = Math.max(0, volDobrado - 2 * a.volMerc), econTotal = volDobrado / 2
    linhas.push([dia, ativo, dd.idx || '', dd.D.toFixed(2), dd.fonte,
      Math.round(a.volMerc), a.nPares, a.puMid != null ? a.puMid.toFixed(4) : '', a.txMid != null ? a.txMid.toFixed(4) : '',
      sp ? sp.rot : '', sp ? sp.num : '', sp ? sp.fmt : '',
      Math.round(volDobrado), Math.round(sobraDobrada), econTotal > 0 ? (a.volMerc / econTotal * 100).toFixed(1) : ''].join(','))
  }
}

fs.writeFileSync(OUT, linhas.join('\n') + '\n', 'utf8')
const econGlobal = gDobrado / 2
const datasBase = [...new Set(linhas.slice(1).map(l => l.slice(0, 10)))].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
const meta = {
  fonte: 'Varredura MERCADO x DIRETA sobre BDI Negocio a Negocio (DEB). Guloso por PU, fee [1bp,2bps] x duration. Spread CDI+/NTN-B+ (ref ANBIMA).',
  min_vol_dobrado: MIN_VOL_DOBRADO, fee_banda: '1bp..2bps x duration',
  dias: datasBase.length, data_recente: datasBase[datasBase.length - 1] || null, data_antiga: datasBase[0] || null,
  linhas: linhas.length - 1, ativos_dia_relevantes: gAtivosDia, com_spread: gComSpread, sem_duration: gSemDur,
  vol_mercado_total: Math.round(gMercado), vol_econ_total_relevante: Math.round(econGlobal),
  pct_mercado_do_econ: econGlobal > 0 ? +(gMercado / econGlobal * 100).toFixed(1) : null,
  gerado_em: new Date().toISOString(),
}
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log(`  Ativos-dia relevantes: ${gAtivosDia} | com spread: ${gComSpread} | sem duration: ${gSemDur}`)
console.log(`  Vol MERCADO: R$ ${Math.round(gMercado).toLocaleString('pt-BR')} = ${meta.pct_mercado_do_econ}% do economico (resto = direta/orfao)`)
console.log(`  -> ${path.relative(ROOT, OUT)}`)

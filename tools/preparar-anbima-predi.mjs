// preparar-anbima-predi.mjs
// ---------------------------------------------------------------------------
// Spread PRÉ -> "DIxx +Y%" para a coluna "Tx Anbima" da tabela de Ativos.
//
// A ANBIMA dá a taxa PRÉ cheia (ex.: 17,25%); o que interessa é o SPREAD sobre a
// curva de DI futuro (proxy: LTN do REUNE_Curvas). O vértice é escolhido pela
// DURATION do papel (como o "B35" do IPCA) e, se o ano da duration não tiver um
// vértice LTN, INTERPOLA linearmente entre os dois vizinhos (ex.: sem LTN31,
// interpola LTN30/LTN32 no meio = média -> DI31). Spread = taxa PRÉ − yield DI.
//
// Companion (não reescreve o Anbima_Tx.csv, gerado por preparar-anbima.ps1):
//   public/Anbima_PreDi.csv   (ticker, codigoDi, spreadDiPct)
//
// Uso: node tools/preparar-anbima-predi.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lerCurvas, curvaDoDia, parseMs, splitQ, num } from './lib-mercado.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public')
const TX = path.join(PUB, 'Anbima_Tx.csv')
const OUT = path.join(PUB, 'Anbima_PreDi.csv')
const ANO_MS = 365.25 * 864e5

// Yield da curva LTN no dia, INTERPOLADO linearmente na data alvo (extrapola flat
// nas pontas). ltn: [{venc, taxa}].
function interpLtn(ltn, alvoMs) {
  const pts = (ltn || []).map(p => ({ ms: parseMs(p.venc), taxa: p.taxa }))
    .filter(p => p.ms != null && p.taxa != null).sort((a, b) => a.ms - b.ms)
  if (!pts.length || alvoMs == null) return null
  if (alvoMs <= pts[0].ms) return pts[0].taxa
  if (alvoMs >= pts[pts.length - 1].ms) return pts[pts.length - 1].taxa
  for (let i = 1; i < pts.length; i++) {
    if (alvoMs <= pts[i].ms) {
      const lo = pts[i - 1], hi = pts[i]
      return lo.taxa + (hi.taxa - lo.taxa) * (alvoMs - lo.ms) / (hi.ms - lo.ms)
    }
  }
  return null
}

// Header -> índice, casando por nome.
function headerIdx(line) { const h = {}; splitQ(line).forEach((c, i) => { h[c] = i }); return h }

function main() {
  if (!fs.existsSync(TX)) { console.log('  AVISO: Anbima_Tx.csv ausente — sem PRÉ→DI.'); return }
  const linhas = fs.readFileSync(TX, 'utf8').split(/\r?\n/).filter(Boolean)
  const H = headerIdx(linhas[0])
  const iTk = H.ticker, iTx = H.taxaAnbimaOriginal, iTipo = H.tipoTaxaAnbima
  const iRef = H.dataReferenciaAnbima, iDur = H.durationAnbimaAnos
  const curvas = lerCurvas(PUB)
  const out = [['ticker', 'codigoDi', 'spreadDiPct'].map(c => `"${c}"`).join(',')]
  let n = 0, sem = 0
  for (let r = 1; r < linhas.length; r++) {
    const f = splitQ(linhas[r]); if (!f.length) continue
    if ((f[iTipo] || '').trim() !== 'PREFIXADO') continue
    const tk = (f[iTk] || '').trim()
    const preRate = num(f[iTx]), durAnos = num(f[iDur]), dia = (f[iRef] || '').trim()
    if (!tk || preRate == null || durAnos == null || !dia) { sem++; continue }
    const cv = curvaDoDia(curvas, dia); if (!cv) { sem++; continue }
    // ponto da duration -> vértice DI (Jan/ano) mais próximo; interpola a LTN nele.
    const durDate = new Date(parseMs(dia) + durAnos * ANO_MS)
    let diAno = durDate.getUTCFullYear() + (durDate.getUTCMonth() >= 6 ? 1 : 0)   // >= julho arredonda p/ cima
    const alvoMs = Date.UTC(diAno, 0, 1)
    const yld = interpLtn(cv.c.ltn, alvoMs)
    if (yld == null) { sem++; continue }
    const spread = +(preRate - yld).toFixed(4)
    const codigoDi = 'DI' + String(diAno % 100).padStart(2, '0')
    out.push([tk, codigoDi, spread].map(c => `"${c}"`).join(','))
    n++
  }
  fs.writeFileSync(OUT, out.join('\r\n') + '\r\n', 'utf8')
  console.log(`  PRÉ→DI: ${n} spread(s) -> ${path.relative(path.join(__dirname, '..'), OUT)} | sem dado: ${sem}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
export { interpLtn }

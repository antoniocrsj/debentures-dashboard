// lupa-mercado.mjs -- inspeciona a varredura MERCADO x DIRETA nas ultimas N datas
// de LIQUIDACAO (alinhado a producao: chave por liquidacao, banda [0,7;2,3], sem relevancia).
//   node tools/lupa-mercado.mjs [N=5]            -> visao geral (ranking de ativos)
//   node tools/lupa-mercado.mjs [N] TICKER       -> zoom: pares, sobra e spread do ativo
// Logica em lib-mercado.mjs; ver METODOLOGIA_Mercado_Verdadeiro.md.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { FEE_LO, FEE_HI, gruposPorLiquidacao, durationDe, varrer, agregarMercado,
  spreadDe, lerAnbima, lerVenc, lerCurvas } from './lib-mercado.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB = path.join(ROOT, 'public'), BDIDIR = path.join(PUB, 'bdi')
const N = Math.max(1, parseInt(process.argv[2] || '5', 10))
const ALVO = (process.argv[3] || '').toUpperCase()
const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

const anbima = lerAnbima(PUB), vencDeb = lerVenc(PUB), curvas = lerCurvas(PUB)
// Chave por LIQUIDACAO. Le os ultimos N+3 arquivos de trade p/ popular as ultimas N
// datas de liquidacao (settle = trade ou trade+1..+2).
const arqs = fs.readdirSync(BDIDIR).filter(f => /^DEB_\d{4}-\d{2}-\d{2}\.csv\.gz$/.test(f)).map(f => f.slice(4, 14)).sort()
const porLiq = gruposPorLiquidacao(BDIDIR, arqs.slice(-(N + 3)))
const dias = [...porLiq.keys()].sort().slice(-N)
console.log(`\n=== LUPA MERCADO x DIRETA (por LIQUIDACAO) -- ultimas ${dias.length} datas (${dias[0]} .. ${dias[dias.length - 1]}) ===`)

if (!ALVO) {
  const linhas = []
  for (const dia of dias) {
    const porAtivo = porLiq.get(dia); let vd = 0, vm = 0, nAt = 0
    for (const [ativo, grupos] of porAtivo) {
      const volDobrado = grupos.reduce((s, g) => s + g.vol, 0)   // relevancia removida
      const dd = durationDe(ativo, dia, anbima, vencDeb); if (!dd) continue
      vd += volDobrado; nAt++                              // denominador: TODO ativo com duration
      const { pares } = varrer(grupos, dd.D), ag = agregarMercado(pares)
      vm += ag.volMerc
      if (ag.volMerc <= 0) continue                        // 100% direta -> nao entra no ranking
      const sp = spreadDe(ativo, dia, ag.txMid, dd.idx, anbima, vencDeb, curvas)
      linhas.push({ dia, ativo, idx: dd.idx, D: dd.D, volDobrado, volMerc: ag.volMerc, pct: ag.volMerc / (volDobrado / 2) * 100, txMid: ag.txMid, sp })
    }
    console.log(`  ${dia}: ${String(nAt).padStart(4)} ativos | dobrado ${brl(vd).padStart(18)} | MERCADO ${brl(vm).padStart(16)} (${(vm / (vd / 2) * 100).toFixed(0)}% do econ)`)
  }
  console.log(`\n  Top 40 ativos-dia por VOLUME DE MERCADO:`)
  console.log(`  Data       Ativo    Idx          Dur   VolMercado         %Merc  TaxaMid  SPREAD`)
  for (const r of linhas.sort((a, b) => b.volMerc - a.volMerc).slice(0, 40))
    console.log(`  ${r.dia} ${r.ativo.padEnd(8)} ${(r.idx || '').padEnd(12)} ${r.D.toFixed(1).padStart(4)}  ${brl(r.volMerc).padStart(16)}  ${r.pct.toFixed(0).padStart(4)}%  ${(r.txMid != null ? r.txMid.toFixed(3) : '--').padStart(7)}  ${r.sp ? r.sp.fmt : '--'}`)
  console.log(`\n  (${linhas.length} ativos-dia com mercado. Zoom: node tools/lupa-mercado.mjs ${N} TICKER)`)
} else {
  for (const dia of dias) {
    const grupos = (porLiq.get(dia) || new Map()).get(ALVO)
    if (!grupos) { console.log(`\n  ${dia}  ${ALVO}: sem negocios`); continue }
    const volDobrado = grupos.reduce((s, g) => s + g.vol, 0), dd = durationDe(ALVO, dia, anbima, vencDeb)
    console.log(`\n  ${dia}  ${ALVO}  [${dd ? dd.idx + ' dur ' + dd.D.toFixed(2) + 'a (' + dd.fonte + ')' : 'sem duration'}]  dobrado ${brl(volDobrado)}`)
    if (!dd) { console.log(`    (sem duration/prazo -> nao classificavel)`); continue }
    console.log(`    banda de fee: ${(FEE_LO * dd.D * 1e4).toFixed(1)}..${(FEE_HI * dd.D * 1e4).toFixed(1)} bps de var. de PU  (= ${(FEE_LO * 1e4).toFixed(1)}..${(FEE_HI * 1e4).toFixed(1)} bps de taxa)`)
    console.log(`    grupos de PU: ` + [...grupos].sort((a, b) => a.pu - b.pu).map(g => `${g.pu.toFixed(4)}(${g.qtd})`).join('  '))
    const { pares, sobra } = varrer(grupos, dd.D), ag = agregarMercado(pares)
    const spAgg = spreadDe(ALVO, dia, ag.txMid, dd.idx, anbima, vencDeb, curvas)
    console.log(`    MERCADO (${pares.length} pares, ${brl(ag.volMerc)}, ${(ag.volMerc / (volDobrado / 2) * 100).toFixed(0)}% do econ) | taxaMid ${ag.txMid != null ? ag.txMid.toFixed(4) : '--'} -> SPREAD ${spAgg ? spAgg.fmt + (spAgg.fb ? ' [curva ' + spAgg.fb + ']' : '') : '--'}`)
    for (const p of pares.sort((a, b) => a.puL - b.puL)) {
      const spP = spreadDe(ALVO, dia, p.txMid, dd.idx, anbima, vencDeb, curvas)
      console.log(`      ${p.puL.toFixed(4)} -> ${p.puH.toFixed(4)}  qtd ${String(p.qtd).padStart(8)}  fee ${p.feeBps.toFixed(2).padStart(6)}bps  mid ${p.mid.toFixed(4)}  taxaMid ${p.txMid != null ? p.txMid.toFixed(4) : '--'}  ${spP ? spP.fmt : ''}`)
    }
    const volSobra = sobra.reduce((s, x) => s + x.qtd * x.pu, 0)
    console.log(`    DIRETA/orfao (${sobra.length} grupos, ${brl(volSobra)}): ` + sobra.sort((a, b) => b.qtd - a.qtd).slice(0, 8).map(x => `${x.pu.toFixed(4)}(${Math.round(x.qtd)})`).join('  '))
  }
}

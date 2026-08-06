// preparar-enquadramento-12431.mjs
// ---------------------------------------------------------------------------
// Enquadramento 12.431 por fundo FI-Infra: quanto ainda precisa comprar de
// debêntures incentivadas p/ cumprir o mínimo legal (67% <24m / 85% >=24m),
// projetado p/ HOJE, +6m e +12m. Modelo completo em MODELO_Enquadramento_12431.md.
//
// Determinístico (sem forecast): PL observado até hoje e CONSTANTE depois;
// carteira da última data de CDA (M) rolada pela amortização contratual dos papéis.
//
//   Compra(h) = MAX(0, PL_ref × %_exig(idade+h) − Elegíveis(h))
//   Elegíveis(h) = Σ VL_M × (1 − cumFrac(t, HOJE+h)) / (1 − cumFrac(t, M))
//
// Universo = seleção do app (segmento '12431' com carteira no CDA).
// Saída: public/data/Enquadramento_12431.csv + Enquadramento_12431_meta.json
// Uso:  node tools/preparar-enquadramento-12431.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(__dirname, '..', 'public')
const DATA = path.join(PUB, 'data')
const OUT = path.join(DATA, 'Enquadramento_12431.csv')
const OUT_META = path.join(DATA, 'Enquadramento_12431_meta.json')

// ---- helpers -------------------------------------------------------------
const digits = s => String(s || '').replace(/\D/g, '')
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
// CSV com aspas (campos podem ter vírgula). Retorna array de células.
function parseLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur); return out
}
function readCsv(file) {
  if (!fs.existsSync(file)) return { header: [], rows: [] }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length)
  const header = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { header, rows, idx: name => header.indexOf(name) }
}
const msOf = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null }
const monthEndMs = yyyymm => { const y = +String(yyyymm).slice(0, 4), mo = +String(yyyymm).slice(4, 6); return Date.UTC(y, mo, 0) }   // dia 0 do mês seguinte = último do mês
const addMonthsMs = (ms, n) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()) }
const monthsBetween = (msA, msB) => { const a = new Date(msA), b = new Date(msB); return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0) }
const ymKey = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const monthOfDia = dia => (dia || '').slice(0, 7).replace('-', '')   // '2026-07-02' -> '202607'

// PL de referência AS OF um mês-alvo (ty, tm): MIN(PL do mês, média 180 DIAS).
// A média 180d é DIÁRIA (média da cota nos últimos 180 dias corridos, do Informe
// Diário — Fundos_PL_Media180.csv), não a média de 6 fotos de fim de mês (que
// engana: perde a variação intra-mês e pondera errado quem captou em datas
// específicas). Reproduz a regra legal em CADA ponto do tempo: um aporte recente
// entra POUCO na média, então não dispara exigência prematura. Meses >= hoje
// congelam no PL_ref de hoje (forward, sem forecast). Fallback p/ a média mensal
// (`plMap`) se faltar o informe daquele mês.
function plRefNoMes(plMap, mediaDia, ty, tm, hojeYm, plRefHoje) {
  if (ty * 100 + tm >= hojeYm) return plRefHoje
  const ref = `${ty}${String(tm).padStart(2, '0')}`
  let media = mediaDia && mediaDia[ref] > 0 ? mediaDia[ref] : 0
  if (!media) {   // fallback: média das fotos mensais trailing (6 pontos)
    const pts = []
    for (let k = 0; k < 6; k++) {
      let yy = ty, mm = tm - k; while (mm <= 0) { mm += 12; yy-- }
      const v = plMap[`${yy}${String(mm).padStart(2, '0')}`]; if (v > 0) pts.push(v)
    }
    if (!pts.length) return plRefHoje
    media = pts.reduce((a, b) => a + b, 0) / pts.length
  }
  const plAsOf = plMap[ref] || media
  return Math.min(plAsOf, media)
}

function main() {
  // 1) tickers 12.431 (do cadastro de debêntures)
  const deb = readCsv(path.join(PUB, 'Debentures.csv'))
  const iCod = deb.header.indexOf('Codigo do Ativo')
  const iInc = deb.header.indexOf('Deb. Incent. (Lei 12.431)')
  const set12431 = new Set()
  if (iCod >= 0 && iInc >= 0) for (const r of deb.rows) { if (/^s$/i.test((r[iInc] || '').trim())) set12431.add((r[iCod] || '').trim().toUpperCase()) }

  // 2) cronograma de amortização por ticker: [{ms, frac}] ordenado; + fonte
  const cron = readCsv(path.join(DATA, 'Cronograma_Amortizacao.csv'))
  const cAg = {}, cFonte = {}   // ticker -> [{ms, frac}] ; ticker -> Set(fontes)
  { const iT = cron.header.indexOf('Ticker'), iD = cron.header.indexOf('Data'), iF = cron.header.indexOf('FracaoPct'), iFo = cron.header.indexOf('Fonte')
    for (const r of cron.rows) {
      const t = (r[iT] || '').trim().toUpperCase(); const ms = msOf(r[iD]); if (!t || ms == null) continue
      ;(cAg[t] || (cAg[t] = [])).push({ ms, frac: num(r[iF]) / 100 })
      ;(cFonte[t] || (cFonte[t] = new Set())).add((r[iFo] || '').trim())
    }
    for (const t in cAg) cAg[t].sort((a, b) => a.ms - b.ms)
  }
  // fração acumulada do principal ORIGINAL amortizada até `ms` (inclusive)
  const cumFrac = (t, ms) => { const a = cAg[t]; if (!a) return 0; let s = 0; for (const e of a) { if (e.ms <= ms) s += e.frac; else break } return s }
  const temAgenda = t => !!cAg[t]
  const estimado = t => { const f = cFonte[t]; return !f || f.has('linear') }

  // 3) posições 12.431 por fundo (BLC = carteira em M, valor de mercado)
  const blc = readCsv(path.join(PUB, 'BLC_PorFundo.csv'))
  const posPorFundo = {}   // cnpj -> [{t, vl}]
  { const iC = blc.header.indexOf('CNPJ_FUNDO_CLASSE'), iA = blc.header.indexOf('CD_ATIVO'), iV = blc.header.indexOf('VL_ALOCADO')
    for (const r of blc.rows) {
      const t = (r[iA] || '').trim().toUpperCase(); if (!set12431.has(t)) continue
      const c = digits(r[iC]); ;(posPorFundo[c] || (posPorFundo[c] = [])).push({ t, vl: num(r[iV]) })
    }
  }
  // M = data de referência do BLC/CDA (a foto da carteira). É o âncora do modelo:
  // as posições (VL_ALOCADO) são desse mês, e a amortização + a série mensal
  // partem daqui. Fonte: selo public/BLC_maturidade.json (mesAno = AAAAMM). O
  // MesBase do Caixa_Potencial é um ciclo mais novo (só serve p/ PL) — NÃO usar
  // como M, senão o denominador da amortização e o início da série ficam errados.
  let blcMesAno = null
  try {
    const selo = JSON.parse(fs.readFileSync(path.join(PUB, 'BLC_maturidade.json'), 'utf8'))
    if (/^\d{6}$/.test(String(selo.mesAno || ''))) blcMesAno = String(selo.mesAno)
  } catch { /* sem selo: cai no MesBase do fundo (fallback) */ }

  // 4) PL: caixa (universo + carteira/diário), perf diário (fresco), histórico mensal
  const caixa = readCsv(path.join(DATA, 'Caixa_Potencial_Fundos.csv'))
  const cx = {}   // cnpj -> {nome, gestor, mesBase, plCarteira, plDiario}
  { const h = caixa.header, i = n => h.indexOf(n)
    for (const r of caixa.rows) {
      if ((r[i('Segmento')] || '').trim() !== '12431') continue
      cx[digits(r[i('CNPJ')])] = { nome: r[i('Nome')] || '', gestor: r[i('Gestor')] || '', mesBase: (r[i('MesBase')] || '').trim(), plCarteira: num(r[i('PL_Carteira')]), plDiario: num(r[i('PLDiario')]) }
    }
  }
  const perf = readCsv(path.join(DATA, 'Perf_Diario_12431.csv'))
  const perfLast = {}   // cnpj -> {dia, pl} (PL diário mais recente)
  let hojeMs = 0
  { const iD = perf.header.indexOf('Dia'), iC = perf.header.indexOf('CNPJ_Fundo'), iP = perf.header.indexOf('PL')
    for (const r of perf.rows) {
      const dia = (r[iD] || '').trim(), c = digits(r[iC]), pl = num(r[iP]); const ms = msOf(dia); if (!c || ms == null) continue
      if (ms > hojeMs) hojeMs = ms
      if (!perfLast[c] || dia > perfLast[c].dia) perfLast[c] = { dia, pl }
    }
  }
  if (!hojeMs) hojeMs = Date.now()
  // Média 180d = SÓ o histórico mensal do CDA (fonte confiável); o diário do Perf
  // só entra no PL_hoje (com sanidade), pois às vezes vem glitchado (classe/parcial).
  const hist = readCsv(path.join(DATA, 'Caixa_Potencial_Fundos_Historico.csv'))
  const plMensal = {}   // cnpj -> {YYYYMM: pl}
  { const iM = hist.header.indexOf('Mes'), iC = hist.header.indexOf('CNPJ'), iP = hist.header.indexOf('PL')
    for (const r of hist.rows) { const c = digits(r[iC]); (plMensal[c] || (plMensal[c] = {}))[(r[iM] || '').trim()] = num(r[iP]) }
  }

  // 5) data de início. A idade (carência 6m + degrau 24m) parte da 1ª COTA
  // (1º mês com PL no CDA) — "sem cota o fundo ainda não existe". O registro CVM
  // (Fundos_Atributos.Data_Inicio) antecede a 1ª integralização em vários meses e
  // envelhecia o fundo cedo demais (backlog inflado). 1ª cota é a fonte primária;
  // registro CVM só como fallback. Ver preparar-primeira-cota.mjs.
  const atr = readCsv(path.join(DATA, 'Fundos_Atributos.csv'))
  const iniPorCnpj = {}
  { const iC = atr.header.indexOf('CNPJ_FUNDO_CLASSE'), iI = atr.header.indexOf('Data_Inicio')
    for (const r of atr.rows) { const c = digits(r[iC]); const ini = (r[iI] || '').trim(); if (ini) iniPorCnpj[c] = ini }
  }
  const cotaPorCnpj = {}
  { const pc = readCsv(path.join(DATA, 'Fundos_PrimeiraCota.csv'))
    const iC = pc.header.indexOf('CNPJ'), iD = pc.header.indexOf('PrimeiraCotaData')
    if (iC >= 0 && iD >= 0) for (const r of pc.rows) { const c = digits(r[iC]); const d = (r[iD] || '').trim(); if (d) cotaPorCnpj[c] = d }
  }
  // média 180 DIAS (diária, "de cota") por fundo x ref — Fundos_PL_Media180.csv
  // (gerado por preparar-pl-media180.mjs). mediaDiaria[cnpj] = { 'AAAAMM': média
  // terminando no fim do mês, 'HOJE': média até a última data }.
  const mediaDiaria = {}
  { const md = readCsv(path.join(DATA, 'Fundos_PL_Media180.csv'))
    const iC = md.header.indexOf('CNPJ'), iR = md.header.indexOf('Ref'), iM = md.header.indexOf('Media180')
    if (iC >= 0 && iR >= 0 && iM >= 0) for (const r of md.rows) {
      const c = digits(r[iC]); const ref = (r[iR] || '').trim(); const m = num(r[iM])
      if (c && ref && m > 0) (mediaDiaria[c] || (mediaDiaria[c] = {}))[ref] = m
    }
  }

  // últimos 6 meses (janela ~180d) terminando no mês de HOJE
  const last6 = []; { let ms = hojeMs; for (let k = 0; k < 6; k++) { last6.push(ymKey(ms)); ms = addMonthsMs(ms, -1) } }

  // 6) cálculo por fundo
  const HORIZ = [0, 6, 12]
  const linhas = []
  const fundos = []   // essenciais p/ a série mensal (posições, PL_ref, datas)
  let semCarteira = 0, semDataInicio = 0, usouCota = 0
  for (const c in cx) {
    const f = cx[c]
    const pos = posPorFundo[c] || []
    const mAno = blcMesAno || f.mesBase                    // M = data do BLC (fallback: MesBase)
    const Mms = mAno ? monthEndMs(mAno) : null
    if (!Mms) continue
    // média 180d: DIÁRIA da cota (Fundos_PL_Media180, ref HOJE) — a correta.
    // Fallback = média das 6 fotos mensais do CDA (se faltar informe diário).
    const md = mediaDiaria[c]
    const pontos = last6.map(mk => plMensal[c]?.[mk]).filter(v => v && v > 0)
    const mediaMensal = pontos.length ? pontos.reduce((a, b) => a + b, 0) / pontos.length : 0
    const media180 = (md && md.HOJE > 0) ? md.HOJE : mediaMensal
    // PL de hoje: diário fresco do Perf, MAS desprezado se destoa demais do PL de
    // carteira do CDA (glitch de classe/parcial) -> cai no PLDiario são, senão no CDA.
    const ref = f.plCarteira > 0 ? f.plCarteira : media180
    const sane = v => v > 0 && ref > 0 && v >= 0.3 * ref && v <= 3 * ref
    let plHoje = perfLast[c]?.pl || 0
    if (!sane(plHoje)) plHoje = sane(f.plDiario) ? f.plDiario : (f.plCarteira || media180)
    if (!(plHoje > 0)) continue
    const plRef = Math.min(plHoje, media180 > 0 ? media180 : plHoje)
    if (!(plRef > 0)) continue
    // idade: parte da 1ª cota (correto); registro CVM só como fallback
    const ini = cotaPorCnpj[c] || iniPorCnpj[c]; const semIni = !ini
    if (cotaPorCnpj[c]) usouCota++
    if (semIni) semDataInicio++
    const idade = ini ? monthsBetween(msOf(ini), hojeMs) : 0   // sem data -> assume <24m (67%)
    // elegíveis por horizonte (roll de amortização) + flag de estimativa
    let amortEst = false
    const elig = {}
    for (const h of HORIZ) {
      const alvo = addMonthsMs(hojeMs, h)
      let soma = 0
      for (const p of pos) {
        if (!temAgenda(p.t)) { soma += p.vl; continue }   // sem cronograma -> mantém (conservador)
        if (estimado(p.t)) amortEst = true
        const denM = 1 - cumFrac(p.t, Mms)
        if (denM <= 1e-6) { soma += p.vl; continue }       // já amortizado por M na agenda mas presente no BLC -> mantém
        const rest = (1 - cumFrac(p.t, alvo)) / denM
        soma += p.vl * Math.max(0, Math.min(1, rest))
      }
      elig[h] = soma
    }
    if (!pos.length) semCarteira++   // fundo da seleção sem posição 12.431 no BLC (aparece 100% desenquadrado)
    const row = {
      CNPJ: c, Fundo: f.nome, Gestor: f.gestor, DataInicio: ini || '',
      idadeMeses: idade, dataM: mAno, dataHoje: new Date(hojeMs).toISOString().slice(0, 10),
      PL_hoje: Math.round(plHoje), PL_medio180: Math.round(media180), PL_ref: Math.round(plRef),
      pctAtual: +(elig[0] / plRef).toFixed(4),
      amortEstimada: amortEst ? 1 : 0, semDataInicio: semIni ? 1 : 0, semCarteira: pos.length ? 0 : 1,
    }
    for (const h of HORIZ) {
      const ia = idade + h                                  // idade no horizonte
      const pct = ia < 6 ? 0 : (ia < 24 ? 0.67 : 0.85)      // carência 6m -> 67% -> 85%
      const compra = Math.max(0, plRef * pct - elig[h])
      row[`Eleg_${h}m`] = Math.round(elig[h]); row[`pctExig_${h}m`] = pct; row[`Compra_${h}m`] = Math.round(compra)
    }
    linhas.push(row)
    if (pos.length) fundos.push({ pos, plRef, iniMs: ini ? msOf(ini) : null, Mms, gestor: f.gestor || '—', plMap: plMensal[c] || {}, mediaDia: mediaDiaria[c] || null })
  }

  // 6b) SÉRIE MENSAL da demanda (compra necessária TOTAL) a partir de M, mês a mês,
  // com o degrau 67->85% e a amortização da carteira agindo em cada mês. O PL de
  // referência é recalculado EM CADA MÊS (média 180d trailing daquele mês, via
  // plRefNoMes) — não o de hoje aplicado para trás: senão fundos que captaram há
  // pouco apareceriam com backlog inflado (o aporte recente ainda não maturou na
  // média). Meses >= hoje congelam no PL_ref de hoje (forward, sem forecast).
  // Além do TOTAL, acumula a série por GESTORA (p/ o gráfico mensal filtrar ao
  // clicar numa gestora). NMES = nº de meses da série.
  const hojeYm = +ymKey(hojeMs)
  // A série começa em M (o mês FECHADO do BLC). A 1ª barra é o BACKLOG pré-existente
  // (stock em M = fundos já desenquadrados na foto da carteira). As barras seguintes
  // (M+1 em diante) são o FLUXO: demanda que SURGE no mês = stock[mês]-stock[mês-1]
  // (o componente calcula o diff; a 1ª barra fica sendo o stock[M]). O denominador da
  // amortização (fd.Mms) é M.
  const NMES = 22   // M (mar/26) .. dez/27
  const mesBaseG = blcMesAno || cx[Object.keys(cx)[0]]?.mesBase
  const serie = []
  const porGestora = {}   // gestora -> [compra por mês]
  if (mesBaseG) {
    const baseY = +mesBaseG.slice(0, 4), baseMo = +mesBaseG.slice(4, 6)
    for (let k = 0; k < NMES; k++) {
      const ty = baseY + Math.floor((baseMo - 1 + k) / 12)   // k=0 -> M (backlog)
      const tm = ((baseMo - 1 + k) % 12) + 1
      const alvo = Date.UTC(ty, tm, 0)   // último dia do mês-alvo (sem overflow de dia)
      let total = 0, nDes = 0
      for (const fd of fundos) {
        const idadeAlvo = fd.iniMs != null ? monthsBetween(fd.iniMs, alvo) : monthsBetween(hojeMs, alvo)
        const pctExig = idadeAlvo < 6 ? 0 : (idadeAlvo < 24 ? 0.67 : 0.85)   // carência 6m
        let elig = 0
        for (const p of fd.pos) {
          if (!temAgenda(p.t)) { elig += p.vl; continue }
          const denM = 1 - cumFrac(p.t, fd.Mms)
          if (denM <= 1e-6) { elig += p.vl; continue }
          elig += p.vl * Math.max(0, Math.min(1, (1 - cumFrac(p.t, alvo)) / denM))
        }
        const plRefMes = plRefNoMes(fd.plMap, fd.mediaDia, ty, tm, hojeYm, fd.plRef)   // PL_ref daquele mês (média diária 180d)
        const compra = plRefMes * pctExig - elig
        if (compra > 0) {
          total += compra; nDes++
          const g = porGestora[fd.gestor] || (porGestora[fd.gestor] = new Array(NMES).fill(0))
          g[k] += compra
        }
      }
      serie.push({ mes: `${ty}-${String(tm).padStart(2, '0')}`, compra: Math.round(total), nDesenq: nDes })
    }
    for (const g in porGestora) porGestora[g] = porGestora[g].map(v => Math.round(v))
  }

  // 7) grava CSV + meta
  const cols = ['CNPJ', 'Fundo', 'Gestor', 'DataInicio', 'idadeMeses', 'dataM', 'dataHoje',
    'PL_hoje', 'PL_medio180', 'PL_ref', 'pctAtual',
    'Eleg_0m', 'Eleg_6m', 'Eleg_12m', 'pctExig_0m', 'pctExig_6m', 'pctExig_12m',
    'Compra_0m', 'Compra_6m', 'Compra_12m', 'amortEstimada', 'semDataInicio', 'semCarteira']
  linhas.sort((a, b) => b.Compra_6m - a.Compra_6m)
  const csv = [cols.join(',')].concat(linhas.map(l => cols.map(k => {
    const v = l[k]; const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(','))).join('\r\n') + '\r\n'
  fs.writeFileSync(OUT, csv, 'utf8')

  const desenq = h => linhas.filter(l => l[`Compra_${h}m`] > 0)
  const meta = {
    geradoEm: new Date().toISOString(), dataM: blcMesAno || cx[Object.keys(cx)[0]]?.mesBase || null,
    dataHoje: new Date(hojeMs).toISOString().slice(0, 10),
    premissas: { plConstanteAposHoje: true, media180: 'proxy mensal (últimos ~6 meses)', dataInicio: 'registro CVM (proxy 1ª integralização)', elegiveis: 'só debêntures 12.431 (não capta cotas de FI-Infra)' },
    serieMensal: serie,
    serieMensalGestora: porGestora,
    cobertura: {
      fundos: linhas.length, semCarteira, semDataInicio,
      desenquadrados6m: desenq(6).length, desenquadrados12m: desenq(12).length,
      compraTotal6m: Math.round(desenq(6).reduce((a, l) => a + l.Compra_6m, 0)),
      compraTotal12m: Math.round(desenq(12).reduce((a, l) => a + l.Compra_12m, 0)),
    },
  }
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  console.log(`[enquadramento-12431] ${linhas.length} fundo(s) | HOJE ${meta.dataHoje} | M ${meta.dataM}`)
  console.log(`  desenquadrados 6m: ${meta.cobertura.desenquadrados6m} (compra R$ ${(meta.cobertura.compraTotal6m / 1e9).toFixed(1)} bi) | 12m: ${meta.cobertura.desenquadrados12m}`)
  console.log(`  sem carteira 12.431: ${semCarteira} | sem data início: ${semDataInicio} | idade pela 1ª cota: ${usouCota} (resto: registro CVM)`)
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`)
}

main()

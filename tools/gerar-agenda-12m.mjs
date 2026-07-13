// gerar-agenda-12m.mjs
// --------------------------------------------------------------------------
// Monta o planejamento de VENCIMENTOS 12m (juros + amortizacao) a partir do
// cache de agendas (dados-anbima/agenda-cache/<TICKER>.json, gerado por
// preparar-agenda.ps1) cruzado com:
//   - public/Debentures.csv  -> emissao, vencimento, notional de mercado
//   - public/BLC_tratado.csv -> quanto a CARTEIRA dos fundos carrega (VL_ALOCADO)
//   - public/Anbima_Tx.csv   -> indexador/spread (p/ estimar o cupom) + data ref
//
// Duas perspectivas (toggle no app):
//   - carteira: eventos ponderados pelo que os fundos monitorados carregam.
//   - mercado : eventos ponderados pelo notional total em mercado da debenture.
//
// Precisao:
//   - AMORTIZACAO -> R$ preciso: notional x (taxa%/100) do proprio evento da agenda.
//   - JUROS       -> R$ ESTIMADO pelo cupom (a agenda nao traz o valor pago).
//     cupom anual estimado a partir do indexador + premissas (CDI/IPCA); cada
//     pagamento = notional x cupomAnual x (dias desde o pagamento anterior/365.25).
//     Marcado como estimativa no JSON (premissas expostas) e no app.
//
// Saida: public/data/Agenda_12m.json
// Uso:   node tools/gerar-agenda-12m.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCSV } from '../src/utils/csv.js'
import { parseNum, isYes } from '../src/utils/format.js'
import { parseAgenda } from '../src/utils/agenda.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const DATA = path.join(PUBLIC, 'data')
const CACHE = path.join(ROOT, 'dados-anbima', 'agenda-cache')
const OUT = path.join(DATA, 'Agenda_12m.json')

const HORIZONTE_MESES = 12

// Premissas para ESTIMAR o cupom (juros). Prioridade (cada um sobrescreve o
// anterior): default -> CDI de mercado (LTN mais curta, public/data/
// Premissas_Mercado.json, gerado por preparar-anbima.ps1) -> override manual
// em tools/premissas-agenda.json. Assim o CDI vem do mercado, sem chute, mas
// da pra fixar qualquer premissa a mao quando quiser.
function loadPremissas() {
  const prem = { cdi: 0.15, ipca: 0.045, igpm: 0.045, cdiFonte: 'default' }
  const mkt = path.join(PUBLIC, 'data', 'Premissas_Mercado.json')
  if (fs.existsSync(mkt)) {
    try {
      const m = JSON.parse(fs.readFileSync(mkt, 'utf8'))
      if (m && typeof m.cdi === 'number') { prem.cdi = m.cdi; prem.cdiFonte = m.fonte || 'LTN' }
    } catch { /* segue com o default */ }
  }
  const ov = path.join(__dirname, 'premissas-agenda.json')
  if (fs.existsSync(ov)) {
    try {
      const o = JSON.parse(fs.readFileSync(ov, 'utf8'))
      Object.assign(prem, o)
      if (typeof o.cdi === 'number') prem.cdiFonte = 'manual (premissas-agenda.json)'
    } catch { /* segue */ }
  }
  return prem
}

function readCsv(file) {
  if (!fs.existsSync(file)) return []
  try { return parseCSV(fs.readFileSync(file, 'utf8')) } catch { return [] }
}
function norm(s) { return String(s || '').trim().toUpperCase() }

// Datas locais (sem fuso): 'yyyy-MM-dd' ou 'dd/MM/yyyy' -> Date local.
function parseData(s) {
  if (!s) return null
  const t = String(s).trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  return null
}
function mesKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesLabel(key) {
  const [y, mm] = key.split('-')
  return `${MESES[+mm - 1]}/${String(y).slice(2)}`
}

// ─── Fontes ────────────────────────────────────────────────────────────────
function loadDebentures() {
  const map = new Map()
  for (const r of readCsv(path.join(PUBLIC, 'Debentures.csv'))) {
    const tk = norm(r['Codigo do Ativo'])
    if (!tk) continue
    const qtd = parseNum(r['Quantidade em Mercado'])
    const vna = parseNum(r['Valor Nominal Atual']) || parseNum(r['Valor Nominal na Emissao'])
    map.set(tk, {
      ticker: tk,
      emissor: (r['Empresa'] || '').trim(),
      emissao: r['Data de Emissao'] || '',
      vencimento: r['Data de Vencimento'] || '',
      notionalMercado: qtd * vna,
      indice: (r['indice'] || '').trim(),
      percentual: parseNum(r['Percentual Multiplicador/Rentabilidade']),
      incentivada: isYes(r['Deb. Incent. (Lei 12.431)']),
      situacao: (r['Situacao'] || '').trim(),
    })
  }
  return map
}
function loadCarteira() {
  const map = new Map()
  for (const r of readCsv(path.join(PUBLIC, 'BLC_tratado.csv'))) {
    const tk = norm(r['CD_ATIVO'])
    if (!tk) continue
    map.set(tk, (map.get(tk) || 0) + parseNum(r['VL_ALOCADO']))
  }
  return map
}
function loadAnbima() {
  const map = new Map()
  let refDate = ''
  for (const r of readCsv(path.join(PUBLIC, 'Anbima_Tx.csv'))) {
    const tk = norm(r['ticker'])
    if (!tk) continue
    map.set(tk, {
      tipo: (r['tipoTaxaAnbima'] || '').trim(),         // DI_SPREAD | DI_PERCENTUAL | IPCA_SPREAD | PREFIXADO | IGP-M
      taxa: parseNum(r['taxaAnbimaOriginal']),           // spread% / pre% / %CDI, conforme o tipo
      dataRef: (r['dataReferenciaAnbima'] || '').trim(),
    })
    const dr = r['dataReferenciaAnbima']
    if (dr && dr > refDate) refDate = dr
  }
  return { map, refDate }
}

// Cupom anual estimado (fracao, ex.: 0.163 = 16,3% a.a.).
function cupomAnual(anb, deb, premissas) {
  const { cdi, ipca, igpm } = premissas
  const tipo = anb ? anb.tipo : ''
  const spreadOuPre = anb ? anb.taxa / 100 : 0   // taxaAnbimaOriginal esta em %
  if (tipo === 'DI_SPREAD') return cdi + spreadOuPre
  if (tipo === 'DI_PERCENTUAL') return (anb.taxa / 100) * cdi   // taxa = % do CDI (ex.: 103 -> 1.03*cdi)
  if (tipo === 'PREFIXADO') return spreadOuPre
  if (tipo === 'IPCA_SPREAD') return ipca + spreadOuPre
  if (tipo === 'IGP-M') return igpm + spreadOuPre
  // Sem ANBIMA: cai pro cadastro (indice + percentual).
  const idx = norm(deb ? deb.indice : '')
  const p = deb ? deb.percentual / 100 : 0
  if (idx.includes('DI') || idx.includes('CDI')) return deb.percentual > 30 ? p * cdi : cdi + p
  if (idx.includes('IPCA')) return ipca + p
  if (idx.includes('IGP')) return igpm + p
  if (idx.includes('PRE') || idx.includes('PR')) return p
  return cdi   // ultimo recurso
}

// ─── Agregacao ───────────────────────────────────────────────────────────
function main() {
  const premissas = loadPremissas()
  const debs = loadDebentures()
  const carteira = loadCarteira()
  const { map: anbima, refDate: anbRef } = loadAnbima()

  // Ancora: data dos dados (ref ANBIMA) — nunca o relogio, quando disponivel.
  const hoje = parseData(anbRef) || new Date()
  // Janela = 12 baldes mensais a partir do mes corrente (ex.: jul/26..jun/27).
  // fim = 1o dia do mes seguinte ao ultimo balde (exclusivo), alinhado ao esqueleto.
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + HORIZONTE_MESES, 1)

  // Esqueleto dos 12 meses (a partir do mes seguinte inclui o mes corrente).
  const meses = []
  const idxMes = new Map()
  for (let i = 0; i < HORIZONTE_MESES; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
    const key = mesKey(d)
    idxMes.set(key, i)
    meses.push({
      mes: key, label: mesLabel(key),
      carteira: { juros: 0, amort: 0, total: 0, nEventos: 0 },
      mercado: { juros: 0, amort: 0, total: 0, nEventos: 0 },
    })
  }

  const ativos = []
  let comAgenda = 0, semAgenda = 0, semCache = 0

  const cacheFiles = fs.existsSync(CACHE)
    ? new Set(fs.readdirSync(CACHE).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5).toUpperCase()))
    : new Set()

  // Universo: tudo que tem notional de mercado OU e carregado pela carteira.
  const universo = new Set([...debs.keys(), ...carteira.keys()])

  for (const tk of universo) {
    const deb = debs.get(tk)
    const notMercado = deb ? deb.notionalMercado : 0
    const notCarteira = carteira.get(tk) || 0
    if (notMercado <= 0 && notCarteira <= 0) continue

    if (!cacheFiles.has(tk)) { semCache++; continue }
    let cache
    try {
      cache = JSON.parse(fs.readFileSync(path.join(CACHE, `${tk}.json`), 'utf8').replace(/^﻿/, ''))
    } catch { semCache++; continue }
    const content = (cache && cache.content) || []
    if (!content.length) { semAgenda++; continue }

    const parsed = parseAgenda(content, deb ? deb.emissao : '', deb ? deb.vencimento : '')
    const jurosEventos = parsed.eventos.filter(e => !e.amort)
    const anb = anbima.get(tk)
    const cupom = cupomAnual(anb, deb, premissas)

    // Acumuladores por ativo (janela 12m).
    const aCart = { juros: 0, amort: 0 }
    const aMerc = { juros: 0, amort: 0 }

    // JUROS: gap = dias desde o pagamento de juros anterior (ou emissao p/ o 1o).
    const dEmis = parseData(deb ? deb.emissao : '')
    let prevJuros = dEmis
    for (const e of jurosEventos) {
      const gapDias = prevJuros ? Math.max(0, (e.data - prevJuros) / 864e5) : 182
      prevJuros = e.data
      if (e.data <= hoje || e.data >= fim) continue
      const fracao = cupom * (gapDias / 365.25)
      const jMerc = notMercado * fracao
      const jCart = notCarteira * fracao
      const mi = idxMes.get(mesKey(e.data))
      if (mi == null) continue
      meses[mi].mercado.juros += jMerc; meses[mi].mercado.nEventos++
      meses[mi].carteira.juros += jCart; if (notCarteira > 0) meses[mi].carteira.nEventos++
      aMerc.juros += jMerc; aCart.juros += jCart
    }

    // AMORTIZACAO: fracao = taxa%/100 do evento, sobre o notional atual.
    for (const e of parsed.amortizacoes) {
      if (e.data <= hoje || e.data >= fim) continue
      const fracao = (e.pct == null ? 0 : e.pct) / 100
      if (fracao <= 0) continue
      const aM = notMercado * fracao
      const aC = notCarteira * fracao
      const mi = idxMes.get(mesKey(e.data))
      if (mi == null) continue
      meses[mi].mercado.amort += aM; meses[mi].mercado.nEventos++
      meses[mi].carteira.amort += aC; if (notCarteira > 0) meses[mi].carteira.nEventos++
      aMerc.amort += aM; aCart.amort += aC
    }

    comAgenda++
    const totCart = aCart.juros + aCart.amort
    const totMerc = aMerc.juros + aMerc.amort
    if (totCart > 0 || totMerc > 0) {
      ativos.push({
        ticker: tk,
        emissor: deb ? deb.emissor : '',
        incentivada: deb ? deb.incentivada : false,
        indexador: anb ? anb.tipo : (deb ? deb.indice : ''),
        prazo: parsed.amortLabel || (parsed.prazoAnos ? `${parsed.prazoAnos}y` : ''),
        cupomEstimado: Math.round(cupom * 10000) / 100,   // % a.a.
        carteira: { juros: Math.round(aCart.juros), amort: Math.round(aCart.amort) },
        mercado: { juros: Math.round(aMerc.juros), amort: Math.round(aMerc.amort) },
      })
    }
  }

  // Arredonda os meses e fecha totais.
  for (const m of meses) {
    for (const p of ['carteira', 'mercado']) {
      m[p].juros = Math.round(m[p][ 'juros'])
      m[p].amort = Math.round(m[p].amort)
      m[p].total = m[p].juros + m[p].amort
    }
  }
  ativos.sort((a, b) => (b.mercado.juros + b.mercado.amort) - (a.mercado.juros + a.mercado.amort))

  const totalCarteira = meses.reduce((s, m) => s + m.carteira.total, 0)
  const totalMercado = meses.reduce((s, m) => s + m.mercado.total, 0)

  const report = {
    updatedAt: new Date().toISOString(),
    refDate: anbRef || null,
    horizonteMeses: HORIZONTE_MESES,
    premissas,
    cobertura: {
      universo: universo.size,
      comAgenda, semAgenda, semCache,
      tickersCarteira: carteira.size,
    },
    totais: {
      carteira: totalCarteira,
      mercado: totalMercado,
    },
    meses,
    ativos: ativos.slice(0, 400),
  }

  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log('=== Agenda 12m ===')
  console.log(`ref: ${report.refDate} | horizonte: ${HORIZONTE_MESES}m`)
  console.log(`universo ${universo.size} | com agenda ${comAgenda} | sem agenda ${semAgenda} | sem cache ${semCache}`)
  console.log(`total carteira: R$ ${(totalCarteira / 1e6).toFixed(1)}mi | total mercado: R$ ${(totalMercado / 1e6).toFixed(1)}mi`)
  console.log(`-> ${OUT}`)
}

main()

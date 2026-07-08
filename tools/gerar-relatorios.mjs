// gerar-relatorios.mjs
// --------------------------------------------------------------------------
// Gera o "Resumo do Dia": relatorios diarios por DATA DOS DADOS (nao pelo
// calendario). Roda em Node (chamado por atualizar-tudo.ps1), le as bases
// estaticas de public/ + tools/ e os snapshots acumulados, e escreve
// public/reports/daily/<data>.json + <data>.html + index.json.
//
// Reaproveita a logica pura de src/utils/{reports,format,csv}.js — as MESMAS
// funcoes que o app usa no navegador (ESM puro, sem React).
//
// Uso: node tools/gerar-relatorios.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCSV } from '../src/utils/csv.js'
import { fmtBRL, parseNum, isYes } from '../src/utils/format.js'
import {
  parseDia, fmtDia, diffKeyed, topMovers,
  pickReportDates, previousDate, sourceDateFor, summarize, repairText,
} from '../src/utils/reports.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const DATA = path.join(PUBLIC, 'data')
const TOOLS = __dirname
const REPORTS = path.join(PUBLIC, 'reports', 'daily')
const SNAP = path.join(PUBLIC, 'reports', 'snapshots')

const N_REPORTS = 5
const SNAP_KEEP = 10   // dias de snapshot mantidos por fonte

// ─── IO helpers ────────────────────────────────────────────────────────────
function readCsv(file) {
  if (!fs.existsSync(file)) return []
  try { return parseCSV(fs.readFileSync(file, 'utf8')) } catch { return [] }
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }
function digits(s) { return String(s || '').replace(/\D/g, '') }

// ─── Fontes ──────────────────────────────────────────────────────────────
function loadSources() {
  const debentures = readCsv(path.join(PUBLIC, 'Debentures.csv'))
  const anbima = readCsv(path.join(PUBLIC, 'Anbima_Tx.csv'))
  const blc = readCsv(path.join(PUBLIC, 'BLC_tratado.csv'))
  const fundos12431 = readCsv(path.join(TOOLS, 'Fundos_12431.csv'))
  const fundosCdi = readCsv(path.join(TOOLS, 'Fundos_CDI.csv'))
  const dia = {
    '12431': readCsv(path.join(DATA, 'Fluxo_Diario_12431.csv')),
    trad: readCsv(path.join(DATA, 'Fluxo_Diario_Trad.csv')),
  }
  const perf = {
    '12431': readCsv(path.join(DATA, 'Perf_Diario_12431.csv')),
    trad: readCsv(path.join(DATA, 'Perf_Diario_Trad.csv')),
  }
  const atributos = loadAtributos()
  return { debentures, anbima, blc, fundos12431, fundosCdi, dia, perf, atributos }
}

// Atributos de cadastro (CVM) por fundo curado — persistidos em
// public/data/Fundos_Atributos.csv pela pipeline (preparar-atributos-fundos.ps1),
// ja que o gerador roda offline. Chave: CNPJ_FUNDO_CLASSE (so digitos).
function loadAtributos() {
  const f = path.join(DATA, 'Fundos_Atributos.csv')
  const map = new Map()
  if (!fs.existsSync(f)) return map
  for (const r of readCsv(f)) {
    const c = digits(r.CNPJ_FUNDO_CLASSE || r.CNPJ || '')
    if (!c) continue
    const forma = (r.Forma_Condominio || '').trim()
    map.set(c, {
      lista: (r.Lista || '').trim(),
      forma,
      fechado: /fechad/i.test(forma),
      tipo: (r.Tipo_Classe || '').trim(),
      situacao: (r.Situacao || '').trim(),
      dataRegistro: (r.Data_Registro || '').trim(),
      dataInicio: (r.Data_Inicio || '').trim(),
    })
  }
  return map
}

// Le um snapshot de uma fonte numa data ('AAAA-MM-DD'), se existir.
function readSnapshot(fonte, dataKey) {
  if (!dataKey) return null
  const f = path.join(SNAP, fonte, `${dataKey}.csv`)
  return fs.existsSync(f) ? readCsv(f) : null
}
function snapshotDates(fonte) {
  const dir = path.join(SNAP, fonte)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.csv'))
    .map(f => f.replace(/\.csv$/, ''))
    .filter(d => parseDia(d))
    .sort()
}

// ─── Datas de referencia por fonte ─────────────────────────────────────────
function distinctDates(rows, col) {
  const s = new Set()
  for (const r of rows) { const p = parseDia(r[col]); if (p) s.add(p.key) }
  return [...s].sort()
}

function perSourceDates(src) {
  const debReg = distinctDates(src.debentures, 'Data de Registro CVM da Emissao')
  const cap12431 = distinctDates(src.dia['12431'], 'Dia')
  const capTrad = distinctDates(src.dia.trad, 'Dia')
  const perf12431 = distinctDates(src.perf['12431'], 'Dia')
  const perfTrad = distinctDates(src.perf.trad, 'Dia')
  // ANBIMA/BLC/Fundos: data atual (do arquivo) + snapshots ja salvos.
  const anbimaAtual = distinctDates(src.anbima, 'dataReferenciaAnbima')
  const anbima = [...new Set([...anbimaAtual, ...snapshotDates('anbima')])].sort()
  const blc = [...new Set([...snapshotDates('blc')])].sort()
  const fundos = [...new Set([...snapshotDates('fundos')])].sort()
  return {
    debentures: debReg,
    cap12431, capTrad,
    perf12431, perfTrad,
    anbima, blc, fundos,
  }
}

// ─── Secoes ─────────────────────────────────────────────────────────────
// §2 Novas debentures cadastradas (registro CVM == D). "Saiu" precisa snapshot.
function buildDebentures(src, D, emissoresMap = new Map()) {
  const novasRows = src.debentures.filter(r => {
    const p = parseDia(r['Data de Registro CVM da Emissao'])
    return p && p.key === D
  })
  const map = r => ({
    ticker: (r['Codigo do Ativo'] || '').trim(),
    empresa: repairText((r['Empresa'] || '').trim()),
    grupo: (emissoresMap.get(digits(r['CNPJ'])) || {}).grupo || '',
    cnpj: digits(r['CNPJ']),
    dataRegistro: r['Data de Registro CVM da Emissao'] || '',
    dataEmissao: r['Data de Emissao'] || '',
    vencimento: r['Data de Vencimento'] || '',
    indexador: (r['indice'] || '').trim(),
    taxa: (r['Juros Criterio Novo - Taxa'] || '').trim(),
    // Volume emitido = Quantidade Emitida x Valor Nominal na Emissao (mesma conta do app).
    volumeEmitido: parseNum(r['Quantidade Emitida']) * parseNum(r['Valor Nominal na Emissao']),
    incentivada: isYes(r['Deb. Incent. (Lei 12.431)']),
    coordenador: (r['Coordenador Lider'] || '').trim(),
  })
  const novas = novasRows.map(map)
  // Saidas: precisa de um snapshot anterior de Debentures (por ticker).
  const snapDates = snapshotDates('debentures')
  const prevKey = previousDate(snapDates, D)
  let saidas = []
  if (prevKey) {
    const prev = readSnapshot('debentures', prevKey) || []
    const d = diffKeyed(prev, src.debentures, r => (r['Codigo do Ativo'] || '').trim())
    saidas = d.removed.map(map)
  }
  return { novas, saidas, temSnapshotAnterior: !!prevKey }
}

// §3 Captacao liquida do dia (por segmento) vs dia anterior disponivel.
function aggDiaSegmento(rows, dia) {
  const doDia = rows.filter(r => (parseDia(r.Dia) || {}).key === dia)
  if (!doDia.length) return null
  let cap = 0, res = 0, pl = 0, nf = 0
  for (const r of doDia) {
    cap += parseNum(r.Captacao); res += parseNum(r.Resgate)
    pl += parseNum(r.PL); nf += parseNum(r.Num_Fundos)
  }
  return { dia, captacao: cap, resgate: res, liquido: cap - res, pl, numFundos: Math.round(nf) }
}
// O ultimo dia do Informe Diario da CVM quase sempre chega incompleto (os fundos
// reportam com defasagem). Detectamos "dias parciais" pela cobertura (nº de fundos
// que reportaram) e, para captacao/gestores/performance, usamos o ultimo dia
// COMPLETO <= D -- nunca um dia parcial que enganaria a leitura.
const COBERTURA_MIN_FRAC = 0.5

function coberturaPorDia(rows, diaCol, contaFn) {
  const m = new Map()
  for (const r of rows || []) {
    const k = (parseDia(r[diaCol]) || {}).key
    if (!k) continue
    m.set(k, (m.get(k) || 0) + contaFn(r))
  }
  return m
}

function mediana(nums) {
  const a = nums.filter(n => n > 0).sort((x, y) => x - y)
  if (!a.length) return 0
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

// Resolve, para uma base diaria de fluxo, o ultimo dia completo <= D, o dia
// completo anterior (para comparar), e o dia parcial mais recente que foi pulado.
function resolverDiaFluxo(cov, D) {
  const med = mediana([...cov.values()])
  const limite = med * COBERTURA_MIN_FRAC
  const completos = [...cov.keys()].filter(k => k <= D && cov.get(k) >= limite).sort()
  const atual = completos.length ? completos[completos.length - 1] : null
  const anterior = completos.length > 1 ? completos[completos.length - 2] : null
  const pulados = [...cov.keys()].filter(k => k <= D && (!atual || k > atual)).sort()
  const parcialRecente = pulados.length
    ? { dia: pulados[pulados.length - 1], cobertura: cov.get(pulados[pulados.length - 1]), normal: Math.round(med) }
    : null
  return { atual, anterior, parcialRecente }
}

// Datas de fluxo (captacao/perf) por segmento, ja resolvidas para dias completos.
function resolverFluxos(src, D) {
  return {
    cap12431:  resolverDiaFluxo(coberturaPorDia(src.dia['12431'], 'Dia', r => parseNum(r.Num_Fundos)), D),
    capTrad:   resolverDiaFluxo(coberturaPorDia(src.dia.trad,    'Dia', r => parseNum(r.Num_Fundos)), D),
    perf12431: resolverDiaFluxo(coberturaPorDia(src.perf['12431'], 'Dia', () => 1), D),
    perfTrad:  resolverDiaFluxo(coberturaPorDia(src.perf.trad,    'Dia', () => 1), D),
  }
}

function buildCaptacao(src, flow) {
  // Tamanho da lista CURADA (constante — so muda com "Aplicar sugestao de fundos").
  // numFundos = quantos desses reportaram no dia; curados = o total da lista.
  const curados = { '12431': (src.fundos12431 || []).length, trad: (src.fundosCdi || []).length }
  // Fundos fechados na lista (condominio fechado captam via emissao de cotas —
  // fluxo esporadico e "lumpy"; contamos para contextualizar a captacao do dia).
  const atrib = src.atributos || new Map()
  const listaCnpjs = { '12431': (src.fundos12431 || []), trad: (src.fundosCdi || []) }
  const fechados = {}
  for (const seg of ['12431', 'trad']) {
    let n = 0
    for (const r of listaCnpjs[seg]) {
      const a = atrib.get(digits(r.CNPJ_FUNDO_CLASSE || r.CNPJ || ''))
      if (a && a.fechado) n++
    }
    fechados[seg] = n
  }
  const out = {}
  for (const [seg, key] of [['12431', 'cap12431'], ['trad', 'capTrad']]) {
    const atual = flow[key].atual
    const anterior = flow[key].anterior
    const cur = atual ? aggDiaSegmento(src.dia[seg], atual) : null
    const prev = anterior ? aggDiaSegmento(src.dia[seg], anterior) : null
    out[seg] = cur ? { ...cur, curados: curados[seg], fechados: fechados[seg], anterior: prev } : null
  }
  return out
}

// §4 Destaques por gestor (top ± liquida) por segmento, no dia da fonte.
function buildGestores(src, sourceDates) {
  const out = {}
  for (const [seg, key] of [['12431', 'cap12431'], ['trad', 'capTrad']]) {
    const dia = sourceDates[key]
    const doDia = dia ? src.dia[seg].filter(r => (parseDia(r.Dia) || {}).key === dia) : []
    const rows = doDia.map(r => ({
      gestor: (r.Gestor_Apelido || '').trim(),
      captacao: parseNum(r.Captacao), resgate: parseNum(r.Resgate),
      liquido: parseNum(r.Captacao) - parseNum(r.Resgate), pl: parseNum(r.PL),
    }))
    out[`top${seg === '12431' ? '12431' : 'Trad'}Captacao`] = topMovers(rows, r => r.liquido, 5, 'desc').filter(r => r.liquido > 0)
    out[`top${seg === '12431' ? '12431' : 'Trad'}Resgate`] = topMovers(rows, r => r.liquido, 5, 'asc').filter(r => r.liquido < 0)
  }
  return out
}

// Extrai o "spread de mercado" de uma linha ANBIMA, sempre em bps, reaproveitando
// as colunas que o pipeline ja calcula. A variacao do Resumo do Dia e SEMPRE a
// diferenca desse spread (curr - prev) em bps, comparando so bases iguais:
//   DI_SPREAD      -> taxaAnbimaOriginal ja e o CDI+ (%). bps = %*100.  base 'CDI'
//   DI_PERCENTUAL  -> %CDI ja convertido pra CDI+ em spreadCdiEquivalente. base 'CDI'
//   IPCA_SPREAD    -> spread sobre a NTN-B de referencia, ja em bps.     base = B32/B35...
//   PREFIXADO/IGP-M-> sem benchmark de spread; variacao do proprio yield. base 'Pre'/'IGP-M'
// parseNum('') = 0 (nao NaN), entao precisamos tratar vazio como "ausente" para
// nao confundir "sem conversao" com "spread zero".
function numOrNull(v) {
  const s = String(v == null ? '' : v).trim()
  if (s === '') return null
  const n = parseNum(s)
  return Number.isNaN(n) ? null : n
}
function spreadInfo(r) {
  const tipo = (r.tipoTaxaAnbima || '').trim()
  if (tipo === 'IPCA_SPREAD') {
    const bps = numOrNull(r.spreadNtnbBps)
    if (bps === null) return null
    return { bps, base: (r.codigoNtnbExibicao || 'NTN-B').trim() || 'NTN-B', tipo: 'ipca' }
  }
  if (tipo === 'DI_PERCENTUAL') {
    const s = numOrNull(r.spreadCdiEquivalente)  // %CDI ja convertido pra CDI+ pelo pipeline
    if (s === null) return null
    return { bps: s * 100, base: 'CDI', tipo: 'cdi' }
  }
  if (tipo === 'DI_SPREAD') {
    const s = numOrNull(r.taxaAnbimaOriginal)    // ja e o proprio CDI+ (%)
    if (s === null) return null
    return { bps: s * 100, base: 'CDI', tipo: 'cdi' }
  }
  if (tipo === 'PREFIXADO') {
    const s = numOrNull(r.spreadCdiEquivalente)  // convertido pra CDI+ pela pipeline (via LTN)
    if (s !== null) return { bps: s * 100, base: 'CDI', tipo: 'cdi' }
    const y = numOrNull(r.taxaAnbimaOriginal)    // sem LTN de referencia: cai pro yield
    if (y === null) return null
    return { bps: y * 100, base: 'Pré', tipo: 'yield' }
  }
  const y = numOrNull(r.taxaAnbimaOriginal)      // IGP-M / outros: variacao do yield
  if (y === null) return null
  const base = tipo === 'IGP-M' ? 'IGP-M' : (tipo || 'yield')
  return { bps: y * 100, base, tipo: 'yield' }
}

// Familia do indexador (para exibir), a partir do tipo de taxa da ANBIMA.
function indexadorFamilia(tipo) {
  const t = (tipo || '').trim()
  if (t === 'DI_SPREAD') return 'CDI+'
  if (t === 'DI_PERCENTUAL') return '%CDI'
  if (t === 'IPCA_SPREAD') return 'IPCA+'
  if (t === 'PREFIXADO') return 'Pré'
  if (t === 'IGP-M') return 'IGP-M'
  return t || '—'
}

// §5 Variacao ANBIMA — sempre em bps, sobre o spread (taxa/spread, NUNCA preco).
// Top 15. Enriquece com emissor+grupo (join ticker->Debentures->cadastro).
// Precisa de snapshot anterior da fonte.
function buildAnbima(src, sourceDates, tickerInfo) {
  const atual = sourceDates.anbima
  const anterior = previousDate(perSourceDates(src).anbima, atual)
  if (!atual || !anterior) return { aberturas: [], fechamentos: [], atual, anterior, semAnterior: true }
  const prev = readSnapshot('anbima', anterior) || (anterior === distinctDates(src.anbima, 'dataReferenciaAnbima')[0] ? src.anbima : null)
  const curr = readSnapshot('anbima', atual) || src.anbima
  if (!prev) return { aberturas: [], fechamentos: [], atual, anterior, semAnterior: true }
  const key = r => (r.ticker || '').trim()
  const prevMap = new Map(prev.map(r => [key(r), r]))
  const movs = []
  for (const r of curr) {
    const p = prevMap.get(key(r))
    if (!p) continue
    const si = spreadInfo(r), sp = spreadInfo(p)
    if (!si || !sp) continue
    if (si.base !== sp.base) continue           // benchmark girou (ex.: B35->B33): spread incomparavel
    const variacaoBps = si.bps - sp.bps
    if (Math.abs(variacaoBps) < 0.05) continue  // ruido sub-0,05 bps
    const ti = tickerInfo.get(key(r)) || {}
    const dur = parseNum(r.durationAnbimaAnos)
    const fmtAtual = repairText((r.txAnbimaFormatada || '').trim())
    // Spread atual exibido: tipo CDI (inclui Pré e %CDI convertidos) mostra "CDI ± X,XX%";
    // IPCA mostra "B32 + N bps"; yield puro (IGP-M/Pré sem LTN) mostra a taxa.
    const spreadAtual = si.tipo === 'cdi'
      ? `CDI ${si.bps >= 0 ? '+' : '−'} ${Math.abs(si.bps / 100).toFixed(2).replace('.', ',')}%`
      : fmtAtual
    movs.push({
      ticker: key(r), indexador: repairText((r.indexadorAnbima || '').trim()),
      indexadorFamilia: indexadorFamilia(r.tipoTaxaAnbima),
      emissor: ti.empresa || '', grupo: ti.grupo || '',
      base: si.base, tipo: si.tipo,
      spreadAnteriorBps: sp.bps, spreadAtualBps: si.bps, variacaoBps,
      fmtAnterior: repairText((p.txAnbimaFormatada || '').trim()),
      fmtAtual, spreadAtual,
      durationAnos: Number.isNaN(dur) ? null : dur,
      status: (r.statusCalculoAnbima || '').trim(),
    })
  }
  return {
    // abertura = spread abriu (+bps); fechamento = spread fechou (-bps)
    aberturas: topMovers(movs, m => m.variacaoBps, 15, 'desc').filter(m => m.variacaoBps > 0),
    fechamentos: topMovers(movs, m => m.variacaoBps, 15, 'asc').filter(m => m.variacaoBps < 0),
    atual, anterior, semAnterior: false,
  }
}

// §7 Fundos incluidos/excluidos (vs snapshot anterior de Fundos_*).
function buildFundos(src, D) {
  const dates = snapshotDates('fundos')
  const prevKey = previousDate(dates, D)
  if (!prevKey) return { novos: [], removidos: [], semAnterior: true }
  const prev = readSnapshot('fundos', prevKey) || []
  const curr = [
    ...src.fundos12431.map(r => ({ ...r, __seg: '12431' })),
    ...src.fundosCdi.map(r => ({ ...r, __seg: 'trad' })),
  ]
  const kf = r => digits(r.CNPJ_FUNDO_CLASSE)
  const d = diffKeyed(prev, curr, kf)
  const map = r => ({ cnpj: kf(r), nome: repairText((r.DENOM_SOCIAL || '').trim()), segmento: r.__seg || '' })
  return { novos: d.added.map(map), removidos: d.removed.map(map), semAnterior: false }
}

// §8 Performance de fundos (retorno da cota do dia). Nome vem dos Fundos_*.
function buildPerf(src, sourceDates) {
  const nomePorCnpj = new Map()
  for (const r of [...src.fundos12431, ...src.fundosCdi]) {
    const c = digits(r.CNPJ_FUNDO_CLASSE); if (c) nomePorCnpj.set(c, repairText((r.DENOM_SOCIAL || '').trim()))
  }
  const out = {}
  for (const [seg, key] of [['12431', 'perf12431'], ['trad', 'perfTrad']]) {
    const dia = sourceDates[key]
    const doDia = dia ? src.perf[seg].filter(r => (parseDia(r.Dia) || {}).key === dia) : []
    const rows = doDia.map(r => ({
      cnpj: digits(r.CNPJ_Fundo), nome: nomePorCnpj.get(digits(r.CNPJ_Fundo)) || digits(r.CNPJ_Fundo),
      gestor: (r.Gestor_Apelido || '').trim(), segmento: seg,
      retorno: parseNum(r.RetornoCota), pl: parseNum(r.PL),
    }))
    // Altas = só retorno positivo; quedas = só negativo (evita "alta" negativa).
    out[`top${seg === '12431' ? '12431' : 'Trad'}Pos`] = topMovers(rows, r => r.retorno, 5, 'desc').filter(r => r.retorno > 0)
    out[`top${seg === '12431' ? '12431' : 'Trad'}Neg`] = topMovers(rows, r => r.retorno, 5, 'asc').filter(r => r.retorno < 0)
  }
  return out
}

// §6 Ativos incluidos nas tabelas (novos tickers em Debentures/BLC via snapshot).
function buildInclusoes(src, D, secDeb) {
  const novosDeb = secDeb.novas.map(x => x.ticker)   // ja calculado por registro
  // BLC: novos CD_ATIVO vs snapshot.
  const blcDates = snapshotDates('blc')
  const prevBlcKey = previousDate(blcDates, D)
  let novosBlc = []
  if (prevBlcKey) {
    const prev = readSnapshot('blc', prevBlcKey) || []
    const d = diffKeyed(prev, src.blc, r => (r.CD_ATIVO || '').trim())
    novosBlc = d.added.map(r => (r.CD_ATIVO || '').trim())
  }
  return { novosDebentures: novosDeb, novosBlc, temSnapshotBlc: !!prevBlcKey }
}

// §9 Alertas de qualidade.
function buildAlertas(src, D, sections, flow) {
  const alertas = []
  // Dia parcial do Informe Diario: avisa quando o dia mais recente veio incompleto
  // e a captacao/performance estao exibindo o ultimo dia completo.
  for (const [key, rotulo] of [['cap12431', 'Incentivados'], ['capTrad', 'Tradicional']]) {
    const pr = flow?.[key]?.parcialRecente
    if (pr && flow[key].atual) {
      alertas.push({
        tipo: 'dia-parcial',
        texto: `Dia ${fmtDia(pr.dia)} parcial no segmento ${rotulo} (${pr.cobertura} fundos vs ~${pr.normal}); captacao/performance exibem ${fmtDia(flow[key].atual)} (ultimo dia completo)`,
      })
    }
  }
  // BLC com ativos que nao existem em Debentures.csv.
  const tickersDeb = new Set(src.debentures.map(r => (r['Codigo do Ativo'] || '').trim()).filter(Boolean))
  const semCadastro = new Set()
  for (const r of src.blc) {
    const a = (r.CD_ATIVO || '').trim()
    if (a && !tickersDeb.has(a)) semCadastro.add(a)
  }
  if (semCadastro.size) alertas.push({ tipo: 'blc-sem-cadastro', texto: `${semCadastro.size} ativo(s) no BLC sem correspondencia em Debentures.csv` })
  // ANBIMA sem dia anterior para comparar.
  if (sections.anbima?.semAnterior) alertas.push({ tipo: 'anbima-sem-anterior', texto: 'ANBIMA sem dia anterior disponivel para comparacao (comeca a partir do proximo snapshot)' })
  // Captacao sem dia anterior.
  for (const seg of ['12431', 'trad']) {
    if (sections.captacao?.[seg] && !sections.captacao[seg].anterior) {
      alertas.push({ tipo: 'captacao-sem-anterior', texto: `Captacao ${seg === '12431' ? 'Incentivados' : 'Tradicional'} sem dia anterior para comparar` })
    }
  }
  return alertas
}

// ─── Monta um relatorio completo para a data D ─────────────────────────────
// Emissoes ja registradas na CVM (oferta_distribuicao / Resolucao 160) que ainda
// nao entraram no cadastro. A etapa "Ofertas CVM" grava public/data/Novas_Emissoes_CVM.json.
// E uma lista de "pendencias" (asOf), so anexada ao relatorio mais recente.
function loadEmissoesCVM() {
  const f = path.join(DATA, 'Novas_Emissoes_CVM.json')
  if (!fs.existsSync(f)) return null
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const itens = (j.itens || []).map(e => ({
      dataRegistro: e.dataRegistro || '',
      dataRequerimento: e.dataRequerimento || '',
      emissor: repairText((e.emissor || '').trim()),
      cnpj: digits(e.cnpj),
      emissao: e.emissao,
      valor: parseNum(e.valor),
      incentivada: !!e.incentivada,
      lider: repairText((e.lider || '').trim()),
    })).sort((a, b) => {
      const ka = a.dataRequerimento || a.dataRegistro, kb = b.dataRequerimento || b.dataRegistro
      return ka < kb ? 1 : ka > kb ? -1 : 0
    })
    return { asOf: j.asOf || j.geradoEm || '', itens }
  } catch { return null }
}

// Cadastro de emissores (CNPJ -> grupo/setor) — inteligencia do usuario, snapshot
// em public/Emissores.csv pela pipeline (preparar-emissores.ps1). Usado para a
// coluna Grupo (ANBIMA) e para detectar emissores novos ainda nao classificados.
function loadEmissores() {
  const f = path.join(PUBLIC, 'Emissores.csv')
  if (!fs.existsSync(f)) return new Map()
  const pick = (r, names) => { for (const n of names) { const v = r[n]; if (v != null && String(v).trim() !== '') return String(v).trim() } return '' }
  const CNPJ = ['CNPJ Emissor', 'CNPJ do Emissor', 'CNPJ_EMISSOR', 'CNPJ']
  const EMP = ['Emissor', 'Empresa', 'Nome Empresa', 'Razao Social', 'Razão Social', 'Nome']
  const GRP = ['Grupo', 'Grupo Economico', 'Grupo Econômico']
  const SET = ['Setor', 'Segmento', 'Setor Economico']
  const map = new Map()
  for (const r of readCsv(f)) {
    const c = digits(pick(r, CNPJ)); if (!c) continue
    map.set(c, { grupo: repairText(pick(r, GRP)), setor: repairText(pick(r, SET)), empresa: repairText(pick(r, EMP)) })
  }
  return map
}

// Emissores que aparecem nas EMISSOES NOVAS (ofertas CVM) mas ainda nao estao no
// cadastro do usuario — ele precisa classificar o grupo economico (o ouro dele).
function buildEmissoresFaltantes(emissoresMap, emissoesCVM) {
  if (!emissoesCVM) return null
  const seen = new Set()
  const itens = []
  for (const e of emissoesCVM.itens || []) {
    const c = digits(e.cnpj)
    if (!c || seen.has(c)) continue
    seen.add(c)
    if (!emissoresMap.has(c)) itens.push({ cnpj: c, emissor: e.emissor })
  }
  return { itens, asOf: emissoesCVM.asOf }
}

// Mapa ticker (Codigo do Ativo) -> { empresa, grupo } a partir do Debentures.csv
// + cadastro de emissores (por CNPJ). Usado para enriquecer a tabela de ANBIMA.
function buildTickerInfo(src, emissoresMap) {
  const m = new Map()
  for (const r of src.debentures) {
    const t = (r['Codigo do Ativo'] || '').trim()
    if (!t) continue
    const grupo = (emissoresMap.get(digits(r['CNPJ'])) || {}).grupo || ''
    m.set(t, { empresa: repairText((r['Empresa'] || '').trim()), grupo })
  }
  return m
}

function buildReport(src, D, allDates, emissoesCVM = null, emissoresMap = new Map()) {
  const sd = perSourceDates(src)
  // Fluxo (captacao/perf) resolvido para o ultimo dia COMPLETO <= D (pula dias
  // parciais do Informe Diario); as demais fontes usam a data mais recente <= D.
  const flow = resolverFluxos(src, D)
  const sourceDates = {
    debentures: sourceDateFor(sd.debentures, D),
    cap12431: flow.cap12431.atual,
    capTrad: flow.capTrad.atual,
    perf12431: flow.perf12431.atual,
    perfTrad: flow.perfTrad.atual,
    anbima: sourceDateFor(sd.anbima, D),
    blc: sourceDateFor(sd.blc, D),
    fundos: sourceDateFor(sd.fundos, D),
  }
  const debentures = buildDebentures(src, D, emissoresMap)
  const captacao = buildCaptacao(src, flow)
  const gestores = buildGestores(src, sourceDates)
  const anbima = buildAnbima(src, sourceDates, buildTickerInfo(src, emissoresMap))
  const fundos = buildFundos(src, D)
  const perf = buildPerf(src, sourceDates)
  const inclusoes = buildInclusoes(src, D, debentures)
  const sections = { debentures, captacao, gestores, anbima, fundos, perf, inclusoes }
  const alertas = buildAlertas(src, D, sections, flow)
  const summaryInput = {
    debentures, captacao,
    gestores: {
      top12431Captacao: gestores.top12431Captacao, topTradCaptacao: gestores.topTradCaptacao,
      top12431Resgate: gestores.top12431Resgate, topTradResgate: gestores.topTradResgate,
    },
    anbima, fundos, alertas,
  }
  const previousDateOverall = allDates.filter(d => d < D).sort().pop() || null
  // Enriquece cada oferta CVM com o grupo economico do cadastro (join por CNPJ).
  const emissoesCVMenriquecido = emissoesCVM ? {
    ...emissoesCVM,
    itens: emissoesCVM.itens.map(e => ({ ...e, grupo: (emissoresMap.get(digits(e.cnpj)) || {}).grupo || '' })),
  } : null
  return {
    date: D,
    label: fmtDia(D),
    previousDate: previousDateOverall,
    sourceDates,
    summary: summarize(summaryInput),
    sections: { ...sections, alertas, emissoesCVM: emissoesCVMenriquecido, emissoresFaltantes: buildEmissoresFaltantes(emissoresMap, emissoesCVM) },
  }
}

// ─── HTML self-contained ───────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function money(v) { return fmtBRL(typeof v === 'number' ? v : parseNum(v)) }
// Valor em milhoes de reais (R$ MM), 1 casa, separador pt-BR. So o numero.
function fmtMM(v) {
  const n = (typeof v === 'number' ? v : parseNum(v)) / 1e6
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
// Valor monetário com cor pelo sinal (verde positivo / vermelho negativo),
// seguindo a identidade do app (fluxo positivo = captação, negativo = resgate).
function moneyC(v) {
  const n = typeof v === 'number' ? v : parseNum(v)
  const cls = n > 0 ? 'val pos' : n < 0 ? 'val neg' : 'val'
  return `<span class="${cls}">${esc(money(v))}</span>`
}
function pct(v, casas = 2) {
  const n = Number(v)
  const cls = n > 0 ? 'val pos' : n < 0 ? 'val neg' : 'val'
  return `<span class="${cls}">${n.toFixed(casas)}%</span>`
}
// Variacao em bps com sinal e minus tipografico; 1 casa, sem zero a direita.
function fmtBps(v) {
  const r = Math.round(v)   // bps ja e granular: inteiro, sem sufixo (o header diz "bps")
  const sinal = r > 0 ? '+' : r < 0 ? '−' : ''
  return `${sinal}${Math.abs(r)}`
}

function renderHtml(rep) {
  const s = rep.sections
  const empty = txt => `<p class="empty">${esc(txt)}</p>`
  const bullets = rep.summary.length
    ? `<ul class="sumario">${rep.summary.map(b => `<li class="${esc(b.tom || '')}">${esc(b.texto)}</li>`).join('')}</ul>`
    : empty('Sem eventos relevantes neste dia.')

  const debTable = s.debentures.novas.length
    ? `<div class="tw"><table><thead><tr><th>Ativo</th><th>Emis.</th><th>Venc.</th><th>Taxa</th><th class="num">Vol. emit.</th></tr></thead><tbody>${
        s.debentures.novas.map(d => `<tr><td><strong>${esc(d.ticker)}</strong>${d.grupo ? `<br><span class="cap-dia">${esc(d.grupo)}</span>` : ''}</td><td>${esc(fmtDia(d.dataEmissao))}</td><td>${esc(fmtDia(d.vencimento))}</td><td>${esc(d.taxa)}</td><td class="num">${d.volumeEmitido > 0 ? esc(money(d.volumeEmitido)) : '-'}</td></tr>`).join('')
      }</tbody></table></div>`
    : empty('Sem novas debêntures neste dia.')

  // Emissoes registradas na CVM ainda nao cadastradas (so no relatorio mais recente).
  const cvm = s.emissoesCVM
  const cvmBlock = cvm
    ? (cvm.itens.length
        ? `<h4>Registradas na CVM, ainda não no cadastro${cvm.asOf ? ` <span class="cap-dia">posição em ${esc(fmtDia(cvm.asOf))}</span>` : ''}</h4>
           <div class="tw"><table><thead><tr><th>Data req.</th><th>Emissão</th><th>Emissor</th><th>Grupo</th><th>Líder</th><th>Valor (R$ MM)</th></tr></thead><tbody>${
             cvm.itens.map(e => `<tr><td>${esc(fmtDia(e.dataRequerimento || e.dataRegistro))}</td><td>${esc(String(e.emissao ?? ''))}ª</td><td>${esc(e.emissor)}</td><td>${esc(e.grupo || '—')}</td><td>${esc(e.lider)}</td><td class="num">${esc(fmtMM(e.valor))}</td></tr>`).join('')
           }</tbody></table></div>`
        : `<h4>Registradas na CVM, ainda não no cadastro</h4>${empty('Nenhuma emissão pendente na CVM neste momento.')}`)
    : ''

  // Inclusoes no BLC (antigo §6, agora dentro do §2).
  const inclNote = s.inclusoes.temSnapshotBlc && s.inclusoes.novosBlc.length
    ? `<p class="tally">Novos ativos no BLC/alocação: <strong>${s.inclusoes.novosBlc.length}</strong></p>`
    : ''

  // Emissores das emissoes novas que ainda nao estao no cadastro do usuario.
  const falt = s.emissoresFaltantes
  const faltantesBlock = falt && falt.itens.length
    ? `<h4>Emissores novos sem grupo cadastrado <span class="cap-dia">(${falt.itens.length})</span></h4>
       <p class="tally">Classifique o grupo econômico e adicione ao seu cadastro — lista também em <code>Emissores_Faltantes.csv</code>.</p>
       <div class="tw"><table><thead><tr><th>CNPJ</th><th>Emissor</th></tr></thead><tbody>${
         falt.itens.map(e => `<tr><td>${esc(e.cnpj)}</td><td>${esc(e.emissor)}</td></tr>`).join('')
       }</tbody></table></div>`
    : ''

  const capBlock = `<div class="cap-grid">${['12431', 'trad'].map(seg => {
    const c = s.captacao[seg]
    const nome = seg === '12431' ? 'Incentivados (12.431)' : 'Crédito Tradicional'
    if (!c) return `<div class="cap-card"><h4>${nome}</h4>${empty('Sem dado de captação neste dia.')}</div>`
    return `<div class="cap-card"><h4>${nome} <span class="cap-dia">${esc(fmtDia(c.dia))}</span></h4><table class="kv"><tbody>
      <tr><td>Captação</td><td>${moneyC(c.captacao)}</td></tr>
      <tr><td>Resgate</td><td>${moneyC(-Math.abs(parseNum(c.resgate)))}</td></tr>
      <tr><td>Líquido</td><td>${moneyC(c.liquido)}</td></tr>
      <tr><td>PL</td><td><span class="val">${esc(money(c.pl))}</span></td></tr>
      <tr><td>Fundos reportados</td><td><span class="val">${c.numFundos}${c.curados ? ` <span class="cap-dia">de ${c.curados}</span>` : ''}</span></td></tr>
      ${c.fechados ? `<tr><td>Fundos fechados</td><td><span class="val">${c.fechados}</span> <span class="cap-dia">condomínio fechado (captam por emissão de cotas)</span></td></tr>` : ''}
      ${c.anterior ? `<tr class="ant"><td>Líquido (dia anterior ${esc(fmtDia(c.anterior.dia))})</td><td>${moneyC(c.anterior.liquido)}</td></tr>` : ''}
    </tbody></table></div>`
  }).join('')}</div>`

  // §4 gestor: duas tabelas lado a lado (12.431 | Tradicional), cada uma com
  // Top 5 captacao liquida positiva (verde) e negativa (vermelho).
  const gestSeg = (cap, res, nome) => {
    const linha = g => `<tr><td>${esc(g.gestor)}</td><td class="num ${g.liquido >= 0 ? 'pos' : 'neg'}">${esc(money(g.liquido))}</td></tr>`
    if (!(cap && cap.length) && !(res && res.length)) return `<div class="cap-card"><h4>${nome}</h4>${empty('Sem destaques.')}</div>`
    return `<div class="cap-card"><h4>${nome}</h4><table><thead><tr><th>Gestor</th><th class="num">Cap. líquida</th></tr></thead><tbody>${
      (cap || []).map(linha).join('')}${(res || []).map(linha).join('')
    }</tbody></table></div>`
  }
  const gestBlock = `<div class="cap-grid">${
    gestSeg(s.gestores.top12431Captacao, s.gestores.top12431Resgate, 'Incentivados (12.431)')
  }${gestSeg(s.gestores.topTradCaptacao, s.gestores.topTradResgate, 'Crédito Tradicional')}</div>`

  // §5 ANBIMA: tabela de spread (top 15). abertura (+bps)=vermelho; fechamento (−bps)=verde.
  const anbimaVar = v => `<span class="${v > 0 ? 'val neg' : v < 0 ? 'val pos' : 'val'}">${fmtBps(v)}</span>`
  const anbimaTable = arr => `<div class="tw"><table><thead><tr><th>Ativo</th><th>Grupo</th><th>Emissor</th><th>Indexador</th><th>Spread atual</th><th class="num">Duration (a)</th><th class="num">Var. (bps)</th></tr></thead><tbody>${
    arr.map(a => `<tr><td>${esc(a.ticker)}</td><td>${esc(a.grupo || '—')}</td><td>${esc(a.emissor || '—')}</td><td>${esc(a.indexadorFamilia)}</td><td>${esc(a.spreadAtual || a.fmtAtual || '—')}</td><td class="num">${a.durationAnos != null ? a.durationAnos.toFixed(2) : '—'}</td><td class="num">${anbimaVar(a.variacaoBps)}</td></tr>`).join('')
  }</tbody></table></div>`
  const anbimaBlock = s.anbima.semAnterior
    ? empty('Sem dia anterior de ANBIMA para comparar (começa no próximo snapshot).')
    : `${s.anbima.aberturas.length ? `<h4>Maiores aberturas de spread</h4>${anbimaTable(s.anbima.aberturas)}` : ''}
       ${s.anbima.fechamentos.length ? `<h4>Maiores fechamentos de spread</h4>${anbimaTable(s.anbima.fechamentos)}` : ''}
       ${!s.anbima.aberturas.length && !s.anbima.fechamentos.length ? empty('Sem variações de spread neste dia.') : ''}`

  const perfBlock = `<p class="tally">Retorno nominal da cota no dia (não é %CDI).</p>` + ['12431', 'Trad'].map(seg => {
    const pos = s.perf[`top${seg}Pos`] || [], neg = s.perf[`top${seg}Neg`] || []
    const nome = seg === '12431' ? 'Incentivados' : 'Tradicional'
    if (!pos.length && !neg.length) return `<h4>${nome}</h4>${empty('Sem performance diária neste dia.')}`
    const li = f => `<li><span class="g-nome">${esc(f.nome)} <em>(${esc(f.gestor)})</em></span><span class="g-val">${pct(f.retorno)}</span></li>`
    return `${pos.length ? `<h4>${nome} — maiores altas</h4><ol class="rank">${pos.map(li).join('')}</ol>` : ''}${neg.length ? `<h4>${nome} — maiores quedas</h4><ol class="rank">${neg.map(li).join('')}</ol>` : ''}`
  }).join('')

  const fundosBlock = s.fundos.semAnterior
    ? empty('Sem snapshot anterior do universo de fundos (começa no próximo).')
    : `<p class="tally">Novos: <strong>${s.fundos.novos.length}</strong> · Removidos: <strong>${s.fundos.removidos.length}</strong></p>${
        s.fundos.novos.length ? `<h4>Novos</h4><ul class="chips">${s.fundos.novos.slice(0, 20).map(f => `<li>${esc(f.nome || f.cnpj)} <em>(${esc(f.segmento)})</em></li>`).join('')}</ul>` : ''}`

  const alertasBlock = s.alertas.length
    ? `<ul class="alertas">${s.alertas.map(a => `<li>${esc(a.texto)}</li>`).join('')}</ul>`
    : empty('Nenhum alerta de qualidade.')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resumo do Dia ${esc(rep.label)}</title>
<style>
  :root{
    --primary:#1f4e9c; --primary-dark:#14253f; --primary-light:#e9eef7;
    --primary-border:#cdd9ea; --bg:#eef1f5; --card:#fff; --text:#1e293b;
    --text-muted:#64748b; --border:#e2e8f0; --success:#059669; --danger:#b91c1c;
    --warn:#92400e;
  }
  *{box-sizing:border-box}
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:860px;margin:0 auto;
    padding:24px 20px 48px;color:var(--text);background:var(--bg);line-height:1.5}
  .head{background:var(--primary-dark);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:18px}
  h1{font-size:22px;margin:0 0 4px;font-weight:600}
  .head .sub{color:#c7d3e6;margin:0;font-size:12.5px}
  section{background:var(--card);border:1px solid var(--border);border-radius:12px;
    padding:16px 18px;margin-bottom:14px}
  h2{font-size:15px;margin:0 0 10px;color:var(--primary-dark);font-weight:600;
    border-bottom:2px solid var(--primary-light);padding-bottom:6px}
  h2 .n{display:inline-block;min-width:22px;color:var(--primary)}
  h4{font-size:12.5px;margin:14px 0 6px;color:var(--primary);font-weight:600;text-transform:none}
  h4:first-of-type{margin-top:4px}
  .cap-dia{font-weight:400;color:var(--text-muted);font-size:11px}
  .tw{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0}
  th,td{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  th.num{text-align:right}
  td.num.pos{color:var(--success);font-weight:600} td.num.neg{color:var(--danger);font-weight:600}
  th{background:var(--primary-light);color:var(--primary-dark);font-weight:600;white-space:nowrap}
  table.kv td:first-child{color:var(--text-muted);width:52%}
  table.kv td:last-child{text-align:right;font-variant-numeric:tabular-nums}
  table.kv tr.ant td{border-top:2px solid var(--border);color:var(--text-muted);font-size:11.5px}
  .cap-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .cap-card{min-width:0}
  ol.rank,ul.chips,ul.sumario,ul.alertas{margin:6px 0;padding:0;list-style:none}
  ol.rank{counter-reset:r}
  ol.rank li{counter-increment:r;display:flex;justify-content:space-between;gap:12px;
    align-items:baseline;padding:4px 0;border-bottom:1px solid var(--primary-light);font-size:12.5px}
  ol.rank li:last-child{border-bottom:0}
  ol.rank li::before{content:counter(r);color:var(--primary);font-weight:600;
    min-width:16px;font-size:11px}
  .g-nome{flex:1;min-width:0}
  .g-nome em{color:var(--text-muted);font-style:normal;font-size:11px}
  .g-val{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
  .val{font-variant-numeric:tabular-nums}
  .val.pos{color:var(--success);font-weight:600} .val.neg{color:var(--danger);font-weight:600}
  ul.sumario li{padding:5px 0 5px 14px;position:relative;font-size:13px;border-bottom:1px solid var(--primary-light)}
  ul.sumario li:last-child{border-bottom:0}
  ul.sumario li::before{content:"";position:absolute;left:0;top:11px;width:6px;height:6px;
    border-radius:50%;background:var(--primary)}
  ul.sumario li.pos::before{background:var(--success)} ul.sumario li.pos{color:#065f46}
  ul.sumario li.neg::before{background:var(--danger)} ul.sumario li.neg{color:#7f1d1d}
  ul.sumario li.warn::before{background:var(--warn)} ul.sumario li.warn{color:var(--warn)}
  ul.chips{display:flex;flex-wrap:wrap;gap:6px}
  ul.chips li{background:var(--primary-light);border:1px solid var(--primary-border);
    border-radius:14px;padding:3px 10px;font-size:11.5px}
  ul.chips li em{color:var(--text-muted);font-style:normal}
  ul.alertas li{padding:5px 0 5px 14px;position:relative;font-size:12.5px;color:var(--warn)}
  ul.alertas li::before{content:"!";position:absolute;left:0;color:var(--warn);font-weight:700}
  .tally{font-size:13px;margin:2px 0 6px} .tally strong{color:var(--primary-dark)}
  .empty{color:#94a3b8;font-style:italic;font-size:12.5px;margin:4px 0}
  @media(max-width:560px){
    body{padding:14px 12px 32px} .cap-grid{grid-template-columns:1fr}
    ol.rank li{flex-wrap:wrap;gap:2px}
  }
</style></head><body>
<div class="head">
  <h1>Resumo do Dia — ${esc(rep.label)}</h1>
  <p class="sub">Comparado ao dia anterior disponível de cada fonte. Gerado a partir da data dos dados, não do calendário.</p>
</div>
<section><h2><span class="n">1.</span> Sumário executivo</h2>${bullets}</section>
<section><h2><span class="n">2.</span> Novas debêntures e emissões</h2>${debTable}${cvmBlock}${faltantesBlock}${inclNote}</section>
<section><h2><span class="n">3.</span> Captação líquida do dia</h2>${capBlock}</section>
<section><h2><span class="n">4.</span> Destaques por gestor (captação líquida)</h2>${gestBlock}</section>
<section><h2><span class="n">5.</span> Variação ANBIMA (spread)</h2>${anbimaBlock}</section>
<section><h2><span class="n">6.</span> Fundos incluídos/excluídos</h2>${fundosBlock}</section>
<section><h2><span class="n">7.</span> Performance de fundos</h2>${perfBlock}</section>
<section><h2><span class="n">8.</span> Alertas de qualidade</h2>${alertasBlock}</section>
</body></html>`
}

// ─── Snapshots (para o dia-a-dia futuro das fontes sem historico) ──────────
function saveSnapshot(fonte, dataKey, srcFile) {
  if (!dataKey || !fs.existsSync(srcFile)) return
  const dir = path.join(SNAP, fonte)
  ensureDir(dir)
  const dest = path.join(dir, `${dataKey}.csv`)
  if (!fs.existsSync(dest)) fs.copyFileSync(srcFile, dest)
  // Poda: mantem os SNAP_KEEP mais recentes.
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - SNAP_KEEP))) {
    try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
  }
}

function snapshotSources(src) {
  const anbimaDate = distinctDates(src.anbima, 'dataReferenciaAnbima').pop()
  saveSnapshot('anbima', anbimaDate, path.join(PUBLIC, 'Anbima_Tx.csv'))
  // BLC/Fundos nao tem data por linha: usa a data de hoje dos dados (a mais
  // recente entre as fontes diarias) como carimbo do snapshot.
  const capMax = [...distinctDates(src.dia['12431'], 'Dia'), ...distinctDates(src.dia.trad, 'Dia')].sort().pop()
  const carimbo = capMax || anbimaDate
  if (carimbo) {
    saveSnapshot('blc', carimbo, path.join(PUBLIC, 'BLC_tratado.csv'))
    // Fundos: junta as duas listas num snapshot unico (com a coluna de origem).
    const dir = path.join(SNAP, 'fundos'); ensureDir(dir)
    const dest = path.join(dir, `${carimbo}.csv`)
    if (!fs.existsSync(dest)) {
      const l12431 = fs.existsSync(path.join(TOOLS, 'Fundos_12431.csv')) ? fs.readFileSync(path.join(TOOLS, 'Fundos_12431.csv'), 'utf8') : ''
      const lcdi = fs.existsSync(path.join(TOOLS, 'Fundos_CDI.csv')) ? fs.readFileSync(path.join(TOOLS, 'Fundos_CDI.csv'), 'utf8') : ''
      fs.writeFileSync(dest, l12431 + (lcdi ? '\n' + lcdi.split('\n').slice(1).join('\n') : ''), 'utf8')
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - SNAP_KEEP))) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* */ } }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
// Ancora = data mais recente das fontes de FLUXO (captacao/perf/anbima), que
// representam o "as of" real dos dados. Datas de registro de debenture podem
// vir no futuro (registro antecipado / dado atipico) e nao devem ancorar um
// relatorio — sao usadas so' pra popular a secao 2 nas datas ate' a ancora.
function anchorDate(sd) {
  const flow = [...sd.cap12431, ...sd.capTrad, ...sd.perf12431, ...sd.perfTrad, ...sd.anbima]
    .filter(Boolean).sort()
  return flow.length ? flow[flow.length - 1] : null
}

// Arquivo de apoio: emissores novos sem grupo cadastrado. O usuario preenche
// Grupo/Setor (o julgamento dele) e cola no Cadastro_Emissores; na proxima
// rodada eles somem daqui. Sempre grava (mesmo vazio) para o arquivo existir.
function writeEmissoresFaltantesCsv(faltantes) {
  ensureDir(DATA)
  const q = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`
  const linhas = ['CNPJ,Nome_Emissor,Grupo,Setor']
  for (const e of faltantes?.itens || []) linhas.push([q(e.cnpj), q(e.emissor), q(''), q('')].join(','))
  fs.writeFileSync(path.join(DATA, 'Emissores_Faltantes.csv'), linhas.join('\n') + '\n', { encoding: 'utf8' })
}

function main() {
  ensureDir(REPORTS)
  const src = loadSources()
  const sd = perSourceDates(src)
  const anchor = anchorDate(sd)
  // Cap: nenhuma data de relatorio passa da ancora (evita registros futuros).
  const sdCapped = anchor
    ? Object.fromEntries(Object.entries(sd).map(([k, v]) => [k, v.filter(d => d <= anchor)]))
    : sd
  const datas = pickReportDates(sdCapped, N_REPORTS)
  if (!datas.length) {
    console.log('  Sem datas de dados disponiveis; nada a gerar.')
    return
  }
  const utf8 = { encoding: 'utf8' }
  const emissoesCVM = loadEmissoesCVM()   // pendencias da CVM: so no relatorio mais recente
  const emissoresMap = loadEmissores()    // cadastro do usuario (grupo/setor por CNPJ)
  const index = []
  let latestRep = null
  for (const D of datas) {
    const rep = buildReport(src, D, datas, D === datas[0] ? emissoesCVM : null, emissoresMap)
    if (!latestRep) latestRep = rep   // datas[0] = mais recente
    fs.writeFileSync(path.join(REPORTS, `${D}.json`), JSON.stringify(rep, null, 2) + '\n', utf8)
    fs.writeFileSync(path.join(REPORTS, `${D}.html`), renderHtml(rep), utf8)
    index.push({ date: D, label: rep.label, json: `/reports/daily/${D}.json`, html: `/reports/daily/${D}.html`, sourceDates: rep.sourceDates })
  }
  fs.writeFileSync(path.join(REPORTS, 'index.json'), JSON.stringify({ reports: index }, null, 2) + '\n', utf8)
  writeEmissoresFaltantesCsv(latestRep?.sections?.emissoresFaltantes)
  console.log(`  Resumo do Dia: ${datas.length} relatorio(s) gerado(s) (${datas.join(', ')}).`)

  // Salva snapshots DEPOIS de gerar (para o dia-a-dia da PROXIMA rodada).
  try { snapshotSources(src) } catch (e) { console.log('  AVISO: falha ao salvar snapshots: ' + e.message) }
}

main()

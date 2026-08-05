// Novas ofertas de DEBENTURES na CVM (SRE - Sistema de Registro de Ofertas),
// em TEMPO REAL: pega as ofertas assim que sao protocoladas (mesmo antes de
// precificar/registrar), diferente do dados-abertos (so' "Registro Concedido").
//
// Fonte: API publica do SRE (mesma que o site web.cvm.gov.br/sre-publico-cvm usa).
//   POST rest/sitePublico/pesquisar/detalhado         -> lista + nivel-oferta
//   GET  rest/sitePublico/pesquisar/participantes/{id} -> sindicato (coordenadores)
//   GET  rest/sitePublico/pesquisar/acaoObjeto/{id}     -> campos POR SERIE
// Sem login/cookie. Alimenta o CARD "Novas ofertas na CVM (SRE)" (diario+semanal).
//
// Cada oferta ja vem com sindicato[], valorTotal, status e series[] (cada serie
// com incentivada/final/spread-Bnn/teto/venc/tenor/amort/resgate) -> o render e'
// so' formatacao (tools/relatorios/card-sre.mjs). O spread Bnn+ (so' IPCA) sai da
// curva NTN-B do dia da oferta (REUNE_Curvas), como na tabela de Ativos.
//
// Saida: public/data/Novas_Ofertas_SRE.json  { asOf, geradoEm, janelaDias, itens[] }
// Uso:  node tools/preparar-ofertas-sre.mjs [--janela 15] [--out <arquivo>]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTeto } from './preparar-coordenadores-sre.mjs'
import { lerCurvas, curvaDoDia, parseMs, num } from './lib-mercado.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', 'public')
const DATA = path.join(PUBLIC, 'data')
const DET = 'https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/detalhado'
const PART = id => `https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/participantes/${id}`
const ACAO = id => `https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/acaoObjeto/${id}`
const UA = { 'User-Agent': 'Mozilla/5.0' }
const ANO_MS = 365.25 * 864e5

const args = process.argv.slice(2)
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def }
// 40 dias: cobre o recorte do relatório MENSAL (mês inteiro + margem); diário e
// semanal são subconjuntos disso. O recorte por intervalo é feito no render.
const JANELA = Math.max(1, parseInt(argVal('--janela', '40'), 10) || 40)
const OUT = argVal('--out', path.join(DATA, 'Novas_Ofertas_SRE.json'))

const digits = s => String(s || '').replace(/\D/g, '')
const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const parseValor = s => { if (s == null) return 0; const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const isoDate = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || '') }
const isDebenture = vm => { const t = (vm || '').toLowerCase(); return t.includes('deb') && t.includes('nture') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fmtPctBR = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// coleta {campoNome: campoValor} de qualquer nivel do acaoObjeto.
function flattenCampos(obj) {
  const m = {}
  const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.campoNome != null) m[String(o.campoNome).trim()] = (o.campoValor ?? '').toString().trim(); for (const v of Object.values(o)) walk(v) } }
  walk(obj); return m
}

// indexador da serie a partir do texto da remuneracao maxima.
function detectIndex(remMax) {
  const t = String(remMax || '')
  if (/IPCA|NTN-?B|Tesouro IPCA/i.test(t)) return 'IPCA'
  if (/Taxa DI|CDI|\bDI\b/i.test(t)) return 'DI'
  return 'PRE'
}
// amortizacao: bullet (parcela unica) vs amort (parcelas ao longo).
function classifyAmort(txt) {
  const t = String(txt || '').toLowerCase()
  if (!t) return ''
  if (/bullet|no vencimento|única parcela|uma única|parcela única/.test(t)) return 'bullet'
  if (/parcelas|amortiz|a partir do|semestrais|anuais|trimestrais/.test(t)) return 'amort'
  return ''
}
// remuneracao FINAL (pos-bookbuilding) -> display. null quando ainda nao precificada.
function parseRemFinal(txt, idx) {
  if (!txt) return null
  const t = txt.replace(/\s+/g, ' ')
  const temPct = /\d+,\d+\s*%\s*a\.?\s*a/i.test(t) || /\d+,\d+\s*%/.test(t)
  if (/a ser apurado|determinado percentual/i.test(t) && !temPct) return null
  if (idx === 'IPCA') { const m = t.match(/(\d+),(\d+)\s*%/); return m ? `IPCA + ${fmtPctBR(parseFloat(`${m[1]}.${m[2]}`))}%` : null }
  if (idx === 'DI') {
    const sp = t.match(/(?:spread|sobretaxa|acrescida(?:\s+exponencialmente)?\s+de)\D{0,20}?(\d+),(\d+)\s*%/i)
    if (sp) return `DI + ${fmtPctBR(parseFloat(`${sp[1]}.${sp[2]}`))}%`
    const pdi = t.match(/(\d+),(\d+)\s*%\s*(?:d[ao]s?\s*)?(?:taxas?\s*)?(?:m[ée]dias?\s*)?(?:di[aá]rias?\s*)?(?:do\s*)?(?:CDI|DI)\b/i)
    if (pdi) return `${fmtPctBR(parseFloat(`${pdi[1]}.${pdi[2]}`))}% DI`
    return null
  }
  const m = t.match(/(\d+),(\d+)\s*%/); return m ? `PRÉ ${fmtPctBR(parseFloat(`${m[1]}.${m[2]}`))}%` : null
}
// display do teto: parseTeto ("B36 +12bps"/"CDI + 0,72%"/vertice) e, quando ele
// nao pega (DI escrito como "Taxa DI, acrescida de X%"), cai no mesmo extrator da
// remuneracao final (DI+/PRÉ).
function tetoStr(remMax, idx) {
  const t = parseTeto(remMax)
  const d = t ? (t.compacto || t.ntnb) : null
  if (d) return d
  if (idx === 'DI') return parseRemFinal(remMax, 'DI')
  if (idx === 'PRE') return parseRemFinal(remMax, 'PRE')
  return null
}
// rating: mantem so' token curto ("AAA", "AAA (S&P)", "brAAA"); frase longa (ainda
// nao avaliado / texto explicativo) -> null.
function cleanRating(txt) {
  const t = String(txt || '').trim()
  if (!t || t.length > 40) return null
  const m = t.match(/\b((?:br)?[A-D]{1,3}[+\-]?(?:\.br)?)\b(\s*\([^)]{0,18}\))?/)
  return m ? (m[1] + (m[2] || '')).trim() : (t.length <= 12 ? t : null)
}
// numero cru da remuneracao (p/ calcular o spread sobre a NTN-B) — so' IPCA/PRE.
function taxaCrua(txt) { const m = String(txt || '').match(/(\d+),(\d+)\s*%/); return m ? parseFloat(`${m[1]}.${m[2]}`) : null }
// NTN-B mais proxima do vencimento
function nearestNtnb(arr, vencMs) {
  let best = null, bd = Infinity
  for (const p of arr) { const ms = parseMs(p.venc); if (ms == null) continue; const d = Math.abs(ms - vencMs); if (d < bd) { bd = d; best = p } }
  return best
}
// spread sobre a NTN-B "Bnn + Y bps" (so' IPCA): taxa real da serie − yield da NTN-B
// mais proxima, na curva do dia da oferta. null sem taxa/curva.
function spreadBnn(rate, vencIso, cur) {
  if (rate == null || !cur) return null
  const arr = cur.c.ntnb || []; const vms = parseMs(vencIso)
  if (vms == null || !arr.length) return null
  const ref = nearestNtnb(arr, vms); if (!ref) return null
  const bps = Math.round((rate - ref.taxa) * 100)
  const yr = new Date(parseMs(ref.venc)).getUTCFullYear()
  return `B${String(yr).slice(2)} ${bps < 0 ? '−' : '+'} ${Math.abs(bps)} bps`
}

async function pesquisar(de, ate, pagina, tamanho) {
  const body = { periodoCriacaoProcesso: { de, ate }, opa: false, tipoOferta: 'OFERTA_REGULAR', modalidade: 'TODAS', direcaoOrdenacao: 'DESC', colunaOrdenacao: 'data', pagina, tamanhoPagina: String(tamanho) }
  const r = await fetch(DET, { method: 'POST', headers: { 'Content-Type': 'application/json', ...UA }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`SRE HTTP ${r.status}`)
  return r.json()
}

// Detalhe de UMA oferta: sindicato[] + series[]. Best-effort (falha vira vazio).
async function detalharOferta(o, curvas) {
  const dia = isoDate(o.data)
  const cur = curvaDoDia(curvas, dia)
  let sindicato = []
  try {
    const parts = await (await fetch(PART(o.idRequerimento), { headers: UA })).json()
    const cnpjLider = digits(o.cnpjCoordenadorLider)
    sindicato = (Array.isArray(parts) ? parts : []).filter(p => (p.tipo || '').toUpperCase() === 'COORDENADOR')
      .map(p => ({ nome: (p.razaoSocial || '').trim(), lider: cnpjLider && digits(p.cnpjInstituicao) === cnpjLider }))
    if (cnpjLider && !sindicato.some(c => c.lider) && o.nomeCoordenadorLider) sindicato.unshift({ nome: o.nomeCoordenadorLider.trim(), lider: true })
  } catch {}
  let series = []
  try {
    const j = await (await fetch(ACAO(o.idRequerimento), { headers: UA })).json()
    const arr = Array.isArray(j) ? j : [j]
    series = arr.map(s => {
      const c = flattenCampos(s)
      const remMax = c['Informações sobre remuneração máxima'] || ''
      const remFin = c['Informações sobre remuneração final (pós bookbuilding)'] || ''
      const idx = detectIndex(remMax)
      const vencIso = isoDate(c['Data de vencimento'] || '')
      const emiss = parseMs(isoDate(c['Data de emissão'] || '') || dia)
      const vms = parseMs(vencIso)
      const tenor = (emiss != null && vms != null) ? Math.max(1, Math.round((vms - emiss) / ANO_MS)) : null
      const final = parseRemFinal(remFin, idx)
      // taxa real p/ o spread: a final (se precificada) senao o teto — so' IPCA
      const rate = idx === 'IPCA' ? (taxaCrua(remFin) ?? taxaCrua(remMax)) : null
      return {
        incentivada: /^sim$/i.test((c['Título incentivado - Lei 12.431/11'] || '').trim()),
        final,
        spread: idx === 'IPCA' ? spreadBnn(rate, vencIso, cur) : null,
        teto: tetoStr(remMax, idx),
        venc: vencIso,
        tenor,
        amort: classifyAmort(c['Informações sobre amortização']),
        resgate: (c['Possibilidade de resgate antecipado'] || '').trim() || null,
        rating: cleanRating(c['Avaliação de risco']),
      }
    })
  } catch {}
  return { sindicato, series }
}

async function main() {
  const hoje = new Date()
  const de = new Date(hoje); de.setDate(de.getDate() - JANELA)
  const deStr = ddmmyyyy(de), ateStr = ddmmyyyy(hoje)
  const curvas = lerCurvas(PUBLIC)

  const TAM = 200
  const registros = []
  let pagina = 1, totalPaginas = 1
  do {
    const j = await pesquisar(deStr, ateStr, pagina, TAM)
    totalPaginas = j.totalPaginas || 1
    for (const x of (j.registros || [])) registros.push(x)
    pagina++
  } while (pagina <= totalPaginas && pagina <= 30)

  // So' debentures; dedup por idRequerimento; ordena por data desc.
  const vistos = new Set()
  const ofertas = registros
    .filter(x => isDebenture(x.nomeValorMobiliario))
    .filter(x => { const id = String(x.idRequerimento || ''); if (!id || vistos.has(id)) return false; vistos.add(id); return true })
    .sort((a, b) => (isoDate(a.data) < isoDate(b.data) ? 1 : isoDate(a.data) > isoDate(b.data) ? -1 : 0))

  const itens = []
  let comSeries = 0
  for (const o of ofertas) {
    const { sindicato, series } = await detalharOferta(o, curvas)
    if (series.length) comSeries++
    itens.push({
      idRequerimento: String(o.idRequerimento || ''),
      data: isoDate(o.data),
      emissor: (o.nomeEmissor || '').trim(),
      cnpj: (o.cnpjEmissor || '').trim(),
      valorTotal: parseValor(o.valorTotalEmReais),
      valor: parseValor(o.valorTotalEmReais),   // compat: modal React (OfertasSRE) ainda lê `valor`
      status: (o.statusDaOferta || '').trim(),
      lider: (o.nomeCoordenadorLider || '').trim(),
      numeroRegistro: (o.numeroRegistro || '').trim() || null,
      numSeries: (o.numeroRegistro || '').split(';').filter(Boolean).length || series.length || null,
      rating: series.find(s => s.rating)?.rating || null,
      sindicato,
      series,
    })
    await sleep(150)   // polido com a API publica
  }

  const doc = {
    asOf: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    geradoEm: hoje.toISOString(),
    fonte: 'CVM SRE (detalhado + participantes + acaoObjeto)',
    janelaDias: JANELA,
    periodo: { de: deStr, ate: ateStr },
    total: itens.length,
    itens,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`[ofertas-sre] ${itens.length} debenture(s) na janela ${deStr}..${ateStr} (${comSeries} c/ series) -> ${path.relative(process.cwd(), OUT)}`)
  for (const e of itens.slice(0, 12)) console.log(`  ${e.data} | ${e.emissor} | ${e.series.length} série(s) | ${e.status}`)
}

main().catch(e => { console.error('[ofertas-sre] FALHOU:', e.message); process.exit(1) })

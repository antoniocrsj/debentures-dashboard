#!/usr/bin/env node
// Parser dos "books" (bookbuilding de mercado PRIMARIO) exportados do grupo de
// WhatsApp "CRM Books" -> public/data/Books_Primario.csv (uma linha por serie) +
// Books_Meta.json. Casa cada book ao Grupo do dashboard (public/Emissores.csv).
//
// Uso:  node tools/parsear-books.mjs [caminho-do-export.txt]
// Default: tools/books/Conversa*.txt  (ou o 1o .txt em tools/books/)
//
// O texto e' semi-estruturado e postado por varias pessoas; o parser e'
// TOLERANTE (regex por rotulo, variantes de rotulo) e nunca lanca em linha
// solta -- campos ausentes ficam vazios. Reprocessavel a cada novo export.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ---------- helpers ----------
const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function parseCsvLine(line) {
  const o = []; let c = '', q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { o.push(c); c = '' }
    else c += ch
  }
  o.push(c); return o
}
const csvCell = v => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// "R$ 2.340MM" | "BRL 400MM" | "R$ 552,8mm" | "2,6 bi" | "R$ 1.418mm" -> MM (Number)
export function valorMM(str) {
  if (!str) return null
  const s = String(str).replace(/r\$|brl|\s/gi, '')
  const m = s.match(/([\d.,]+)\s*(bi|bilh|mm|mi|milh)?/i)
  if (!m) return null
  let n = m[1]
  // pt-BR: ponto = milhar, virgula = decimal
  if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.')
  else if ((n.match(/\./g) || []).length > 1) n = n.replace(/\./g, '')
  // "1.418" sem virgula e com 1 ponto: ambiguo -> trata como milhar (1418)
  else if (n.includes('.') && n.split('.')[1]?.length === 3) n = n.replace(/\./g, '')
  let v = parseFloat(n)
  if (isNaN(v)) return null
  if (/bi|bilh/i.test(m[2] || '')) v *= 1000
  return Math.round(v * 100) / 100
}

// "CDI + 0,65%" | "IPCA+8,04%" | "B35 - 0,45% (IPCA+7,05%)" | "105,5% do CDI"
// -> { indexador, spread(Number, %), ntnb, ipcaEquiv, raw }.
// NTN-B vem ANTES de IPCA: books IPCA sao cotados em base NTN-B ("B35 - 0,45%") e
// o "ou IPCA+x"/"(IPCA+x)" e' so' equivalente informativo (varia com a curva ao
// longo do dia); a compressao teto->final so' fecha na MESMA base. O equivalente
// IPCA fica em ipcaEquiv. Trata sinal +/- (desagio sobre a NTN-B).
export function parseTaxa(str) {
  const empty = { indexador: '', spread: null, ntnb: '', ipcaEquiv: null, raw: '' }
  if (!str) return empty
  const raw = String(str).replace(/\s+/g, ' ').trim()
  // "CDI + 0,50% com desagio para CDI + 0,55%" -> a taxa CRAVADA e' apos "para".
  // Mantem raw p/ exibir; parseia sobre o efetivo (pos-"para").
  const paraM = raw.match(/(?:des[ae]gio )?para\s+(.+)$/i)
  const eff = (paraM ? paraM[1] : raw).replace(/\(.*?para\b/i, '')
  const num = x => x == null ? null : parseFloat(String(x).replace(',', '.'))
  const signed = (s, v) => s === '-' ? -num(v) : num(v)
  // equivalente IPCA (em parenteses ou apos "ou"), se houver
  const ipcaM = eff.match(/ipca\s*([+-]?)\s*([\d.,]+)/i)
  const ipcaEquiv = ipcaM ? signed(ipcaM[1] || '+', ipcaM[2]) : null
  // % do CDI
  let m = eff.match(/([\d.,]+)\s*%\s*(?:do|da|de)?\s*cdi/i)
  if (m) return { indexador: '%CDI', spread: num(m[1]), ntnb: '', ipcaEquiv, raw }
  // CDI +/- spread
  m = eff.match(/cdi\s*([+-])\s*([\d.,]+)\s*%?/i)
  if (m) return { indexador: 'CDI', spread: signed(m[1], m[2]), ntnb: '', ipcaEquiv, raw }
  // NTN-B: "B35 - 0,45%" (base real; preferida quando presente)
  m = eff.match(/\bb\s?(\d{2,3})\s*([+-])\s*([\d.,]+)\s*%?/i)
  if (m) return { indexador: 'NTN-B', spread: signed(m[2], m[3]), ntnb: 'B' + m[1], ipcaEquiv, raw }
  // IPCA + spread puro (sem NTN-B)
  if (ipcaM) return { indexador: 'IPCA', spread: ipcaEquiv, ntnb: '', ipcaEquiv: null, raw }
  // Taxa Fixa / Pre
  m = eff.match(/(?:taxa fixa|pr[eé][- ]?fixad[oa]?|pr[eé])\D*([\d.,]+)\s*%?/i)
  if (m) return { indexador: 'Fixa', spread: num(m[1]), ntnb: '', ipcaEquiv: null, raw }
  // so' um numero com % -> taxa fixa
  m = eff.match(/([\d.,]+)\s*%/)
  if (m) return { indexador: '', spread: num(m[1]), ntnb: '', ipcaEquiv: null, raw }
  return { ...empty, raw }
}

// ---------- carrega Emissores (Grupo/Emissor) p/ matching ----------
function carregarGrupos() {
  const p = path.join(ROOT, 'public', 'Emissores.csv')
  const raw = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
  const hdr = parseCsvLine(raw[0])
  const iG = hdr.indexOf('Grupo'), iE = hdr.indexOf('Emissor')
  const iC = hdr.findIndex(h => h.trim() === 'CNPJ Emissor')
  const grupos = new Map(), emissores = new Map(), gByCnpj = new Map()
  for (const l of raw.slice(1)) {
    const c = parseCsvLine(l)
    if (c[iG]) grupos.set(norm(c[iG]), c[iG].trim())
    if (c[iE]) emissores.set(norm(c[iE]), c[iE].trim())
    if (iC >= 0 && c[iC] && c[iG]) gByCnpj.set((c[iC] || '').replace(/\D/g, ''), c[iG].trim())
  }
  return { grupos, emissores, gByCnpj }
}

// ---------- carrega Debentures (p/ casar serie do book -> ticker real) ----------
// Le public/Debentures.csv (cod, emissor, grupo via gByCnpj, emissao, venc, taxa).
// Ausente -> [] (Ticker fica vazio; degrada gracioso).
function carregarDebentures(gByCnpj) {
  const p = path.join(ROOT, 'public', 'Debentures.csv')
  if (!fs.existsSync(p)) return []
  const raw = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
  const hdr = parseCsvLine(raw[0])
  const idx = (...names) => { for (const n of names) { const i = hdr.findIndex(h => h.trim() === n); if (i >= 0) return i } return -1 }
  const iCod = idx('Codigo do Ativo', 'Código do Ativo'), iCnpj = idx('CNPJ')
  const iEmi = idx('Data de Emissao', 'Data de Emissão'), iVen = idx('Data de Vencimento')
  const iTax = idx('Juros Criterio Novo - Taxa', 'Taxa')
  const P = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null }
  const out = []
  for (const l of raw.slice(1)) {
    const c = parseCsvLine(l)
    const cnpj = (c[iCnpj] || '').replace(/\D/g, '')
    out.push({
      cod: (c[iCod] || '').trim(), emissor: c[1] || '', grupo: gByCnpj.get(cnpj) || '',
      emi: P(c[iEmi]), ven: P(c[iVen]), taxa: parseFloat((c[iTax] || '').replace(',', '.')),
    })
  }
  return out
}

const anosEntre = (a, b) => (a && b) ? Math.round((b - a) / (365.25 * 864e5)) : null

// Casa uma serie do book -> ticker do Debentures.csv. Sinal forte: a taxa final
// (all-in, via IPCA-equiv quando NTN-B) bate com a taxa do cadastro em ~4 casas;
// desempata pelo emissor (EmissorRaw) e prazo. Fallback: janela de data + prazo.
function acharTicker(debs, grupo, emissorRaw, taxaFinal, ipcaEquiv, prazoAnos, dataBook) {
  if (!grupo || !debs.length) return null
  const alvo = ipcaEquiv != null ? ipcaEquiv : taxaFinal
  const bd = (() => { const m = String(dataBook).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null })()
  const c = debs.filter(d => d.grupo === grupo)
  if (!c.length) return null
  // tokens de emissor que "batem" a partir do inicio (emissoes-irmas do mesmo grupo
  // so' se distinguem pelo nome: "...Mato Grosso" vs "...Mato Grosso do Sul").
  const bt = norm(emissorRaw).split(' ').filter(Boolean)
  const lead = d => { const dt = norm(d.emissor).split(' '); let i = 0; while (i < bt.length && i < dt.length && bt[i] === dt[i]) i++; return i }
  // ordena por: taxa mais proxima -> mais tokens de emissor batendo -> nome mais curto.
  const escolher = cand => cand.sort((x, y) => {
    const dx = alvo != null ? Math.abs(x.taxa - alvo) : 0, dy = alvo != null ? Math.abs(y.taxa - alvo) : 0
    if (Math.abs(dx - dy) > 0.001) return dx - dy
    const lx = lead(x), ly = lead(y); if (lx !== ly) return ly - lx
    return norm(x.emissor).length - norm(y.emissor).length
  })[0]
  // proximidade da emissao ao book (~<=75d): emissoes-irmas de datas diferentes
  // podem ter taxas parecidas -> sem isso, casaria a de outro ano.
  const pertoData = d => !bd || !d.emi || Math.abs(d.emi - bd) < 75 * 864e5
  // 1) por taxa all-in (dentro de 6bps), respeitando prazo E data da emissao
  if (alvo != null) {
    let cand = c.filter(d => !isNaN(d.taxa) && Math.abs(d.taxa - alvo) < 0.06 && pertoData(d))
    if (prazoAnos) cand = cand.filter(d => { const a = anosEntre(d.emi, d.ven); return a == null || Math.abs(a - prazoAnos) <= 1.5 })
    if (cand.length) return escolher(cand)
  }
  // 2) fallback data+prazo: SO' quando fica 1 unico candidato (senao casaria irma errada)
  if (bd) {
    const cand = c.filter(d => d.emi && Math.abs(d.emi - bd) < 12 * 864e5 && (!prazoAnos || Math.abs(anosEntre(d.emi, d.ven) - prazoAnos) <= 1.5))
    if (cand.length === 1) return cand[0]
  }
  return null
}

// Coordenadores: lider + sindicato. Formatos: "Coordenador Lider: X" + "Coordenadores:
// A, B e C"; ou "Coordenadores: A (Lider), B, C"; ou "Coordenador: X".
function extrairCoord(corpo) {
  const listaRaw = campo(corpo, /coordenadores\s*:?\s*([^\n]+)/i)
    || campo(corpo, /coordenador(?!\s*l[ií]der)[^:\n]*:?\s*([^\n]+)/i)
  let liderRaw = campo(corpo, /coordenador\s*l[ií]der\s*:?\s*([^\n]+)/i)
  const bancos = (listaRaw || '').split(/,| e |\/|·/).map(x => x.replace(/\(.*?\)/g, '').trim()).filter(Boolean)
  if (!liderRaw) {
    const mi = (listaRaw || '').match(/([^,]+?)\s*\(l[ií]der\)/i)
    if (mi) liderRaw = mi[1].trim()
  }
  const lider = (liderRaw || '').replace(/\(.*?\)/g, '').replace(/^coordenador(es)?\s*/i, '').trim()
  const seen = new Set(), ordem = []
  for (const b of [lider, ...bancos]) { const k = b.toLowerCase(); if (b && !seen.has(k)) { seen.add(k); ordem.push(b) } }
  return { lider, lista: ordem.join(', ') }
}

// aliases: nomes de mercado -> como aparece no Grupo do Emissores.csv
const ALIAS = {
  'autoban': 'CCR', 'sp vias': 'Motiva', 'motiva': 'Motiva',
  'rge sul cpfl': 'CPFL', 'rge sul': 'CPFL', 'coelba': 'Neoenergia',
  'celpe': 'Neoenergia', 'elektro': 'Neoenergia', 'celpa': 'Equatorial',
  'ceee d': 'Equatorial', 'cea': 'Equatorial', 'eletronorte': 'Eletrobras',
  'eletrobras': 'Eletrobras', 'axia': 'Eletrobras', 'axia norte': 'Eletrobras',
  'hidrovias do brasil': 'Ultrapar', 'aimores': 'Taesa', 'paraguacu': 'Taesa',
  'raia drogasil': 'Raia Drogasil', 'fisia': 'SBF', 'sbf': 'SBF',
  'giga mais fibra': 'Alloha', 'alloha': 'Alloha', 'vero': 'Vero',
  'ccr': 'Motiva', 'ccr viacosteira': 'Motiva', 'enel sp': 'Enel Brasil',
  'enel': 'Enel Brasil', 'metrorio': 'MetroRio', 'isa cteep': 'ISA Energia',
  'isa energia': 'ISA Energia', 'cteep': 'ISA Energia', 'comgas': 'Comgás',
  'compagas': 'Compagas', 'sabesp': 'Sabesp', 'rodovia das colinas': 'Motiva',
  'econoroeste': 'EcoRodovias', 'ecovias capixaba': 'EcoRodovias',
  'way 112': 'Way Brasil', 'metrorio ': 'MetroRio',
  // nomes de mercado -> Grupo do cadastro (emissores JA cadastrados cujo apelido
  // no book nao bate textualmente com o Grupo/razao social):
  'vtal': 'V.tal', 'essentia': 'Pátria', 'usina estiva': 'Usina SAO Jose da Estiva SA',
  'axs': 'AXS Energia', 'btg commodities': 'BTG Pactual',
  'tbg': 'Transportadora Brasileira Gasoduto Bolivia Brasil',
  'fs etanol': 'FS', 'fs bio': 'FS',
  // emissor que FALTA no cadastro (tem debenture SRFC11): lado do book pronto;
  // o link no modal so' fecha quando o emissor entrar na planilha Cadastro_Emissores.
  'serra do facao': 'Serra do Facão',
}

// limpa o titulo do book -> candidato a emissor (normalizado)
function candidatoEmissor(title) {
  let t = norm(title)
  t = t.replace(/\bbookbuilding\b|\bbookbuild\b|\bbook\b/g, ' ')
       .replace(/\bdebentures?\b|\bdebs?\b|\bdeb\b/g, ' ')
       .replace(/12 ?431/g, ' ')
       .replace(/\bicvm ?160\b|\bcvm ?160\b|\b160\b/g, ' ')
       .replace(/\bip\b|\biq\b|\bsec\b|\bsecundaria\b|\bspe\b/g, ' ')
       .replace(/\baval ?neo\b|\baval\b/g, ' ')
       .replace(/ e fidc| e deb.*/g, ' ')
       .replace(/\s+/g, ' ').trim()
  // corta em " - " (sobra emissor antes do detalhe)
  t = t.split(/ - | – /)[0].trim()
  // remove parenteticos ja normalizados (viraram texto solto no fim)
  return t
}

function casarGrupo(cand, { grupos, emissores }) {
  if (!cand) return { grupo: '', via: '' }
  if (ALIAS[cand]) return { grupo: ALIAS[cand], via: 'alias' }
  // alias por token contido
  for (const k of Object.keys(ALIAS)) if (cand.includes(k)) return { grupo: ALIAS[k], via: 'alias~' }
  for (const [gk, g] of grupos) {
    if (gk.length < 3) continue
    if (cand === gk || cand.includes(gk) || (cand.length >= 4 && gk.includes(cand)))
      return { grupo: g, via: 'grupo' }
  }
  for (const [ek, e] of emissores) {
    if (ek.length < 4) continue
    if (cand.includes(ek) || ek.includes(cand)) return { grupo: e, via: 'emissor' }
  }
  return { grupo: '', via: '' }
}

// ---------- segmenta o export em mensagens ----------
function lerMensagens(txt) {
  const linhas = txt.split(/\r?\n/)
  const RE_HEAD = /^(\d{2}\/\d{2}\/\d{4}) \d{2}:\d{2} - ([^:]+): ?(.*)$/
  const RE_SYS = /^(\d{2}\/\d{2}\/\d{4}) \d{2}:\d{2} - (?!.*: )/ // linha de sistema (sem "autor: ")
  const msgs = []
  let cur = null
  for (const ln of linhas) {
    const m = ln.match(RE_HEAD)
    if (m) {
      if (cur) msgs.push(cur)
      cur = { data: m[1], autor: m[2].trim(), linhas: [m[3]] }
    } else if (RE_SYS.test(ln)) {
      if (cur) { msgs.push(cur); cur = null }
    } else if (cur) {
      cur.linhas.push(ln)
    }
  }
  if (cur) msgs.push(cur)
  return msgs
}

// instrumento pelo titulo
function instrumento(title) {
  if (/\blf\b|letra financeira/i.test(title)) return 'LF'
  if (/\bcri\b/i.test(title)) return 'CRI'
  if (/\bcra\b/i.test(title)) return 'CRA'
  if (/\bfidc\b/i.test(title)) return 'FIDC'
  return 'DEB'
}

// e' um cabecalho de book?
const ehBook = t => /^\*?\s*(bookbuild|book|deb)/i.test(t.trim())

// extrai 1o valor apos um rotulo (varias variantes), no corpo dado
function campo(corpo, re) {
  const m = corpo.match(re)
  return m ? m[1].trim() : ''
}

// quebra o corpo em blocos de serie
export function blocosSerie(linhas) {
  const RE_SERIE = /^\s*\*?\s*(\d+)\s*[ªaºo]?\s*s[ée]rie/i
  const RE_UNICA = /s[ée]rie\s*[úu]nica|[úu]nica\s*s[ée]rie|serie unica/i
  const blocos = []
  let header = [], atual = null
  for (const ln of linhas) {
    const ms = ln.match(RE_SERIE)
    if (ms) {
      if (atual) blocos.push(atual)
      atual = { serie: ms[1] + 'a', linhas: [ln] }
    } else if (RE_UNICA.test(ln) && !atual) {
      atual = { serie: 'unica', linhas: [ln] }
    } else if (atual) {
      atual.linhas.push(ln)
    } else {
      header.push(ln)
    }
  }
  if (atual) blocos.push(atual)
  return { header, blocos }
}

export function extrairSerie(texto) {
  const prazo = campo(texto, /prazo\s*:?\s*([^\n]+)/i)
    || (texto.match(/(\d+)\s*y\b/i)?.[0] ?? '')
  const tetoRaw = campo(texto, /taxa\s*(?:teto|inicial|m[aá]xima)\s*:?\s*([^\n]+)/i)
  let finalRaw = campo(texto, /taxa\s*(?:final|de corte|corte)\s*(?:\(des[ae]gio\))?\s*:?\s*([^\n]+)/i)
  // template "Taxa: CDI + 0,50% com desagio para CDI + 0,55%" (sem teto/final
  // explicitos): a linha "Taxa:" (que nao seja teto/inicial/maxima) e' a cravada.
  if (!finalRaw) finalRaw = campo(texto, /(?:^|\n)\s*taxa(?![^:\n]*(?:teto|inicial|m[aá]xim))[^:\n]*:\s*([^\n]+)/i)
  const demanda = campo(texto, /demanda[^:\n]*:?\s*([^\n]+)/i)
  const emissao = campo(texto, /emiss[aã]o[^:\n]*:?\s*([^\n]+)/i)
  const bids = campo(texto, /bids?\s*\/?\s*aloc[^:\n]*:?\s*([^\n]+)/i)
  const alocCorte = campo(texto, /aloca[cç][aã]o[^:\n]*corte\s*:?\s*([^\n]+)/i)
  const amort = campo(texto, /amort[^:\n]*:?\s*([^\n]+)/i)
  const teto = parseTaxa(tetoRaw)
  const fin = parseTaxa(finalRaw)
  // compressao (teto->final) em bps, so' quando mesmo indexador
  let compBps = null
  if (teto.spread != null && fin.spread != null && teto.indexador === fin.indexador)
    compBps = Math.round((teto.spread - fin.spread) * 100)
  const over = (() => {
    const m = (demanda || '').match(/([\d.,]+)\s*x/i)
    return m ? parseFloat(m[1].replace(',', '.')) : null
  })()
  return {
    prazo: prazo.replace(/\s+/g, ' ').trim(),
    indexadorFinal: fin.indexador, spreadFinal: fin.spread, ntnbFinal: fin.ntnb,
    ipcaEquivFinal: fin.ipcaEquiv, taxaFinalRaw: fin.raw,
    indexadorTeto: teto.indexador, spreadTeto: teto.spread, ntnbTeto: teto.ntnb, taxaTetoRaw: teto.raw,
    compBps,
    demandaMM: valorMM(demanda), emissaoMM: valorMM(emissao), overX: over,
    bidsAloc: bids.replace(/\s+/g, ''), alocCortePct: alocCorte.replace(/\s+/g, ' ').trim(),
    amort: amort.replace(/\s+/g, ' ').trim(),
  }
}

// Book de serie UNICA: campos de nivel de book que caem no cabecalho (Emissao,
// Demanda...) — porque vem ANTES do marcador "Serie Unica" — sao herdados pela
// serie. So' preenche o que a serie deixou vazio (nunca sobrescreve taxa/prazo
// que a serie ja trouxe). Nao se aplica a books multi-serie (cada serie tem os
// seus proprios volumes).
export function herdarHeader(serie, header) {
  if (!header) return serie
  const vazio = v => v == null || v === ''
  const out = { ...serie }
  for (const k of Object.keys(header)) if (vazio(out[k])) out[k] = header[k]
  return out
}

// ---------- fontes de books ----------
const RATING_RE = /\b(AAA|AA\+|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB|brAAA|brAA|brA)\b/

// Export da Ana (fonte canonica dos books de primario; ver AGENTS.md). Cada item
// tem o texto cru em `raw`. Sobrescrito por ANA_BOOKS_URL no ambiente.
const ANA_BOOKS_URL = process.env.ANA_BOOKS_URL || 'http://127.0.0.1:8000/api/v1/books/export'

// Busca o export da Ana. Retorna o array de items ou null se ela estiver fora do
// ar / responder algo inesperado (a atualizacao segue sem os deltas dela).
async function buscarBooksDaAna(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const resp = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!resp.ok) return null
    const data = await resp.json()
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

// Converte o export da Ana em "mensagens" (sem cabecalho de WhatsApp): a 1a linha
// do `raw` e' o titulo; a data do book sai do corpo. Alimenta o mesmo pipeline.
export function mensagensDeExport(items) {
  return (items || [])
    .map(it => String(it && it.raw != null ? it.raw : '').trim())
    .filter(Boolean)
    .map(raw => ({ data: '', autor: 'ana', linhas: raw.split('\n') }))
}

// Acha o export .txt do WhatsApp: argumento explicito, senao o mais recente em
// tools/books/. Retorna null se nao houver nenhum. Fonte de bootstrap/reconciliacao.
function acharExport() {
  if (process.argv[2]) return process.argv[2]
  const dir = path.join(ROOT, 'tools', 'books')
  if (fs.existsSync(dir)) {
    const txts = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt'))
    if (txts.length) return path.join(dir, txts.sort().reverse()[0])
  }
  return null
}

// ---------- parse de 1 mensagem -> linhas (uma por serie) ----------
// Puro e testavel. Retorna null quando nao e' um book; senao { deb, grupo, via,
// title, rows }. As metricas ficam a cargo do chamador (agrega os retornos).
export function parsearMensagem(msg, grp, debs) {
  const title = (msg.linhas[0] || '').replace(/\*/g, '').trim()
  if (!ehBook(title)) return null
  const instr = instrumento(title)
  const corpo = msg.linhas.join('\n')
  const dataBook = campo(corpo, /data do book(?:building|build)?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || msg.data
  if (instr !== 'DEB') return { title, instr, deb: false, grupo: '', via: '', rows: [] }

  const rating = campo(corpo, /rating\s*:?\s*([A-Za-z+\/.\- ]+?)(?:\n|$)/i).match?.(RATING_RE)?.[0]
    || (corpo.match(RATING_RE)?.[0] ?? '')
  const regime = /12\.?431/.test(corpo) || /12\.?431/i.test(title) ? '12.431'
    : /(i?cvm) ?160/i.test(corpo) ? 'CVM160' : ''
  const coord = extrairCoord(corpo)
  // Emissor "limpo" do titulo do book (tira juridiques de prefixo, preserva aval).
  const emissorRaw = title.split(/ - | – /)[0]
    .replace(/^\*?\s*(deb\.?|debentures?|book(building|build)?)\s*/i, '').replace(/12\.?431/g, '').trim()

  const cand = candidatoEmissor(title)
  const { grupo, via } = casarGrupo(cand, grp)

  const { header, blocos } = blocosSerie(msg.linhas.slice(1))
  // Serie unica (1 bloco com marcador "Serie Unica"/"Na Serie"): herda os campos
  // de book do cabecalho. Multi-serie NAO herda (cada serie tem os seus).
  const headerFields = blocos.length === 1 ? extrairSerie(header.join('\n')) : null
  const lista = blocos.length ? blocos : [{ serie: 'unica', linhas: msg.linhas.slice(1) }]

  const rows = []
  for (const b of lista) {
    const s = herdarHeader(extrairSerie(b.linhas.join('\n')), headerFields)
    // ignora "serie" sem nenhuma taxa (ruido)
    if (s.spreadFinal == null && s.spreadTeto == null && !s.prazo) continue
    const prazoAnos = (s.prazo.match(/(\d+)\s*y/i) || [])[1]
    const tk = acharTicker(debs, grupo, emissorRaw, s.spreadFinal, s.ipcaEquivFinal, prazoAnos ? +prazoAnos : null, dataBook)
    rows.push({
      DataBook: dataBook, Grupo: grupo, EmissorRaw: emissorRaw,
      Ticker: tk ? tk.cod : '', TickerEmissor: tk ? tk.emissor : '',
      MatchVia: via, Instrumento: instr, Regime: regime, Rating: rating,
      CoordLider: coord.lider, Coordenadores: coord.lista,
      Serie: b.serie, Prazo: s.prazo,
      IndexadorFinal: s.indexadorFinal, SpreadFinalPct: s.spreadFinal ?? '',
      IpcaEquivFinalPct: s.ipcaEquivFinal ?? '',
      TaxaFinalRaw: s.taxaFinalRaw, NtnbFinal: s.ntnbFinal,
      IndexadorTeto: s.indexadorTeto, SpreadTetoPct: s.spreadTeto ?? '', NtnbTeto: s.ntnbTeto, TaxaTetoRaw: s.taxaTetoRaw,
      CompressaoBps: s.compBps ?? '',
      DemandaMM: s.demandaMM ?? '', EmissaoMM: s.emissaoMM ?? '', OverX: s.overX ?? '',
      BidsAloc: s.bidsAloc, AlocCortePct: s.alocCortePct, Amort: s.amort,
    })
  }
  return { title, instr, deb: true, grupo, via, rows }
}

// Chave natural de uma linha (serie de um book): identifica o mesmo registro entre
// o CSV existente e um re-parse, para o upsert nao duplicar nem perder historico.
export function chaveNatural(row) {
  return [row.DataBook, row.Grupo, row.EmissorRaw, row.Serie, row.Prazo].join('|')
}

// Le o Books_Primario.csv atual de volta em objetos (chave = nome da coluna).
// E' a SEMENTE: preserva os books historicos; a Ana entrega so' os deltas.
function lerCsvExistente(csvPath) {
  if (!fs.existsSync(csvPath)) return { cols: null, rows: [] }
  const linhas = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.length)
  if (!linhas.length) return { cols: null, rows: [] }
  const cols = parseCsvLine(linhas[0])
  const rows = linhas.slice(1).map(l => {
    const c = parseCsvLine(l)
    const o = {}
    cols.forEach((k, i) => { o[k] = c[i] ?? '' })
    return o
  })
  return { cols, rows }
}

// ---------- main ----------
async function main() {
  const grp = carregarGrupos()
  const debs = carregarDebentures(grp.gByCnpj)
  const outDir = path.join(ROOT, 'public', 'data')
  const csvPath = path.join(outDir, 'Books_Primario.csv')

  // 1) Semeia do CSV existente (preserva o historico; a Ana entrega deltas).
  // ARRAY, nao Map: o CSV pode ter linhas que compartilham a chave natural
  // (reposts teto/final do mesmo book) e colapsa-las perderia historico. O
  // indice aponta para a ULTIMA ocorrencia de cada chave (alvo do upsert).
  const base = lerCsvExistente(csvPath)
  const baseRows = base.rows.slice()
  const idxByKey = new Map()
  baseRows.forEach((r, i) => idxByKey.set(chaveNatural(r), i))
  const baseCount = baseRows.length

  // 2) Coleta mensagens NOVAS: Ana (canonica) + .txt do WhatsApp (bootstrap).
  const fontes = []
  let msgs = []
  let anaIndisponivel = false
  if (!process.env.BOOKS_SKIP_ANA) {
    const anaItems = await buscarBooksDaAna(ANA_BOOKS_URL)
    if (anaItems && anaItems.length) {
      msgs = msgs.concat(mensagensDeExport(anaItems))
      fontes.push(`Ana (${anaItems.length})`)
    } else if (anaItems == null) {
      anaIndisponivel = true
      console.log(`Ana indisponivel em ${ANA_BOOKS_URL} -- seguindo sem os deltas dela.`)
    }
  }
  const arqTxt = acharExport()
  if (arqTxt) {
    msgs = msgs.concat(lerMensagens(fs.readFileSync(arqTxt, 'utf8')))
    fontes.push(`arquivo (${path.basename(arqTxt)})`)
  }

  // 3) Parseia as mensagens novas e faz UPSERT por chave natural.
  const stats = { mensagens: msgs.length, books: 0, deb: 0, series: 0, casados: 0, comTicker: 0, naoCasados: [], novos: 0, atualizados: 0 }
  for (const msg of msgs) {
    const p = parsearMensagem(msg, grp, debs)
    if (!p) continue
    stats.books++
    if (!p.deb) continue
    stats.deb++
    if (p.grupo) stats.casados++; else stats.naoCasados.push(p.title)
    for (const row of p.rows) {
      stats.series++
      if (row.Ticker) stats.comTicker++
      const k = chaveNatural(row)
      if (idxByKey.has(k)) {           // atualiza a linha existente (nao duplica)
        baseRows[idxByKey.get(k)] = row
        stats.atualizados++
      } else {                         // book/serie nova: acrescenta
        idxByKey.set(k, baseRows.length)
        baseRows.push(row)
        stats.novos++
      }
    }
  }

  // 4) Escreve o CSV mesclado (ordenado por data).
  const rows = baseRows
  const dnum = d => { const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] + m[1] : '' }
  rows.sort((a, b) => dnum(a.DataBook).localeCompare(dnum(b.DataBook)))
  const cols = base.cols || Object.keys(rows[0] || { DataBook: 1 })
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\n') + '\n'
  fs.writeFileSync(csvPath, csv)

  const fonte = fontes.length ? fontes.join(' + ') : (anaIndisponivel ? 'preservado (Ana indisponivel, sem arquivo)' : 'preservado (nenhuma fonte nova)')
  const meta = {
    fonte,
    ana_indisponivel: anaIndisponivel,
    base: baseCount, novos: stats.novos, atualizados: stats.atualizados, total: rows.length,
    books_deb: stats.deb, series: stats.series,
    casados: stats.casados, pct_casado: stats.deb ? Math.round(100 * stats.casados / stats.deb) : 0,
    series_com_ticker: stats.comTicker,
    periodo: { de: rows[0]?.DataBook || '', ate: rows[rows.length - 1]?.DataBook || '' },
    nao_casados: [...new Set(stats.naoCasados)],
  }
  fs.writeFileSync(path.join(outDir, 'Books_Meta.json'), JSON.stringify(meta, null, 2))

  console.log(`Fonte: ${fonte}`)
  console.log(`Base: ${baseCount} | novos: ${stats.novos} | atualizados: ${stats.atualizados} | total: ${rows.length}`)
  console.log(`Mensagens novas: ${stats.mensagens} | DEB: ${stats.deb} | Series: ${stats.series} | com ticker: ${stats.comTicker}`)
  console.log(`\n-> public/data/Books_Primario.csv (${rows.length} linhas)`)
}

// Roda so' quando executado direto (node tools/parsear-books.mjs); ao ser
// importado nos testes, expoe as funcoes puras sem efeitos colaterais.
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()

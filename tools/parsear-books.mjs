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
import { fileURLToPath } from 'node:url'

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
function valorMM(str) {
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
function parseTaxa(str) {
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
  const grupos = new Map(), emissores = new Map()
  for (const l of raw.slice(1)) {
    const c = parseCsvLine(l)
    if (c[iG]) grupos.set(norm(c[iG]), c[iG].trim())
    if (c[iE]) emissores.set(norm(c[iE]), c[iE].trim())
  }
  return { grupos, emissores }
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
function blocosSerie(linhas) {
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

function extrairSerie(texto) {
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

// ---------- main ----------
function acharExport() {
  if (process.argv[2]) return process.argv[2]
  const dir = path.join(ROOT, 'tools', 'books')
  if (fs.existsSync(dir)) {
    const txts = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt'))
    if (txts.length) return path.join(dir, txts.sort().reverse()[0])
  }
  throw new Error('Informe o caminho do export: node tools/parsear-books.mjs <arquivo.txt> (ou coloque em tools/books/)')
}

function main() {
  const arqTxt = acharExport()
  const txt = fs.readFileSync(arqTxt, 'utf8')
  const grp = carregarGrupos()
  const msgs = lerMensagens(txt)

  const rows = []
  const stats = { mensagens: msgs.length, books: 0, deb: 0, series: 0, casados: 0, naoCasados: [] }
  const RATING_RE = /\b(AAA|AA\+|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB|brAAA|brAA|brA)\b/

  for (const msg of msgs) {
    const title = (msg.linhas[0] || '').replace(/\*/g, '').trim()
    if (!ehBook(title)) continue
    stats.books++
    const instr = instrumento(title)
    if (instr !== 'DEB') continue
    stats.deb++

    const corpo = msg.linhas.join('\n')
    const dataBook = campo(corpo, /data do book\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || msg.data
    const rating = campo(corpo, /rating\s*:?\s*([A-Za-z+\/.\- ]+?)(?:\n|$)/i).match?.(RATING_RE)?.[0]
      || (corpo.match(RATING_RE)?.[0] ?? '')
    const regime = /12\.?431/.test(corpo) || /12\.?431/i.test(title) ? '12.431'
      : /(i?cvm) ?160/i.test(corpo) ? 'CVM160' : ''
    const coord = campo(corpo, /coordenador[^:\n]*:?\s*([^\n]+)/i).replace(/\s+/g, ' ').trim()

    const cand = candidatoEmissor(title)
    const { grupo, via } = casarGrupo(cand, grp)
    if (grupo) stats.casados++; else stats.naoCasados.push(title)

    const { blocos } = blocosSerie(msg.linhas.slice(1))
    const lista = blocos.length ? blocos
      : [{ serie: 'unica', linhas: msg.linhas.slice(1) }]
    for (const b of lista) {
      const s = extrairSerie(b.linhas.join('\n'))
      // ignora "serie" sem nenhuma taxa (ruido)
      if (s.spreadFinal == null && s.spreadTeto == null && !s.prazo) continue
      stats.series++
      rows.push({
        DataBook: dataBook, Grupo: grupo, EmissorRaw: title.split(/ - | – /)[0].replace(/^\*?\s*(deb\.?|debentures?|book(building|build)?)\s*/i, '').replace(/12\.?431/g, '').trim(),
        MatchVia: via, Instrumento: instr, Regime: regime, Rating: rating, Coordenador: coord,
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
  }

  // ordena por data (AAAAMMDD)
  const dnum = d => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] + m[1] : '' }
  rows.sort((a, b) => dnum(a.DataBook).localeCompare(dnum(b.DataBook)))

  const cols = Object.keys(rows[0] || { DataBook: 1 })
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\n') + '\n'
  const outDir = path.join(ROOT, 'public', 'data')
  fs.writeFileSync(path.join(outDir, 'Books_Primario.csv'), csv)
  const meta = {
    fonte: path.basename(arqTxt),
    books_deb: stats.deb, series: stats.series,
    casados: stats.casados, pct_casado: stats.deb ? Math.round(100 * stats.casados / stats.deb) : 0,
    periodo: { de: rows[0]?.DataBook || '', ate: rows[rows.length - 1]?.DataBook || '' },
    nao_casados: [...new Set(stats.naoCasados)],
  }
  fs.writeFileSync(path.join(outDir, 'Books_Meta.json'), JSON.stringify(meta, null, 2))

  console.log(`Mensagens: ${stats.mensagens} | Books: ${stats.books} | DEB: ${stats.deb} | Series: ${stats.series}`)
  console.log(`Casados ao Grupo: ${stats.casados}/${stats.deb} (${meta.pct_casado}%)`)
  console.log(`Periodo: ${meta.periodo.de} -> ${meta.periodo.ate}`)
  console.log(`Nao casados (${meta.nao_casados.length}): ${meta.nao_casados.join(' | ')}`)
  console.log(`\n-> public/data/Books_Primario.csv (${rows.length} linhas)`)
}

main()

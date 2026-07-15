// Normalizacao/formatacao dos dados de Nivel de Caixa (motor
// tools/preparar-caixa-potencial.ps1 -> public/data/Caixa_Potencial_*).
// Reaproveita fmtFluxo (R$ compacto) da Captacao e parseNum (robusto a pt-BR
// agrupado e invariante) do format; aqui so' o especifico.
import { parseNum } from './format.js'

const MESES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Numero do CSV -> Number, ou null se vazio. Usa parseNum (aceita "1.234,56"
 *  agrupado e "1234.56" invariante), preservando null p/ celula vazia. */
export function num(v) {
  if (v == null || v === '') return null
  const n = parseNum(v)
  return isNaN(n) ? null : n
}

/** 'sim'/'nao' -> boolean. */
export function yn(v) {
  return String(v || '').trim().toLowerCase() === 'sim'
}

/** 'YYYYMM' -> 'mai/26'. */
export function fmtMes(mes) {
  const s = String(mes || '')
  if (s.length !== 6) return s
  const ano = s.slice(2, 4)
  const m = parseInt(s.slice(4, 6), 10)
  return m >= 1 && m <= 12 ? `${MESES_ABBR[m - 1]}/${ano}` : s
}

/** Fracao (0..1+) -> '40,7%'. Aceita null -> '—'. */
export function fmtPctPL(f) {
  if (f == null || isNaN(f)) return '—'
  return (f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

// Apelido curto do fundo: os nomes oficiais sao enormes ("... FUNDO DE
// INVESTIMENTO FINANCEIRO RENDA FIXA REFERENCIADO DI ... RESPONSABILIDADE
// LIMITADA"). Aqui uma limpeza DETERMINISTICA tira o juridiques estrutural
// (forma juridica, tipo de classe, indexador generico) e preserva marca +
// estrategia. Nao e' um mapa curado — cabe na coluna; o nome completo continua
// no tooltip (title). Ex.: "ITAU VERSO A", "BB TITULOS PUBLICOS", "KINEA ABSOLUTO".
const APELIDO_RE = [
  /RESPONSABILIDADE LIMITADA/g,
  /\bRESP\.?\s*(LIMITADA|LTDA|LIM)\b/g,
  /\bFUNDOS? DE INVESTIMENTO( FINANCEIRO)?( EM (COTAS|QUOTAS))?( DE FUNDOS DE INVESTIMENTO( FINANCEIRO)?)?/g,
  /\b(EM|DE) (COTAS|QUOTAS)( DE FUNDOS DE INVESTIMENTO( FINANCEIRO)?)?/g,
  /\bDE FUNDOS DE INVESTIMENTO( FINANCEIRO)?/g,
  /\bCLASSE DE INVEST(IMENTO)?( EM COTAS)?\b/g,
  /\bFIFE?\b/g, /\bFIC\b/g, /\bCIC\b/g, /\bDA CIC\b/g, /\bCI\b/g, /\bFI\b/g,
  /RENDA\s+FIXA/g, /\bREFERENCIAD[OA]\b/g, /\bSIMPLES\b/g, /\bDI\b/g,
  /\bLONGO PRAZO\b/g, /\bMULTIMERCADO\b/g, /\bFINANCEIRO\b/g,
  /\bCLASSE\b/g, /\bCOTAS\b/g, /\bQUOTAS\b/g,
]
const APELIDO_TRAIL = /\s+(DE|DA|DO|EM|E|-|–)$/
const APELIDO_LEAD = /^(DE|DA|DO|EM|E|-|–)\s+/
export function apelidoFundo(nome, max = 32) {
  if (!nome) return ''
  let s = ' ' + String(nome).toUpperCase().replace(/["']/g, '') + ' '
  for (const re of APELIDO_RE) s = s.replace(re, ' ')
  s = s.replace(/\s*[-–]\s*/g, ' ')
       .replace(/ (DE|EM|DA|DO) (DE|EM|DA|DO) /g, ' ')
       .replace(/\s{2,}/g, ' ').trim()
  let prev
  do { prev = s; s = s.replace(APELIDO_TRAIL, '').replace(APELIDO_LEAD, '').trim() } while (s !== prev)
  if (s.length < 2) s = String(nome).toUpperCase().replace(/["']/g, '').trim()
  if (s.length > max) {
    const cut = s.slice(0, max), sp = cut.lastIndexOf(' ')
    s = (sp > max * 0.55 ? cut.slice(0, sp) : cut).trim() + '…'
  }
  return s
}

// Universo de CREDITO curado = as listas 12.431 (incentivados) e CDI (tradicional).
// Fundo de credito e fundo caixa sao coisas DIFERENTES: o de credito aplica em
// fundo caixa pra gestao de liquidez. Um fundo de credito NUNCA e' fundo caixa,
// mesmo com caixa% alto (varios sao master/infra com muita compromissada -> caixa%
// ate' >100%). Os fundos caixa de verdade (money market/soberano) aparecem como
// segmento '(fora das listas)'.
export function ehFundoCredito(segmento) {
  return segmento === 'CDI' || segmento === '12431'
}

// Rotulos e classes de nivel de confianca / classificacao de fundo caixa.
export const CONF_LABEL = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }

export function classeCaixaKind(txt) {
  const s = String(txt || '')
  if (s.startsWith('fundo caixa confirmado')) return 'confirmado'
  if (s.startsWith('candidato')) return 'candidato'
  if (s === 'dados insuficientes') return 'insuficiente'
  return 'nao'
}

/** Linha por fundo (Caixa_Potencial_Fundos.csv) -> objeto tipado. */
export function normalizeCaixaFundos(rows) {
  return rows.map(r => ({
    cnpj: r.CNPJ || '',
    nome: r.Nome || '',
    gestor: r.Gestor || '',
    segmento: r.Segmento || '',
    mesBase: r.MesBase || '',
    pl: num(r.PL_Carteira),
    disp: num(r.Disponibilidades),
    titpub: num(r.TitulosPublicos),
    compr: num(r.Compromissadas),
    parcelaAberta: num(r.ParcelaAberta),
    parcelaConfid: num(r.ParcelaConfid),
    cotasNaoId: num(r.CotasNaoIdentificadas),
    caixaDireto: num(r.CaixaDireto),
    caixaIndiretoConf: num(r.CaixaIndiretoConfirmado),
    caixaIndiretoCand: num(r.CaixaIndiretoCandidato),
    caixaTotal: num(r.CaixaPotencialTotal),
    pctPL: num(r.PctPL),
    classe: r.ClasseFundoCaixa || '',
    // Fundo de credito nunca e' fundo caixa: neutraliza confirmado/candidato pra
    // quem esta' nas listas curadas (preserva 'insuficiente'/'nao'). Corrige ja'
    // no app, antes mesmo do pipeline reprocessar.
    classeKind: ehFundoCredito(r.Segmento) && ['confirmado', 'candidato'].includes(classeCaixaKind(r.ClasseFundoCaixa))
      ? 'nao'
      : classeCaixaKind(r.ClasseFundoCaixa),
    plDiario: num(r.PLDiario),
    dataPLDiario: r.DataPLDiario || '',
    caixaEstimado: num(r.CaixaEstimadoAtual),
    fluxoPosterior: num(r.FluxoLiquidoPosterior),
    cobertura: num(r.Cobertura),
    confianca: (r.NivelConfianca || '').trim().toLowerCase(),
    feeder: yn(r.Feeder),
    compradorDireto: yn(r.CompradorDireto),
    noConsolidado: yn(r.NoConsolidado),
    caixaConsolidado: num(r.CaixaConsolidado),
    justificativa: r.Justificativa || '',
  }))
}

/** Linha por gestor (Caixa_Potencial_Gestores.csv) -> objeto tipado. */
export function normalizeCaixaGestores(rows) {
  return rows.map(r => ({
    gestor: r.Gestor || '',
    numFundos: num(r.NumFundos) || 0,
    pl: num(r.PL_Carteira),
    caixaConsolidado: num(r.CaixaConsolidado),
    pctPL: num(r.PctPL),
    caixaEstimado: num(r.CaixaEstimadoAtual),
    fluxoPosterior: num(r.FluxoLiquidoPosterior),
  }))
}

/**
 * Agrega fundos (linhas do consolidado, noConsolidado=true) por gestor. Mesma
 * conta do Caixa_Potencial_Gestores.csv, mas client-side — assim o ranking
 * respeita o filtro de segmento e fica coerente com os cards. Soma bate com o
 * CSV quando sem filtro (soma fundos = soma gestores, conferido no motor).
 */
export function aggregateGestores(fundos) {
  const map = new Map()
  for (const f of fundos) {
    if (!f.noConsolidado) continue
    const g = f.gestor || '(sem gestor)'
    let o = map.get(g)
    if (!o) { o = { gestor: g, numFundos: 0, pl: 0, caixaConsolidado: 0, caixaEstimado: 0, fluxoPosterior: 0 }; map.set(g, o) }
    o.numFundos += 1
    o.pl += f.pl || 0
    o.caixaConsolidado += f.caixaConsolidado || 0
    o.caixaEstimado += f.caixaEstimado || 0
    o.fluxoPosterior += f.fluxoPosterior || 0
  }
  for (const o of map.values()) o.pctPL = o.pl > 0 ? o.caixaConsolidado / o.pl : null
  return [...map.values()]
}

/** Ordena copiando; nulos sempre no fim; nao muta a base. */
export function sortBy(rows, key, dir) {
  const arr = [...rows]
  arr.sort((a, b) => {
    const va = key(a), vb = key(b)
    const na = va == null || va === '', nb = vb == null || vb === ''
    if (na && nb) return 0
    if (na) return 1
    if (nb) return -1
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return dir === 'asc' ? cmp : -cmp
  })
  return arr
}

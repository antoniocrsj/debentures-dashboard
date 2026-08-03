// Sindicato de distribuição (coordenadores) das ofertas de DEBÊNTURES, do detalhe
// do SRE da CVM. Para cada oferta pega TODOS os coordenadores e marca o LÍDER.
//
// Fonte: API pública do SRE.
//   POST rest/sitePublico/pesquisar/detalhado          -> lista + cnpjCoordenadorLider + numeroRegistro
//   GET  rest/sitePublico/pesquisar/participantes/{id}  -> participantes (tipo COORDENADOR)
//
// Join com o Resumo Semanal: por NÚMERO DE REGISTRO. O Debentures.csv guarda
// "Registro CVM da Emissao" = "AUT/DEB/PRI/2026/368"; o SRE traz
// "CVM/SRE/AUT/DEB/PRI/2026/368" -> chave = numeroRegistro sem o prefixo "CVM/SRE/".
//
// Incremental: só busca participantes de registros ainda não cacheados.
// Saída: public/data/Coordenadores_SRE.json  { asOf, geradoEm, itens:{ chave: {...} } }
// Uso:   node tools/preparar-coordenadores-sre.mjs [--janela 60]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'public', 'data', 'Coordenadores_SRE.json')
const DET = 'https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/detalhado'
const PART = id => `https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/participantes/${id}`
const ACAO = id => `https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/acaoObjeto/${id}`
const UA = { 'User-Agent': 'Mozilla/5.0' }

// coleta {campoNome: campoValor} de qualquer nível do acaoObjeto.
function flattenCampos(obj) {
  const m = {}
  const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.campoNome != null) m[String(o.campoNome).trim()] = (o.campoValor ?? '').toString().trim(); for (const v of Object.values(o)) walk(v) } }
  walk(obj); return m
}
// parseia o TETO (remuneração máxima) p/ a forma compacta "B35 −20bps (piso 7,80%)".
// Ex.: "...NTN-B com vencimento em 15 de maio de 2035 ... spread negativo de 0,20%; ou (ii) 7,80%".
export function parseTeto(txt) {
  if (!txt) return null
  const t = txt.replace(/\s+/g, ' ')
  // ano da NTN-B: pega o 20xx logo após "vencimento em" (aceita "15 de maio de 2035" e "15/05/2035")
  const anoM = t.match(/vencimento em[^.]{0,40}?(20\d{2})/i)
  // spread: o 1º "X,XX%" após "acrescida/o"; sinal negativo se houver "negativ" nesse trecho
  const acresM = t.match(/acrescid[ao].*?(\d+),(\d+)\s*%/i)
  const cdiM = t.match(/CDI\s*\+\s*(\d+),(\d+)\s*%/i)
  const floorM = t.match(/\(ii\)\s*(\d+),(\d+)\s*%/i)
  const fixaM = t.match(/(\d+),(\d+)\s*%\s*a\.?\s*a\.?/i)
  // Formatos DIRETOS "NTN-B/NTNB [20]YY [sinal] X,XX%" (sem "vencimento em"), ex.:
  // "NTN-B35 - 0,10%", "NTNB40 - 1,18%", "NTN-B 2035 + 5,50%", "NTN-B32 (-) 0,35%",
  // "NTNB-30-0,05%". Fallback p/ quando o formato "vencimento em" não casa.
  const ntnbDiretoM = t.match(/\b(?:NTN-?)?B\s*-?\s*(?:20)?(\d{2})\b/i)
  let spreadDiretoBps = null
  if (ntnbDiretoM) {
    const resto = t.slice(ntnbDiretoM.index + ntnbDiretoM[0].length)
    const sm = resto.match(/(\(?\s*[-−–]\s*\)?|\+)\s*(\d+),(\d+)\s*%/)
    if (sm) { const neg = /[-−–]/.test(sm[1]); spreadDiretoBps = Math.round(parseFloat(`${sm[2]}.${sm[3]}`) * 100) * (neg ? -1 : 1) }
  }
  let ntnb = null, spreadBps = null
  if (anoM) ntnb = 'B' + anoM[1].slice(2)
  else if (ntnbDiretoM) ntnb = 'B' + ntnbDiretoM[1]
  // negativo pela PALAVRA "negativo" OU por um sinal de MENOS literal antes do
  // número (ex.: "spread ... de, no máximo, -1,15%" — sem a palavra "negativo").
  if (acresM) { const neg = /negativ/i.test(acresM[0]) || /[-−–]\s*\d+,\d+\s*%/.test(acresM[0]); spreadBps = Math.round(parseFloat(`${acresM[1]}.${acresM[2]}`) * 100) * (neg ? -1 : 1) }
  else if (spreadDiretoBps != null) spreadBps = spreadDiretoBps
  const floorPct = floorM ? `${floorM[1]},${floorM[2]}%` : null
  const compacto = (ntnb && spreadBps != null) ? `${ntnb} ${spreadBps < 0 ? '−' : '+'}${Math.abs(spreadBps)}bps`
    : cdiM ? `CDI + ${cdiM[1]},${cdiM[2]}%`
    : (fixaM && !ntnb) ? `${fixaM[1]},${fixaM[2]}%` : null
  return (compacto || floorPct) ? { compacto, ntnb, spreadBps, floorPct } : null
}

const args = process.argv.slice(2)
const argVal = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const JANELA = Math.max(7, parseInt(argVal('--janela', '60'), 10) || 60)
const digits = s => String(s || '').replace(/\D/g, '')
const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const isDeb = vm => { const t = (vm || '').toLowerCase(); return t.includes('deb') && t.includes('nture') }
// numeroRegistro pode ser COMPOSTO numa oferta multi-série: cada série tem seu
// próprio registro, unidos por ";" (ex.: ".../362;CVM/SRE/.../363;...;/367"). O
// Debentures.csv guarda cada série sob o registro INDIVIDUAL ("AUT/DEB/PRI/2026/362").
// -> devolve uma CHAVE por série (prefixo "CVM/SRE/" removido de cada uma).
const chavesRegistro = nr => (nr || '').split(';').map(x => x.replace(/^CVM\/SRE\//i, '').trim()).filter(Boolean)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function detalhado(de, ate, pagina, tam) {
  const body = { periodoCriacaoProcesso: { de, ate }, opa: false, tipoOferta: 'OFERTA_REGULAR', modalidade: 'TODAS', direcaoOrdenacao: 'DESC', colunaOrdenacao: 'data', pagina, tamanhoPagina: String(tam) }
  const r = await fetch(DET, { method: 'POST', headers: { 'Content-Type': 'application/json', ...UA }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`detalhado HTTP ${r.status}`)
  return r.json()
}

async function main() {
  // cache existente (incremental)
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(OUT, 'utf8')).itens || {} } catch {}
  const hoje = new Date(), de = new Date(hoje); de.setDate(de.getDate() - JANELA)
  const deStr = ddmmyyyy(de), ateStr = ddmmyyyy(hoje)

  // 1) lista de ofertas de debêntures na janela
  const ofertas = []
  let pagina = 1, totalPaginas = 1
  do {
    const j = await detalhado(deStr, ateStr, pagina, 200)
    totalPaginas = j.totalPaginas || 1
    for (const r of (j.registros || [])) if (isDeb(r.nomeValorMobiliario) && r.numeroRegistro) ofertas.push(r)
    pagina++
  } while (pagina <= totalPaginas && pagina <= 60)   // janela larga (ex.: 550d) tem ~33 páginas; 20 cortava os meses antigos

  let buscados = 0, reaproveitados = 0, falhas = 0
  for (const o of ofertas) {
    const chaves = chavesRegistro(o.numeroRegistro)
    if (!chaves.length) continue
    if (chaves.every(k => cache[k])) { reaproveitados++; continue }   // já temos todas as séries
    try {
      const r = await fetch(PART(o.idRequerimento), { headers: UA })
      if (!r.ok) throw new Error(`participantes HTTP ${r.status}`)
      const parts = await r.json()
      const cnpjLider = digits(o.cnpjCoordenadorLider)
      const coords = parts.filter(p => (p.tipo || '').toUpperCase() === 'COORDENADOR').map(p => ({
        razaoSocial: (p.razaoSocial || '').trim(), cnpj: (p.cnpjInstituicao || '').trim(),
        lider: cnpjLider && digits(p.cnpjInstituicao) === cnpjLider,
      }))
      // garante o líder marcado mesmo se não veio na lista de participantes
      if (cnpjLider && !coords.some(c => c.lider) && o.nomeCoordenadorLider) coords.unshift({ razaoSocial: o.nomeCoordenadorLider.trim(), cnpj: o.cnpjCoordenadorLider || '', lider: true })
      // acaoObjeto: campos estruturados POR SÉRIE (array, um elemento por série).
      // Numa oferta multi-série cada série tem sua PRÓPRIA remuneração máxima/final
      // (ex.: série IPCA "NTN-B 2033 +0,55%" vs série PRÉ "14,315%"). Antes o
      // flattenCampos colapsava tudo e a última série sobrescrevia as outras ->
      // a série IPCA perdia o teto. Agora mapeia posicional: chaves[i] <-> acaoObjeto[i].
      let acaoArr = []
      try { const ra = await fetch(ACAO(o.idRequerimento), { headers: UA }); if (ra.ok) { const j = await ra.json(); acaoArr = Array.isArray(j) ? j : [j] } } catch {}
      const base = {
        numeroRegistro: o.numeroRegistro, idRequerimento: String(o.idRequerimento),
        cnpjEmissor: o.cnpjEmissor || '', data: o.data || '',
        lider: o.nomeCoordenadorLider ? { nome: o.nomeCoordenadorLider.trim(), cnpj: o.cnpjCoordenadorLider || '' } : null,
        coordenadores: coords,
      }
      chaves.forEach((k, i) => {
        const campos = flattenCampos(acaoArr[i] ?? acaoArr[0] ?? {})   // dados DESSA série
        const remMax = campos['Informações sobre remuneração máxima'] || ''
        cache[k] = {
          ...base,
          remuneracaoMaxima: remMax || null,
          teto: parseTeto(remMax),
          remuneracaoFinal: campos['Informações sobre remuneração final (pós bookbuilding)'] || null,
          rating: campos['Avaliação de risco'] || null,
          setorProjeto: campos['Setor e subsetor do projeto de investimento'] || null,
        }
      })
      buscados++
      await sleep(150)   // polido com a API pública
    } catch (e) { falhas++; }
  }
  const doc = {
    asOf: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    geradoEm: hoje.toISOString(), fonte: 'CVM SRE (participantes)', janelaDias: JANELA,
    total: Object.keys(cache).length, itens: cache,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`[coordenadores-sre] ofertas na janela: ${ofertas.length} | novos: ${buscados} | cache: ${reaproveitados} | falhas: ${falhas} | total: ${doc.total} -> ${path.relative(process.cwd(), OUT)}`)
}
// só executa quando chamado direto (não ao ser importado por um teste)
if (process.argv[1] && /preparar-coordenadores-sre\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(e => { console.error('[coordenadores-sre] FALHOU:', e.message); process.exit(1) })
}

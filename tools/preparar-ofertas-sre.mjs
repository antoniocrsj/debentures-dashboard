// Novas ofertas de DEBENTURES na CVM (SRE - Sistema de Registro de Ofertas),
// em TEMPO REAL: pega as ofertas assim que sao protocoladas (mesmo antes de
// precificar/registrar), diferente do dados-abertos (so' "Registro Concedido").
//
// Fonte: API publica do SRE (mesma que o site web.cvm.gov.br/sre-publico-cvm usa).
//   POST rest/sitePublico/pesquisar/detalhado  { periodoCriacaoProcesso, ... }
// Sem login/cookie. Alimenta o Resumo do Dia (bloco "Novas ofertas na CVM (SRE)").
//
// Saida: public/data/Novas_Ofertas_SRE.json  { asOf, geradoEm, janelaDias, itens[] }
// Uso:  node tools/preparar-ofertas-sre.mjs [--janela 15] [--out <arquivo>]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', 'public')
const DATA = path.join(PUBLIC, 'data')
const BASE = 'https://web.cvm.gov.br/sre-publico-cvm/rest/sitePublico/pesquisar/detalhado'

const args = process.argv.slice(2)
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const JANELA = Math.max(1, parseInt(argVal('--janela', '15'), 10) || 15)
const OUT = argVal('--out', path.join(DATA, 'Novas_Ofertas_SRE.json'))

// dd/MM/yyyy (sem UTC/locale surpresa)
const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
// "150.000.000,0000" -> 150000000  (pt-BR: ponto milhar, virgula decimal)
const parseValor = s => {
  if (s == null) return 0
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
// dd/MM/yyyy -> yyyy-MM-dd (ordenacao/consistencia com o resto do app)
const isoDate = s => {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || '')
}
const isDebenture = vm => { const t = (vm || '').toLowerCase(); return t.includes('deb') && t.includes('nture') }

async function pesquisar(de, ate, pagina, tamanho) {
  const body = {
    periodoCriacaoProcesso: { de, ate },
    opa: false, tipoOferta: 'OFERTA_REGULAR', modalidade: 'TODAS',
    direcaoOrdenacao: 'DESC', colunaOrdenacao: 'data',
    pagina, tamanhoPagina: String(tamanho),
  }
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`SRE HTTP ${r.status}`)
  return r.json()
}

async function main() {
  const hoje = new Date()
  const de = new Date(hoje); de.setDate(de.getDate() - JANELA)
  const deStr = ddmmyyyy(de), ateStr = ddmmyyyy(hoje)

  const TAM = 200
  const registros = []
  let pagina = 1, totalPaginas = 1
  do {
    const j = await pesquisar(deStr, ateStr, pagina, TAM)
    totalPaginas = j.totalPaginas || 1
    for (const x of (j.registros || [])) registros.push(x)
    pagina++
  } while (pagina <= totalPaginas && pagina <= 30)   // teto de seguranca

  // So' debentures; dedup por idRequerimento; ordena por data desc.
  const vistos = new Set()
  const itens = registros
    .filter(x => isDebenture(x.nomeValorMobiliario))
    .filter(x => { const id = String(x.idRequerimento || ''); if (!id || vistos.has(id)) return false; vistos.add(id); return true })
    .map(x => ({
      idRequerimento: String(x.idRequerimento || ''),
      data: isoDate(x.data),
      emissor: (x.nomeEmissor || '').trim(),
      cnpj: (x.cnpjEmissor || '').trim(),
      valor: parseValor(x.valorTotalEmReais),
      status: (x.statusDaOferta || '').trim(),
      lider: (x.nomeCoordenadorLider || '').trim(),
      tipoOferta: (x.tipoDeOferta || '').trim(),
      numeroProtocolo: (x.numeroProtocolo || '').trim(),
      numeroRegistro: (x.numeroRegistro || '').trim() || null,
      possuiBook: !!x.possuiBook,
      registroAutomatico: !!x.registroAutomatico,
    }))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))

  const doc = {
    asOf: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    geradoEm: hoje.toISOString(),
    fonte: 'CVM SRE (rest/sitePublico/pesquisar/detalhado)',
    janelaDias: JANELA,
    periodo: { de: deStr, ate: ateStr },
    total: itens.length,
    itens,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`[ofertas-sre] ${itens.length} debenture(s) na janela ${deStr}..${ateStr} -> ${path.relative(process.cwd(), OUT)}`)
  for (const e of itens.slice(0, 12)) {
    console.log(`  ${e.data} | ${e.emissor} | R$ ${e.valor.toLocaleString('pt-BR')} | ${e.status}`)
  }
}

main().catch(e => { console.error('[ofertas-sre] FALHOU:', e.message); process.exit(1) })

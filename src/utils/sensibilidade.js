// Logica PURA (sem I/O) da analise de sensibilidade de corte de %Deb: dado o
// universo candidato (CNPJ -> segmento/%Deb, de Universo_Candidatos.csv) e a
// captacao diaria desse universo (Fluxo_Diario_Candidatos.csv), varre um corte
// de %Deb e soma a captacao REAL (nao estimada) dos fundos que passariam nesse
// corte. Compartilhada entre o gerador Node (tools/gerar-sensibilidade-corte.mjs)
// e os testes.
import { keyToDate, dateToKey } from './periods.js'

// Grade de cortes (ex.: 10..80 passo 1 = 71 pontos). "Continuo" na UI = slider
// sobre essa grade densa.
export function cortesRange(min = 10, max = 80, step = 1) {
  const out = []
  for (let c = min; c <= max + 1e-9; c += step) out.push(Math.round(c * 100) / 100)
  return out
}

// Janela de datas [inicio, fim] terminando na data-ancora (a mais recente do
// fluxo). 'total' = sem corte de inicio.
export function janelaRange(anchorKey, meses) {
  if (!anchorKey) return null
  if (meses == null) return { start: null, end: anchorKey }
  const d = keyToDate(anchorKey)
  if (!d) return null
  const ini = new Date(d.getFullYear(), d.getMonth() - meses, d.getDate())
  return { start: dateToKey(ini), end: anchorKey }
}

const emSegmento = seg => (seg === '12431' ? '12431' : 'trad')

// universo: [{cnpj, segmento:'12431'|'CDI'|'trad', pctDeb(percentual, ex 12.5), pl}]
// fluxo:    [{dia:'AAAA-MM-DD', cnpj, captacao, resgate, pl}]
// cortes:   array de percentuais (ex. [10,11,...,80])
// janelas:  { total: null, '12m': 12, '6m': 6 } (meses; null = sem corte)
export function aggSensibilidade({ universo, fluxo, cortes, janelas }) {
  const anchorKey = fluxo.reduce((m, r) => (r.dia > m ? r.dia : m), '')
  const uniPorSeg = { '12431': [], trad: [] }
  for (const u of universo) uniPorSeg[emSegmento(u.segmento)].push(u)

  // fluxo indexado por cnpj -> linhas ordenadas por dia (asc), pra somar rapido
  // dentro de qualquer janela sem varrer tudo de novo a cada corte.
  const porCnpj = new Map()
  for (const r of fluxo) {
    if (!porCnpj.has(r.cnpj)) porCnpj.set(r.cnpj, [])
    porCnpj.get(r.cnpj).push(r)
  }
  for (const arr of porCnpj.values()) arr.sort((a, b) => a.dia.localeCompare(b.dia))

  // Soma por fundo dentro de uma janela, UMA vez (nao recalculada a cada corte
  // varrido - so' o CONJUNTO de fundos qualificados muda por corte, nao a soma
  // por fundo). linhas ja' vem ordenadas por dia ASC -> a ultima linha dentro da
  // janela e' automaticamente a data mais recente (PL = estoque, nao soma).
  function somaPorFundo(cnpjs, range) {
    const out = new Map()
    for (const cnpj of cnpjs) {
      const linhas = porCnpj.get(cnpj)
      if (!linhas || !linhas.length) continue
      let captacao = 0, resgate = 0, pl = 0, contribuiu = false
      for (const r of linhas) {
        if (range && ((range.start && r.dia <= range.start) || r.dia > range.end)) continue
        captacao += r.captacao; resgate += r.resgate; contribuiu = true; pl = r.pl
      }
      if (contribuiu) out.set(cnpj, { captacao, resgate, pl })
    }
    return out
  }

  const porSegmento = {}
  for (const seg of ['12431', 'trad']) {
    const universoSeg = [...uniPorSeg[seg]].sort((a, b) => b.pctDeb - a.pctDeb)
    const cnpjsSeg = universoSeg.map(u => u.cnpj)
    porSegmento[seg] = {}
    for (const [janelaId, meses] of Object.entries(janelas)) {
      const range = janelaRange(anchorKey, meses)
      const somas = somaPorFundo(cnpjsSeg, range)
      const pontos = cortes.map(corte => {
        let captacao = 0, resgate = 0, pl = 0, numFundos = 0
        for (const u of universoSeg) {
          if (!(u.pctDeb > corte)) continue
          const s = somas.get(u.cnpj)
          if (!s) continue
          captacao += s.captacao; resgate += s.resgate; pl += s.pl; numFundos++
        }
        return {
          corte, numFundos,
          pl: Math.round(pl * 100) / 100,
          captacao: Math.round(captacao * 100) / 100,
          resgate: Math.round(resgate * 100) / 100,
          liquido: Math.round((captacao - resgate) * 100) / 100,
        }
      })
      porSegmento[seg][janelaId] = pontos
    }
  }
  return { anchorKey, cortes, porSegmento }
}

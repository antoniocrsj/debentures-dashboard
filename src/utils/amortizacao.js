// Agregacao do cronograma de amortizacao (principal) por ANO, para o conjunto
// de debentures FILTRADO na aba Debentures. Alimenta o grafico de vencimentos
// que reage a todos os filtros (grupo/gestor/ativo/setor/12.431/busca).
//
// Modelo de R$ (validado offline: a soma futura reconstroi o volume em mercado):
// o VOLUME EM MERCADO de hoje (qtd x VNA) e' o principal que ainda sera' pago;
// ele e' distribuido pelas parcelas FUTURAS do cronograma, proporcional a'
// fracao de cada uma. Assim a soma das parcelas futuras = volume atual (todo o
// que esta' em mercado vence ate' o vencimento), sem depender do principal
// original (que nao temos limpo).

// hoje em 'yyyy-mm-dd' p/ comparar com a data do evento por string (mesmo fuso).
function hojeStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// assets: [{ codigoAtivo, volumeEmitido }]  (volumeEmitido = qtd em mercado x VNA)
// cronoMap: Map(ticker -> [{ data:'yyyy-mm-dd', pct:number }])  (pct = fracao do principal, 0-100)
// -> [{ ano:'2026', valor: R$, fontes: Set }]  ordenado por ano.
export function amortPorAno(assets, cronoMap, { ateAno = null, campo = 'volumeEmitido' } = {}) {
  if (!assets || !cronoMap) return []
  const hoje = hojeStr()
  const porAno = new Map()
  const fontesPorAno = new Map()
  for (const a of assets) {
    const evs = cronoMap.get(a.codigoAtivo)
    const vol = a[campo]
    if (!evs || !(vol > 0)) continue
    const fut = evs.filter(e => e.data >= hoje)
    const somaFut = fut.reduce((s, e) => s + e.pct, 0)
    if (somaFut <= 0) continue
    for (const e of fut) {
      const rs = vol * (e.pct / somaFut)
      let ano = e.data.slice(0, 4)
      if (ateAno && +ano > ateAno) ano = `${ateAno}+`
      porAno.set(ano, (porAno.get(ano) || 0) + rs)
      if (e.fonte) { let s = fontesPorAno.get(ano); if (!s) { s = new Set(); fontesPorAno.set(ano, s) } s.add(e.fonte) }
    }
  }
  return [...porAno.keys()].sort().map(ano => ({
    ano,
    valor: porAno.get(ano),
    fontes: fontesPorAno.get(ano) || new Set(),
  }))
}

// Fracao do total que e' ESTIMADA (fonte 'linear') no conjunto -- p/ a UI avisar
// quando parte relevante do grafico e' aproximacao, nao cronograma real.
export function fracaoEstimada(assets, cronoMap, campo = 'volumeEmitido') {
  if (!assets || !cronoMap) return 0
  let est = 0, tot = 0
  for (const a of assets) {
    const evs = cronoMap.get(a.codigoAtivo)
    const vol = a[campo]
    if (!evs || !(vol > 0)) continue
    tot += vol
    if (evs.some(e => e.fonte === 'linear')) est += vol
  }
  return tot > 0 ? est / tot : 0
}

// Teto de anos do grafico/filtro (10 anos + balde "N+"). Compartilhado p/ o
// clique na barra filtrar pelo MESMO bucket que a barra representa.
export const ATE_ANO = new Date().getFullYear() + 9

// Bucket de ano de uma data 'yyyy-mm-dd': o ano, ou 'ATE_ANO+' se passar do teto.
export function anoBucket(dataStr, ateAno = ATE_ANO) {
  const y = +dataStr.slice(0, 4)
  return y > ateAno ? `${ateAno}+` : String(y)
}

// O ativo tem alguma amortizacao FUTURA no bucket `ano`? (mesma regra do grafico)
export function amortizaNoAno(evs, ano, ateAno = ATE_ANO) {
  if (!evs) return false
  const d = new Date()
  const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return evs.some(e => e.data >= hoje && anoBucket(e.data, ateAno) === ano)
}

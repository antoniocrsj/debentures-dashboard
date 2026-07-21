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
export function amortPorAno(assets, cronoMap, { ateAno = null } = {}) {
  if (!assets || !cronoMap) return []
  const hoje = hojeStr()
  const porAno = new Map()
  const fontesPorAno = new Map()
  for (const a of assets) {
    const evs = cronoMap.get(a.codigoAtivo)
    if (!evs || !(a.volumeEmitido > 0)) continue
    const fut = evs.filter(e => e.data >= hoje)
    const somaFut = fut.reduce((s, e) => s + e.pct, 0)
    if (somaFut <= 0) continue
    for (const e of fut) {
      const rs = a.volumeEmitido * (e.pct / somaFut)
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
export function fracaoEstimada(assets, cronoMap) {
  if (!assets || !cronoMap) return 0
  let est = 0, tot = 0
  for (const a of assets) {
    const evs = cronoMap.get(a.codigoAtivo)
    if (!evs || !(a.volumeEmitido > 0)) continue
    tot += a.volumeEmitido
    if (evs.some(e => e.fonte === 'linear')) est += a.volumeEmitido
  }
  return tot > 0 ? est / tot : 0
}

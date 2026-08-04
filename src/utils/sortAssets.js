import { dateKey } from './format.js'

// Ordena uma lista de assets (debentures enriquecidas) por coluna/direcao.
// Puro: devolve um NOVO array. Mesma logica da tabela Ativos (App) e do
// drill-down de Emissoes (aba Tecnico), pra a ordenacao ficar identica nos dois.
// Recompra/breakeven sem valor sempre vao pro fim (independe da direcao).
export function sortAssets(assets, { col, dir } = {}) {
  const arr = [...(assets || [])]
  if (!col) return arr
  const key = a => {
    if (col === 'ativo')       return (a.codigoAtivo || '').toLowerCase()
    if (col === 'registroCvm') return dateKey(a.registroCvm)
    if (col === 'vencimento')  return dateKey(a.vencimento)
    if (col === 'taxa')        return parseFloat((a.taxa || '').replace(',', '.')) || 0
    if (col === 'txanbima') {
      // spread da ANBIMA em bps (ver anbimaTxSpread); sem dado (PRÉ/outros) vai pro fim.
      const v = a.txAnbimaBps
      return (v == null || !isFinite(v)) ? (dir === 'asc' ? Infinity : -Infinity) : v
    }
    if (col === 'duration') {
      // durationAnbima é "2,13" (anos) ou "—"; sem dado vai pro fim (independe da direção).
      const v = (a.durationAnbima && a.durationAnbima !== '—') ? parseFloat(String(a.durationAnbima).replace(',', '.')) : NaN
      return isFinite(v) ? v : (dir === 'asc' ? Infinity : -Infinity)
    }
    if (col === 'vol')         return a.volumeEmitido
    if (col === 'alocacao')    return a.alocacao
    if (col === 'recompraTaxa') {
      const v = a.recompra?.taxaEvento
      return v == null ? (dir === 'asc' ? Infinity : -Infinity) : v
    }
    if (col === 'recompraData') {
      const k = dateKey(a.recompra?.dataEvento)
      return k || (dir === 'asc' ? '99999999' : '00000000')
    }
    return ''
  }
  arr.sort((a, b) => {
    const va = key(a), vb = key(b)
    const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb)
    return dir === 'asc' ? cmp : -cmp
  })
  return arr
}

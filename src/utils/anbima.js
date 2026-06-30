// Monta o link da página de características de uma debênture no ANBIMA Data a
// partir do ticker (= código do ativo). Retorna null quando não há ticker
// válido, para a UI esconder/desabilitar o botão em vez de abrir URL incompleta.

const ANBIMA_BASE = 'https://data.anbima.com.br/debentures'

/** Normaliza o ticker: remove espaços nas pontas e converte para maiúsculas. */
export function normalizeTicker(ticker) {
  return String(ticker ?? '').trim().toUpperCase()
}

/**
 * URL de características do ativo na ANBIMA, ou null se o ticker for vazio.
 * encodeURIComponent não altera números nem letras do código da debênture.
 */
export function anbimaUrl(ticker) {
  const t = normalizeTicker(ticker)
  if (!t) return null
  return `${ANBIMA_BASE}/${encodeURIComponent(t)}/caracteristicas`
}

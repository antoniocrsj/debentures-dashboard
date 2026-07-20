// Corte de %Deb GLOBAL: o filtro do topo que redefine QUAIS fundos entram na
// conta em todo o app (Captacao, Caixa e o lado "carteira" do Vencimentos).
//
// Por que degraus fixos e nao slider continuo: trocar o corte reagrega ~130 mil
// linhas de captacao por fundo + 2,7 mil de caixa + os fundos do vencimento.
// Com degraus da' p/ memoizar cada corte e a troca fica instantanea; com slider
// o numero tremeria a cada pixel arrastado.
//
// CORTE_OFICIAL e' a regua da curadoria (-LimiarPct de selecionar-fundos.ps1).
// No corte oficial o app usa as bases JA agregadas pelo pipeline (caminho
// rapido, numero identico ao de sempre); so' fora dele reagrega no cliente.
// Se mexer no LimiarPct, mexa aqui -- os dois tem que casar, senao o caminho
// rapido passa a servir um numero que nao corresponde ao corte selecionado.
export const CORTE_OFICIAL = 10

export const CORTES = [10, 15, 20, 30, 50]

// O universo so' vai ate' 80% (grade do sweep) e o mapa CNPJ->%Deb so' tem
// fundos acima do piso de 10%. Corte abaixo do oficial nao tem dado: o mapa
// nao enxerga quem ficou de fora da curadoria.
export const CORTE_MIN = CORTES[0]

export function isOficial(corte) { return corte === CORTE_OFICIAL }

export function rotuloCorte(corte) {
  return isOficial(corte) ? `${corte}% (oficial)` : `${corte}%`
}

// Set de CNPJs que passam do corte. `pctPorCnpj` e' o Map do usePctDeb.
// Fundo AUSENTE do mapa fica FORA quando o corte aperta -- e' o comportamento
// correto: sem %Deb conhecido nao da' p/ afirmar que ele passa da regua. No
// corte oficial ninguem chama esta funcao (usa-se a base agregada), entao a
// ausencia nunca tira fundo do numero que o usuario ve por padrao.
export function cnpjsNoCorte(pctPorCnpj, corte) {
  const out = new Set()
  if (!pctPorCnpj) return out
  for (const [cnpj, pct] of pctPorCnpj) {
    if (pct > corte) out.add(cnpj)
  }
  return out
}

// Normaliza CNPJ p/ o mesmo formato do mapa (so' digitos).
export function normCnpj(v) { return String(v || '').replace(/\D/g, '') }

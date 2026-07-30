// Abas ESCONDIDAS da navegacao, POR MODO de visualizacao.
// --------------------------------------------------------------------------
// O codigo e os dados dessas abas continuam INTACTOS -- some apenas o ponto de
// entrada na navegacao. Componentes, CSVs em public/ e os passos do pipeline
// (atualizar-tudo.ps1) seguem como estao, entao os dados ficam frescos.
//
// Hoje:
//   - DESKTOP  esconde Captacao, Nivel de Caixa e Vencimentos (fica Debentures,
//     Secundario e Tecnico -- esta ultima ja' consolida as tres).
//   - COMPACTO (mobile) mantem Captacao e Vencimentos no BottomNav; esconde so'
//     o Nivel de Caixa.
//
// PARA REEXIBIR uma aba: remova o id do Set do modo correspondente e rebuild.
// (Como e' versionado, um `git revert` do commit tambem funciona.) Ver HANDOFF.md.
export const ABAS_OCULTAS_DESKTOP  = new Set(['captacao', 'caixa', 'vencimentos'])
export const ABAS_OCULTAS_COMPACTO = new Set(['caixa'])

// Abas ESCONDIDAS da navegacao.
// --------------------------------------------------------------------------
// O codigo e os dados dessas abas continuam INTACTOS -- some apenas o ponto de
// entrada na barra de abas (desktop) e no BottomNav (mobile). Os componentes,
// os CSVs em public/ e os passos do pipeline (atualizar-tudo.ps1) seguem como
// estao, entao a atualizacao diaria mantem os dados frescos.
//
// PARA REEXIBIR uma aba: remova o id deste Set e faca o rebuild/deploy. E' so'
// isso -- nenhuma cirurgia. (Como e' versionado, um `git revert` do commit que
// escondeu tambem funciona.)
//
// Fonte UNICA: desktop (App.jsx) e mobile (BottomNav.jsx) filtram por este mesmo
// Set, e o loadInitialTab ignora ?tab=<escondida> na URL. Ver HANDOFF.md.
export const ABAS_OCULTAS = new Set(['captacao', 'caixa', 'vencimentos'])

# Handoff — debentures-dashboard

Contexto para quem assumir o trabalho a seguir. Atualizado no fim da sessão que
padronizou as tabelas das abas **Debêntures** e **Técnico**.

## Estado atual
- Branch `main`, sincronizado com `origin/main`. Deploy automático na Vercel a
  cada push (~1 min): https://debentures-dashboard-three.vercel.app
- Último trabalho: **padronização de tabelas** (commits `d053ce6` → `f09d8a7`).
- App: React 18 + Vite 5. Dev server: `npm run dev` (porta 5173).

## O que foi feito nesta sessão
Padronizou todas as tabelas das abas Debêntures e Técnico num único modelo,
tendo a tabela de **Ativos** (Debêntures) como referência canônica:
- Cabeçalho **26px** (nowrap, texto centrado na vertical); linha de dados **20px**;
  linha de **Total** branca + borda superior 1px carvão, **travada** (sticky) no rodapé.
- Tabelas **preenchem o card** de ponta a ponta (recuo vem do padding das células,
  não de moldura em volta).
- Rolagem **trava em linhas inteiras** (`round()` na altura do scroller + snap por
  linha): a última linha encaixa no Total, sem meia-linha.
- Tabela de gestoras (Técnico): removida a coluna **% Caixa**, 4 colunas
  distribuídas, **sem scroll horizontal** (`table-layout: fixed` + 1ª coluna com
  reticências).

Commits (mais recente primeiro):
- `f09d8a7` remove %Caixa das gestoras + elimina scroll horizontal
- `79a91a9` conserta corte da última linha da tabela de gestoras
- `e1ffe60` centraliza o texto do cabeçalho na vertical
- `83033ab` tabelas da Técnico preenchem o card + cria MODELO_TABELA.md
- `61837f7` padroniza tabelas das abas Debêntures e Técnico
- `d053ce6` Ativos: última linha encaixa no Total até no topo

## Referência obrigatória
📄 **[`MODELO_TABELA.md`](MODELO_TABELA.md)** — spec canônica da tabela (Ativos).
É o contrato para qualquer tabela nova ou alterada nessas abas: alturas, Total,
trava em linhas inteiras, variante "ranking" (div), e o caveat da barra de
rolagem horizontal.

## Abas escondidas (feature-flag, POR MODO)
Escondidas da navegação via `src/config/abas.js`, com Set separado por modo:
- **Desktop** (`ABAS_OCULTAS_DESKTOP`, usado em `App.jsx`): esconde Captação,
  Nível de Caixa e Vencimentos → ficam Debêntures, Secundário, **Técnico** (que
  consolida as três). `loadInitialTab` ignora `?tab=<escondida>`.
- **Compacto** (`ABAS_OCULTAS_COMPACTO`, usado em `BottomNav.jsx`): esconde só o
  Nível de Caixa → BottomNav mostra Debêntures, Secundário, Captação, Vencimentos.

Código, componentes, CSVs em `public/` e o pipeline (`atualizar-tudo.ps1`) ficam
**intactos** — os dados seguem atualizando.
- **Reexibir uma aba:** remova o id do Set do modo correspondente e rebuild.

## Convenções do repositório (IMPORTANTE)
- **Árvore de trabalho compartilhada** com outro agente + rotina automática.
  Antes de commitar: `git fetch` e cheque ahead/behind. **Nunca `git add -A`** —
  adicione arquivos explicitamente.
- Há arquivos **de terceiros não versionados** que NÃO devem ser commitados:
  `.codex-remote-attachments/`, `outputs/`, `diag.mjs`,
  `colunas_oferta_resolucao_160.txt`, `prompt-resumo-do-dia.txt`,
  `sheet_auditoria.xlsx`.
- `public/bdi/` é gitignorado (tape B3, ~20MB) — não commitar.
- Ecossistema: leia `CLAUDE.md`, `AGENTS.md` e `ROADMAP_ECOSSISTEMA.md` antes de
  decidir onde trabalhar (o repo par é o `credit-analyst`/Ana, local, sem remote).

## Armadilhas de verificação
- **Screenshots do preview interno falham** (o pane não composita frames). Verifique
  layout por **medição de DOM** (`getBoundingClientRect` via console) ou pelo Chrome.
- Ao medir o app, cuidado com o modo **compacto**: em janela estreita (<~600px) o
  app troca para o layout mobile (sem os tabs desktop, sem a linha de Total das
  tabelas). Redimensione para ≥1280px de largura.
- Trava de linhas inteiras: se a tabela **rola no eixo X**, a barra horizontal come
  ~10px da altura útil e corta a última linha — ver o caveat no MODELO_TABELA.md
  (solução preferida: fazer caber, sem scroll X).

## Possíveis próximos passos (em aberto, não iniciados)
- Tabelas da aba **Caixa** ainda usam cabeçalho ~33px (`SortableTh` não achatado) —
  estão fora do escopo formal, mas poderiam entrar no mesmo modelo para
  consistência total do app.
- Confirmar visualmente o build publicado na Vercel do `f09d8a7` (código verificado
  limpo por medição; falta só o olho no deploy).

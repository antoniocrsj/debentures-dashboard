# Handoff — debentures-dashboard

Contexto para quem assumir o trabalho a seguir.

## Estado atual
- Branch `main`, sincronizado com `origin/main`. Deploy automático na Vercel a
  cada push (~1 min): https://debentures-dashboard-three.vercel.app
- Último commit: `d1565b5`. App: React 18 + Vite 5. Dev server: `npm run dev` (5173).

## Entrega desta sessão: Mercado Verdadeiro (metodologia) + REUNE + 12 meses
Frente de **dados/metodologia** do Secundário (paralela ao layout descrito abaixo).

**1. REUNE removido de tudo** (`3499e21`). O REUNE (trades) era fetch morto no app +
seção 6 do Resumo do Dia + passo do pipeline. Removido: app, `ResumoDoDiaModal`,
`gerar-relatorios.mjs`, `preparar-reune.ps1`; deletados `REUNE_Historico.csv`,
`spreadRef.js`, `cruzar-reune-bdi.mjs`. **A curva TPF (`REUNE_Curvas.csv`, nome legado)
FICOU** — é load-bearing pro spread. Fonte de datas repontada: diário via `Anbima_Tx.csv`,
backfill via `Mercado_Verdadeiro.csv`. Ver memória [[reune-historico-tpf-tesouro]].

**2. Secundário estendido p/ 12 meses** (`9515355`): tape BDI de 92 → **252 pregões**
(31/07/2025 → 30/07/2026). Ordem que importa: **varredura roda DEPOIS do backfill da
curva** (senão spreads das datas antigas saem vazios).

**3. Recalibração da metodologia Mercado Verdadeiro** (`f71d5d3`) — calibrada com o
usuário p/ reconciliar o mercado tradicional com a referência de **150–500 MM/dia**:
- **chave por DATA DE LIQUIDAÇÃO** (era trade): `gruposPorLiquidacao` em `lib-mercado.mjs`.
- **banda de fee [0,7; 2,3] bps × duration** (era [1; 2]).
- **relevância >10MM REMOVIDA**.
- Resultado: mercado **16,4% → 31,8%** do econômico; tradicional **~277 MM/dia** (na faixa).
- CSV: só `VolMercado>0` + 10 colunas (era 15) → **4,0 MB**. Aba guiada por liquidação
  (coluna "Liq.", filtro "Liquidação").
- Doc `METODOLOGIA_Mercado_Verdadeiro.md` + memórias [[bdi-b3-negocio-a-negocio]] atualizados.

**4. Lupa alinhada** (`d1565b5`): `node tools/lupa-mercado.mjs [N] [TICKER]` agora usa a
mesma metodologia (liquidação + banda nova) — inspeção bate com a produção.

**Como regenerar a base:** `atualizar-tudo.ps1` (passos BDI → Curvas TPF → Secundário/
varredura). Manual: `node tools/preparar-bdi-negocios.mjs 252` → `node tools/preparar-reune-curvas-historico.mjs` → `node tools/varredura-mercado.mjs`.

**Avisos honestos:**
- A **data de liquidação mais recente é parcial** (T+1 do último pregão; falta o T+0 do
  dia seguinte, ainda não puxado). O dia mais novo sempre fica incompleto.
- **CSV 4 MB** (era 1,5): fetch OK, mas o cache do localStorage pode estourar → recarrega
  toda vez (o app funciona, só perde o cache instantâneo).
- Os `.gz` do tape (`public/bdi/`) são gitignored; só o `Mercado_Verdadeiro.csv` versiona.

## Entrega paralela: layout da aba Secundário
A aba Secundário agora funciona como um painel master-detail, com a tabela de
negócios à esquerda e o resumo visual à direita no desktop.

- Três cards respondem aos filtros ativos: **Volume 12.431**, **Volume
  tradicional** e **Número de trades**.
- O seletor único **3m / 6m / 12m** recorta toda a aba pela data mais recente da
  própria base, com **6m** como padrão. Busca, tabelas, cards e gráficos usam a
  mesma janela.
- O filtro 12.431 mostra apenas **12.431** e **Tradicional**. Nenhum selecionado
  significa todos; clicar novamente na opção ativa remove o filtro.
- A formatação final dos filtros usa **Liq: todas**, seletor de Ativo pesquisável
  no mesmo padrão de Emissor e **R$: Total** como rótulo padrão do volume.
- O botão **Limpar** fica ao lado dos cards no desktop, sem criar uma segunda
  linha de filtros. No compacto ele permanece na faixa rolável de filtros.
- O novo gráfico semanal agrega **volume total** e **quantidade de trades** por
  semana ISO. Ele responde à busca, data, tipo de fundo e seleção de uma linha.
- A escala do volume é flexível, busca aproximadamente oito divisões e nunca usa
  intervalo superior a R$ 1 bilhão. O volume sempre mostra uma casa decimal;
  trades permanecem inteiros.
- Os eixos X dos dois gráficos exibem o ano no formato `dd/mm/aa`.
- As grades horizontais são tracejadas, finas e ficam atrás das colunas. Volume
  usa terracota (`#8c5e3a`); trades e a linha do eixo X usam taupe (`#9a8c7a`).
- Os dois gráficos têm a mesma altura no desktop, ocupam o espaço disponível e
  terminam alinhados com a tabela, mantendo respiro no rodapé da tela.
- Ao selecionar um grupo, sua tabela de ativos aparece abaixo dos trades. Ela
  ocupa exatamente a mesma faixa do gráfico semanal: mesmo topo, altura de
  242px e rodapé. A tabela principal usa todo o espaço restante acima.
- A tabela principal tem oito colunas; **Indexador** e **12.431** foram removidas.
  Na tabela de ativos do grupo, os dados da coluna Ativo ficam centralizados.
- No gráfico evolutivo, a janela inicial é de +/-30 bps ou +/-0,30 pp, expandida
  quando os dados exigem. Há no máximo sete linhas; os passos são múltiplos de
  10 bps ou 0,10 pp e o eixo Y sempre exibe uma casa decimal.
- O título do gráfico evolutivo mostra apenas o ativo. O texto auxiliar com tipo
  de spread e número de pregões foi removido para reduzir ruído visual.
- O modo compacto foi mantido e conferido separadamente.

Arquivos principais desta entrega:
- `src/components/SecondaryTable.jsx`: filtros, seleção e composição da aba.
- `src/components/SecondaryChart.jsx`: gráfico evolutivo e escala dinâmica.
- `src/components/SecondaryWeeklyChart.jsx`: gráfico semanal novo.
- `src/utils/secondary.js`: agregações e métricas compartilhadas.
- `src/index.css`: layout responsivo, cards e acabamento visual.
- `test/secondary-summary.test.js`: testes das métricas e agregações.

Verificação ao fechar a implementação:
- `npm test`: 135 testes, 133 aprovados e 2 ignorados.
- `npm run build`: concluído com sucesso; permanece apenas o aviso conhecido de
  tamanho do bundle.
- `git diff --check`: sem erros de whitespace.

## Frente anterior: tabelas e navegação
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
- `68ea2b3` mantém Captação e Vencimentos no compacto (flag por modo)
- `546e78b` esconde Captação/Caixa/Vencimentos (feature-flag; refinado por `68ea2b3`)
- `154bb2b` Ativos: coluna/ordenação por Data de Registro CVM (não Emissão)
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

## Aba Ativos: ordenação por Data de Registro CVM
A coluna que era "Emis." (Data de Emissão) virou **"Reg. CVM"** (Data de Registro
CVM da Emissão) e é o default sort (desc). Motivo: a Data de Emissão é retroativa,
então debêntures registradas depois apareciam mais embaixo — "ordenar pela mais
nova" não mostrava as recém-publicadas. O campo `asset.emissao` foi **mantido
intacto** (alimenta o cronograma de fluxo/`parseAgenda` e o match dos books); a
coluna usa um campo NOVO `asset.registroCvm` (`src/utils/data.js`), com guarda
contra data futura (a fonte traz 1-2 registros com data errada, ex.: 2028).
Commit `154bb2b`.

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
- Confirmar visualmente o build publicado na Vercel do `68ea2b3` (código verificado
  limpo por medição/DOM; falta só o olho no deploy).

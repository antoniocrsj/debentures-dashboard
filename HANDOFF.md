# Handoff — debentures-dashboard (Luc)

Contexto para outro agente assumir. Atualizado em **ago/2026** (sessão Opus).

## Estado atual
- **Branch:** `main`, em sincronia com `origin/main`. Deploy automático na Vercel
  a cada push (~1 min): https://debentures-dashboard-three.vercel.app
- **Stack:** React 18 + Vite 5. Mobile-first; modo **desktop** é manual
  (localStorage `view-desktop=1` ou `?view=desktop`; exige `innerWidth ≥ 700`).
- Foco recente: **compacto (mobile)** — aba Técnico e cards de ativos.

## ⚠️ Regras duras (não quebrar)
- **Editor concorrente:** este repo tem um agente Codex + rotina diária mexendo
  em paralelo. **NUNCA `git add -A`.** Sempre `git fetch` + `git status` antes de
  commitar/pushar e **stage arquivo por arquivo**. Untracked como
  `.codex-remote-attachments/`, `outputs/`, `diag.mjs`, `sheet_auditoria.xlsx`,
  `colunas_oferta_resolucao_160.txt`, `prompt-resumo-do-dia.txt` **não são meus**.
- **Verificação no navegador:** dev server no ar em `:5173`. Screenshot do painel
  embutido costuma falhar ("pane not displayed") — verifique por **DOM/JS** (mcp
  Browser `javascript_tool`). Para foto de verdade use **Chrome headless**:
  `chrome --headless=new --window-size=375,860 --virtual-time-budget=9000 --screenshot=out.png http://localhost:5173`
  (375px = compacto; o headless NÃO clica, então só captura a aba inicial=Ativos).
  O pane às vezes NÃO obedece o resize p/ mobile (reporta 981px) — insista/reabra.
- **Paleta "Luc"** quente/terrosa: terracota `#8c5e3a`, carvão `#26211d`, bege.
  Verde `--c-verde` / vermelho `--c-vermelho`. Navy aposentada.

## O que foi feito nesta sessão (Opus, tudo no main)
1. **Emissões × Fundos (ANBIMA) no gráfico do Técnico** (`6f82f17`, `c718bc2`):
   o gráfico Emissões passou a ser **visão de MERCADO** (ANBIMA), barra empilhada
   com a parcela subscrita por **Fundos de Investimento** preenchida (total no
   topo). Fonte: Boletim de Mercado de Capitais (xlsx) → `tools/preparar-emissoes-anbima.mjs`
   lê aba `08-05` (subscritores, todos) + `09-06` (12.431) → `public/Emissoes_ANBIMA.csv`
   (`Mes,Total,Fundos,Total12431,Fundos12431`). **Reage ao toggle 12.431/Tradicional**
   (Tradicional = Total − 12.431). Boletim vai em `Anbima - Boletim/` (xlsx
   gitignored; README lá). Refresh mensal: dropar o boletim + `node tools/preparar-emissoes-anbima.mjs`.
   Ressalva: 1-2 meses recentes subestimam fundos (ofertas não encerradas).
2. **Drill-down do Emissões → tabela Ativos** (`3604d32`): clicar numa barra troca
   a tabela de gestores pela **tabela Ativos** filtrada pelas debêntures da base
   emitidas naquele mês (Registro CVM) e no segmento. Ordenação extraída p/
   `utils/sortAssets.js` (reusada por App + Técnico). No compacto/Emissões, a
   tabela já abre em Ativos (mês mais recente por padrão).
3. **Aba Técnico no COMPACTO** (`3fbee32`, `6b63322`, `8cda752`, `f9ac93d`,
   `36c5c8a`, `818ee75`, `5ef1067`, `7b024ec`): Técnico entrou no BottomNav; barra
   FIXA de gráficos acima do BottomNav (`.tecnico-chart-nav`: Captação/Vencim./
   Emissões/Caixa) mostra **1 gráfico + 1 tabela por vez**. Gráficos com altura
   igual (250px); tabelas com altura ÚNICA (`max-height: calc(100dvh - 545px)`,
   rolam por dentro) e **cabeçalho mais baixo**. **%Deb** foi pro canto sup.
   direito (bege), sem o duplicado do carvão. Título "Semanas/Meses" e "Atualizado
   em" escondidos p/ ganhar espaço. **Captação e Vencimentos escondidos do BottomNav**
   (`config/abas.js` `ABAS_OCULTAS_COMPACTO`) — o Técnico as cobre. Guardas
   `mostra(grafico)` no `TecnicoDashboard`; desktop = grid com tudo (inalterado).
4. **Carvão uniforme no compacto** (`4addbf5`): filtros (Grupo/Setor/Gestor/Ativo)
   e sub-abas (Ativos/Gestores/Grupos) da Debêntures saíram do carvão (sticky-area)
   p/ o **corpo bege** — o carvão (Header/Luc) fica do mesmo tamanho em todas as
   abas. Abas no corpo re-estilizadas (fundo transparente + texto escuro):
   `.app:not(.desktop) .content .tab-btn`.
5. **Ativos e Secundário como CARDS no compacto** (`78c12b0`, `d879663`, `0394506`,
   `ba4aabc`): no mobile a **tabela** vira **card** (`.asset-card`, 80px, 3 colunas
   com divisórias tracejadas). Layout do croqui do usuário:
   - Col1: ticker · emissor · data · vencimento.
   - Col2: taxa · **Tx Anbima com o selo ANBIMA** (`public/anbima-selo.jpg`, negrito) · Duration · BE (+data recompra).
   - Col3: R$ **destacado** (terracota).
   - **Ativos** (`AssetCards.jsx`, App.jsx `desktop ? AssetTable : AssetCards`): taxa de EMISSÃO; col3 = Vol. mercado + Alocação; data = Registro CVM.
   - **Secundário** (`SecondaryTable.jsx`, branch compacto): taxa **NEGOCIADA** (`taxaMed`); col3 = **Volume negociado** (`volumeRs`); data = data do TRADE. `enrichMercado` passou a copiar `txAnbima/recompra/registroCvm` do ativo.
   - Desktop segue com TABELA nos dois.
   - **⚠️ NÃO verificado ao vivo no mobile** (o pane não foi pro compacto nesta
     sessão) — CONFIRMAR no celular que o card do Secundário renderiza certo e
     ajustar se preciso.

## Pendências / próximos passos (o usuário está afinando o card, iterativo)
- Card: col3 (R$) talvez precise ficar mais forte (terracota é clarinho); o **selo
  ANBIMA só aparece quando o ativo tem `txAnbima`** — poucos têm na base.
- Secundário card: decidir data do trade (atual) vs Registro CVM; e se entra o
  **Spread ref** (hoje fora do card, mas é métrica-chave do Secundário).
- Memória do experimento: `~/.claude/.../memory/teste-ativos-cards-branch.md`.
- Técnico: coluna 2 da linha de baixo (sob o Caixa) segue vazia no desktop.
- PWA: após 1 ciclo do SW self-destruído, dá p/ remover o `vite-plugin-pwa` de vez.

## Baseline (sessões anteriores — Codex)
PWA desligado (SW self-destroying, `11e4f11`); Técnico desktop (grid Captação/
Caixa/Vencimentos + Emissões + tabela Semanas/Meses unificada com alternador);
seleção múltipla de tickers na Debêntures (`SelectAtivos`, `effectiveAssets`);
filtro 12.431 segmentado. Secundário = base **Mercado Verdadeiro** (`enrichMercado`,
`public/Mercado_Verdadeiro.csv`), com spread ref CDI+/NTN-B+.

## Como rodar / verificar
- Dev server em `:5173` (mcp Browser `preview_start`). Compacto = janela < 700px.
- `npm run build` valida compilação (o ruído `node.exe RemoteException` no
  PowerShell é só o Vite escrevendo no stderr — não é falha).
- Docs: `MODELO_TABELA.md`, `METODOLOGIA_Mercado_Verdadeiro.md`.

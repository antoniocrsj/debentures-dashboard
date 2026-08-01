# Handoff — debentures-dashboard (Luc)

Contexto para outro agente assumir. Atualizado em **ago/2026**.

## Estado atual
- **Branch:** `main`, em sincronia com `origin/main`. Deploy automático na Vercel
  a cada push (~1 min): https://debentures-dashboard-three.vercel.app
- **Stack:** React 18 + Vite 5. Mobile-first; modo **desktop** é manual
  (localStorage `view-desktop=1` ou `?view=desktop`; exige `innerWidth ≥ 700`).
- **Árvore de trabalho limpa** (só untracked de OUTRO editor — ver regra abaixo).

## ⚠️ Regras duras (não quebrar)
- **Editor concorrente:** este repo tem um agente Codex + rotina diária mexendo
  em paralelo. **NUNCA `git add -A`.** Sempre `git fetch` + `git status` antes de
  commitar/pushar e **stage arquivo por arquivo**. Untracked como
  `.codex-remote-attachments/`, `outputs/`, `diag.mjs`, `sheet_auditoria.xlsx`,
  `colunas_oferta_resolucao_160.txt`, `prompt-resumo-do-dia.txt` **não são meus**.
- **Verificação no navegador:** o dev server já costuma estar no ar em `:5173`.
  Abra com `?view=desktop` e **redimensione a janela p/ ≥700px** senão cai no
  compacto (a aba **Técnico é desktop-only**). Screenshot do painel embutido pode
  falhar ("pane not displayed") — verifique por **DOM/JS** (mcp Browser
  `javascript_tool`), que é confiável.
- **Erros de HMR são enganosos:** ao editar props entre 2 arquivos, o console
  buffera `X is not a function` do estado transitório. Confirme no **DOM ao vivo**
  (se renderiza a tabela/gráfico e não o ErrorBoundary, está OK) ou dê reload.
- **Paleta "Luc"** quente/terrosa: terracota `#8c5e3a`, carvão `#26211d`, bege.
  Verde `--c-verde` / vermelho `--c-vermelho`. Navy foi aposentada.

## O que foi feito nesta sessão (commits mais recentes → antigos)
1. **`11e4f11` PWA desligado (`selfDestroying`)** — o service worker (autoUpdate)
   causava "F5 várias vezes até aparecer o deploy". Agora um `sw.js`
   self-destroying desregistra o SW de quem tinha e limpa caches; atualização no
   1º F5. Config em `vite.config.js`. (Headers do Vercel já eram
   `must-revalidate` — não era cache HTTP.) Perde-se instalável/offline.
2. **Aba Técnico — gráfico Emissões** (`2d949c7`,`40956af`,`9930a3a`):
   novo card **Emissões** na coluna 3 da linha de baixo (sob o Vencimentos),
   `src/components/tecnico/EmissoesBars.jsx` (reusa classes `.venc-*`). Barra
   **branca com contorno terracota**. Série = soma de `volumeEmitido` dos assets
   por mês da **Data de Registro CVM** (`registroCvm`; a Data de Emissão é
   retrodatada), **6 meses pra trás**, valor em cima de cada barra. Segue o
   segmento (Trad/12.431); **não** filtra por gestor. `TecnicoDashboard` recebe
   `assets={allAssets}` (App.jsx). CSS: `.tecnico-emissoes-cell` em `grid-column:3`
   + `height:100%` (a `.tecnico-tables-row` usa `align-items:flex-start`, então o
   item precisa pedir a altura).
3. **Aba Técnico — tabela Semanas/Meses unificada** (`6789b42`,`67729c4`,
   `932bf45`,`4525ca1`): as 2 tabelas viraram UMA (coluna 1, sob a Captação) com
   alternador `[Semanas|Meses]` no canto do gráfico de Captação; **o gráfico de
   Captação também segue o alternador** (série semanal/mensal — `FluxoChart`
   ganhou prop `mode`; `toChartSeriesMensal` em `utils/fluxo.js`). Cabeçalhos
   `Cap.↑`(verde)/`Res.↓`(vermelho); números **sem R$**, com **1 casa só nos
   bilhões** (`fmtFluxoTab`/`fmtFluxoTabSigned`); 3 colunas de valor iguais.
4. **Aba Debêntures — seleção múltipla de tickers** (`9707e31`): clicar na linha
   NÃO filtra mais — **seleciona** (tabela fica cheia, linha destacada);
   Ctrl/Cmd/Shift+clique agrega. Botão "Ativos" virou multiselect com caixas
   (`src/components/SelectAtivos.jsx`). A seleção guia os 3 painéis (Vencimentos/
   Gestores/Grupos) e o **Total** da tabela (`effectiveAssets` no App.jsx).
   `filters.ativo` mantido só p/ o fallback `openTicker` (série-irmã fora da base).
5. **Filtro 12.431 segmentado** (`15d5594`): virou `[12.431|Tradicional]` igual ao
   do Secundário (`Filters.jsx`, `.seg-lei`).

## Como rodar / verificar
- Dev server via mcp Browser `preview_start {name:"deb-dashboard"}` (porta 5173).
  Se já estiver em uso, `preview_start {url:"http://localhost:5173/?view=desktop"}`.
- Modelo de tabela canônico e regras de layout: `MODELO_TABELA.md`.
- Metodologia do Secundário (Mercado Verdadeiro): `METODOLOGIA_Mercado_Verdadeiro.md`.

## Possíveis próximos passos (não iniciados)
- Coluna 2 da linha de baixo do Técnico (sob o Caixa) está **vazia de propósito**
  — há espaço se quiserem outro card.
- Emissões hoje é gráfico só; poderia ganhar toggle de unidade/janela se pedirem.
- Depois de 1 ciclo com o SW self-destruído, dá p/ remover o `vite-plugin-pwa`
  de vez (hoje só `selfDestroying: true`).

## Fora do repo — análise ANBIMA (sessão atual)
O usuário pediu análise do Excel `~/Downloads/Boletim_MK_Anexo_v1_a90b3c46da.xlsx`
(Boletim de Mercado de Capitais ANBIMA), abas de **Debêntures** (07/08) e
**12.431** (09), séries mensais jan/2020→jun/2026. Principais achados: mercado
dobrou 2022→2024/25 (271→493 bi), quebra regulatória em 2023 (ICVM/476 → RCVM/160
Rito Automático ≈99%), IPCA subindo (14%→36%), prazo médio 6,3→8,5a, infra na
destinação 14%→41%; **12.431 é o motor** (fatia 15%→36% do valor, ~46% das ops em
2025; prazo ~12–13a; ~90%+ infra; PF sumindo da primária). 1S2026 −12/−13% vs 1S2025.
Não há entregável commitado — foi análise em chat.

# Modelo de Tabela — padrão do dashboard

Referência viva (canônica) = a tabela de **Ativos** da aba Debêntures
(`AssetTable`, seletor `.asset-table`). Todas as tabelas desktop
(`.app.desktop`) das abas **Debêntures** e **Técnico** seguem este padrão.

Regra de ouro: **a tabela preenche o card de ponta a ponta**. O recuo do
conteúdo vem do padding das *células*, nunca de uma moldura (padding/margem) em
volta da tabela — foi exatamente essa moldura que criava a "margem" na Técnico.

---

## 1. Estrutura / container
- `<table class="asset-table">` com `border-collapse: separate; border-spacing: 0`
  (as bordas cabem *dentro* da altura da linha e habilitam o sticky).
- Vive dentro do card rolável `.table-wrap` (`overflow: auto`). O `.table-wrap`
  **não tem margem** (`margin: 0`) — a tabela encosta na borda do card.
- Card: fundo branco, `border-radius: 10px` (--radius), `overflow: hidden`
  (clipa os cantos). Sem `padding` no bloco em volta.
- Tabela: `width: max-content; min-width: 100%` (estica p/ preencher; rola no
  eixo X quando é mais larga que o card).

## 2. Cabeçalho — `thead th`
- Altura **26px**; `white-space: nowrap` (nunca quebra em 2 linhas).
- Fonte 11px (--fz-corpo); `padding: 0 var(--sp-2) 0 var(--sp-3)`.
- Fundo branco (--card); `position: sticky; top: 0`.
- Borda inferior 2px (--border).
- Se houver elemento interno (ex.: `SortableTh` com seta), achatar:
  `th > * { padding: 0; min-height: 0; line-height: 1.15 }` — senão o filho
  empurra o th p/ ~33px.

## 3. Linha de dados — `tbody td`
- Altura **20px**; fonte 11px; `line-height: 14px`.
- `padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3)`.
- Borda inferior 1px na própria linha (dentro dos 20px).
- Hover: fundo --primary-light. 1ª coluna congelável via `col-sticky`.

## 4. Linha de Total — `tfoot`
- Altura **20px**; peso 600.
- Fundo **branco**; borda superior **1px carvão** (--c-carvao); sem borda inferior.
- **Travada** no rodapé: `position: sticky; bottom: 0`. A coluna sticky também
  fica branca.
- Sempre presente (soma / agregado do período ou da seleção).

## 5. Rolagem — trava em LINHAS INTEIRAS
- Altura do scroller = **chrome + N×linha**, onde `chrome = thead(26) + tfoot(20) = 46px`:
  `height: calc(46px + round(down, (disponível − 46px), 20px))`.
  `round(down, …, 20px)` remove a fração de linha → a banda visível do tbody
  vira múltiplo exato de 20px e o Total encaixa na última linha **até no topo**
  da lista (scrollTop 0).
- Snap por linha: `scroll-snap-type: y mandatory` no scroller; linhas com
  `scroll-snap-align: end`; `scroll-padding-bottom: 20px`; `scroll-padding-top: 26px`.
- Resultado: a última linha encosta no Total em qualquer ponto de repouso da
  rolagem (gap ≈ 0), sem meia-linha flutuando.
- `round()` degrada bem: em navegador sem suporte a declaração cai e volta ao
  `max-height` anterior (fica só o snap).

## 6. Cores
- Cabeçalho branco; Total branco + borda carvão; **sem faixas de fundo**.
  Destaque só por peso/cor de texto (negrito, verde/vermelho), nunca fundo pintado.

## 7. Variante "ranking" (div, não `<table>`)
Os rankings (Gestor/Grupo) replicam o modelo com divs em vez de `<table>`:
- `.ranking-header` **26px**, `flex: none` (é item de flex-column que transborda;
  sem isso ele colapsa p/ ~16px).
- `.ranking-row` **20px**; `.ranking-total` **20px**, branco + borda carvão,
  **fora** do `.ranking-list` que rola (sempre visível).
- Painel de 8 linhas: altura fixa `= 26 + 8×20 + 20 = 206px`.

---

## Onde se aplica
| Aba | Tabelas |
|---|---|
| Debêntures | `AssetTable` (Ativos) · `ManagerRanking` · `GroupRanking` |
| Técnico | `TecnicoGestorTable` · `FluxoTable` (semanal) · `FluxoMonthlyTable` (mensal) |

A altura 26/20 vem da regra global `.app.desktop .asset-table th` / `td`; a
trava de rolagem e o `margin: 0` do `.table-wrap` são por tabela. As tabelas de
outras abas (Secundário, Caixa) herdam o 26 do cabeçalho, mas não estão no
escopo formal deste padrão.

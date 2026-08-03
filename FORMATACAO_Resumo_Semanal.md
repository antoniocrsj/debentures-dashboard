# Resumo Semanal do Luc — Formatação (v2)

> Regras de **forma/apresentação** do relatório semanal (gerado por `tools/relatorios/render-semanal.mjs`).
> É o par de **FORMA** do `METODOLOGIA_Resumo_Semanal.md` (que trata de conteúdo/cálculo). Deriva da
> identidade **"Luc"** e das regras do relatório de crédito A4 (`../Modelo_Analise_Credito_Apresentacao_Secoes.md`),
> **adaptadas à realidade deste deliverable** — não a copiam. Ao editar o template, seguir isto à risca:
> mesma paleta, mesma disciplina, mesma economia de negrito. O que muda entre semanas é o **dado**, nunca a **forma**.

---

## 0. O que este relatório É (e o que muda em relação ao A4 de crédito)

- É um **dashboard de mercado semanal** — **tela**, ~900px, responsivo. **Não** é o A4 de impressão do crédito.
- É a **foto do mercado**, não da carteira. Spread que abre/fecha é **fato de mercado neutro**, não ganho/perda
  "nosso" — ver §8. (Alinhado à regra: *"somos o mercado" = iliquidez, não titularidade*.)
- Estrutura **fixa**: 3 seções (**1. Debêntures · 2. Secundário · 3. Técnico**), cada uma no padrão
  **síntese → KPIs → detalhe**.
- **Vocabulário da casa:** "taxa" **significa spread**. Spread é sempre mostrado como o mercado fala
  (`CDI +X%`, `B35 −Xbps`, `IPCA+X,XX`), nunca a taxa nominal.

## 1. Paleta "Luc" (a mesma do crédito e do app — não introduzir cor nova)

| Papel | Token | Hex |
|---|---|---|
| Fundo da tela | `--bg` | `#f2ede5` |
| Cartão / seção (branco) | `--card` | `#ffffff` |
| Acento — h2, chip 12.431, teto, classificação | `--terra` | `#8c5e3a` |
| Sólido escuro — h1, texto | `--carvao` | `#26211d` |
| Bege — cabeçalho de tabela, tiles, bordas | `--bege` | `#e8dfd2` |
| **Linha de tabela (escurecida, jul/2026)** | `--linha` | `#d5c7b0` |
| Texto discreto (meta, sub, fontes) | `--muted` | `#7a6f63` |
| Positivo · Negativo (semântica) | `--pos` · `--neg` | `#047857` · `#b91c1c` |

- **Texto nunca em preto puro** — carvão `#26211d`.
- **Linhas de tabela escurecidas:** trocar o `border-bottom` de `--bege` (`#e8dfd2`, quase invisível) por
  `--linha` (`#d5c7b0`). Mesma disciplina do A4 (lá é `#d0c1a8`).

## 2. Escala de fonte — poucos tamanhos (px, porque é tela)

Consolidar para **5 tamanhos** (hoje o arquivo tem ~9 — cortar o excesso):

| px | Onde |
|--:|---|
| **20** | `h1` |
| **16** | `h2` (título de seção) |
| **14** | corpo · `h3`/`h4` (com cor/peso p/ hierarquia) · **número do KPI** (`.kpis b`) |
| **12.5** | tabelas · cards |
| **11** | descritivos: `.meta`, `.sub`, `.mini`, `.kpis span`, `.fontes`, chips `.tag*` |

(É o análogo screen da escala pt do A4 — mesma ideia de "só X tamanhos".)

## 3. Cantos: ângulos retos, com exceção dos destaques coloridos

Alinhar ao crédito (jul/2026):
- **Contêineres de dado → `border-radius: 0`**: `section`, KPI tiles (`.kpis > div`), `.card`, `.oferta`, tabelas.
- **Exceção (voltam a ser arredondados):** os **chips** `.tag`/`.tag2`/`.tag-warn` (pílula) e a **caixa `.alerta`**.
- É a única mudança visível frente ao arquivo atual, que arredonda tudo (10/8/4px). Dado = reto; destaque colorido = arredondado.

## 4. Estrutura de cada seção (ordem fixa)

1. `<h2>` numerado (`1. Debêntures`, `2. Secundário`, `3. Técnico`).
2. **Síntese** (`.sintese`, **2–4 bullets**) — a leitura de uma olhada. É o análogo da "abertura pelo rating" do A4:
   o takeaway vem **primeiro**.
3. **KPI tiles** (`.kpis`) — os números-chave da seção.
4. **Detalhe**: cards de oferta (§1), cards de tendência + tabela de trades (§2), cards de fluxo + destaques (§3).

## 5. KPI tiles (`.kpis`) — o "card" do semanal

- Cada tile: **número em destaque** (`b`, 14px, peso 600) + **rótulo muted** (`span`, 11px) embaixo.
- Fundo `--bege`, **ângulos retos**, `min-width` uniforme (~120px), flex-wrap.
- Valores em **mi/mil/bi** (ver §9); nunca número cru sem unidade.
- **Diferença importante frente ao A4:** aqui **tiles e chips PODEM ter fundo pintado** (bege/terracota) — é dashboard,
  não corpo de texto. A regra "destaque só em negrito, sem fundo" do A4 **não** se aplica aos tiles/chips (aplica-se ao
  texto corrido e às tabelas).

## 6. Tabelas (trades, fluxo, séries)

- **Sem borda lateral** — só réguas horizontais **escurecidas** (`--linha`).
- **Números à direita com `tabular-nums`** (classe `.num`); rótulos/textos à esquerda.
- **Negativos em vermelho** (`--neg`); em Δ e bps, **sinal explícito** (`+`/`−`).
- Cabeçalho bege (`--bege`), **negrito só no cabeçalho**.
- **Nenhuma célula vazia:** faltou dado → `—` (o gerador já faz isso). Nunca deixar em branco silencioso.
- Não usar zebra/stripes — manter limpo, como as tabelas do A4.

## 7. Chips / tags (funcionais e semânticos — não decorativos)

| Classe | Cor | Significa |
|---|---|---|
| `.tag` | terracota | **12.431** (incentivada) |
| `.tag2` | muted | **Tradicional** / **misto** |
| `.tag-warn` | vermelho (`--neg`) | **avisos** (amostra pequena, volume parcial) |

- Pílula (arredondada, exceção do §3), 11px, uso **funcional** (classificar 12.431 × Trad, sinalizar ressalva).
- Não criar chip novo sem função; não usar chip como enfeite.

## 8. Cor semântica — disciplina de mercado (regra dura)

- **Não editorializar direção de spread como "bom/ruim".** Abertura (widening) e fechamento (tightening) são
  **fatos de mercado neutros** — o rótulo de classificação vai em **terracota** (`.cls`), **nunca** verde/vermelho.
- **Vermelho (`--neg`) só para valor factualmente negativo:** captação líquida negativa, Δ negativo, resgate líquido.
  **Verde (`--pos`) com parcimônia** (entrada líquida positiva clara).
- **Motivo:** o relatório é a **foto do mercado**, não o P&L da casa — colorir abertura de vermelho sugeriria uma
  posição/perda que não existe. (Regra: a exposição em fundos é proxy do mercado, não book proprietário.)

## 9. Unidades, spreads e datas

- **mi / mil / bi** sempre nos valores em reais (função `money()`); **bps** para variação de spread; **%** para Δ;
  **"x"** para múltiplos.
- **Spread = "taxa" no vocabulário da casa.** Mostrar como o mercado cota: `CDI +2,50%`, `B35 −20bps`, `IPCA+7,52`,
  `DI −0,25%`. O "teto"/remuneração máxima da oferta (`.meta.teto`) fica com o número em **terracota** e o texto
  integral da escritura no `title` (tooltip) — manter.
- **Datas** `dd/mm/aaaa`.

## 10. Cabeçalho, alertas e rodapé

- **Cabeçalho:** `h1` (semana + intervalo) + `.sub` (status "Fechado · datas").
- **Alerta** (`.alerta`, caixa arredondada, âmbar) — **só para inconsistências reais** de dado (ex.: volume parcial,
  emissor sem grupo). Uso **parcimonioso**; não é caixa de destaque genérica.
- **Rodapé `.fontes`:** fontes + **data as-of de cada base** (`fluxo12431`, `fluxoTrad`, `anbima`, `mercado`,
  `debentures`). É o análogo da nota de rodapé do A4 — transparência de fonte e defasagem.

## 11. O que NÃO se transporta do A4 de crédito

- **Sem** Tabela Mestra, sem os 4 cards de crédito, sem abertura pelo rating (aqui a abertura é a **síntese** por seção).
- **Sem** folha branca sobre mesa bege — é dashboard **full-width responsivo** (`max-width` ~900px, colapsa p/ 1 coluna
  em ≤640px); **sem** `@page A4`.
- A regra "só negrito, sem fundo pintado" vale para **texto corrido e tabelas**; **tiles e chips têm fundo** (é a natureza do dashboard).

---

**Exemplo de referência:** o `resumo-da-semana-2026-W31` (com os ajustes acima: ângulos retos nos contêineres,
linhas escurecidas, 5 tamanhos de fonte, cor semântica disciplinada). **Não migrar semanas já publicadas** — vale da próxima em diante.

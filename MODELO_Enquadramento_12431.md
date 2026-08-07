# Modelo — Gráfico "Enquadramento 12.431" (aba Técnico)

Calcula, por fundo FI-Infra, **quanto ainda precisa comprar de debêntures 12.431**
para cumprir o enquadramento da Lei 12.431/2011 (com as regras da 14.801/2024),
projetado para **hoje, +6 meses e +12 meses**.

## Regra legal (resumo)
- Patrimônio de referência = `MIN(PL atual, média do PL dos últimos 180 dias)`.
- Percentual mínimo de ativos elegíveis (STEP, por idade desde a 1ª integralização):
  **carência até 6 meses** (0% exigido) → **67%** dos 6 aos 24 meses → **85%** a partir
  de 24 meses. `%exig = idade<6 ? 0 : idade<24 ? 0.67 : 0.85`.
- Compra necessária = `MAX(0, PL_ref × % − elegíveis)`.

## Reframe (por que projetamos)
A carteira (BLC/CDA) é defasada ~3-4 meses (mês **M**), mas o **PL foi observado até
~hoje**. Então ancoramos em **HOJE** e projetamos a necessidade de compra por 3
motores, **sem forecast**:

```
Compra(h) = MAX(0,  PL_ref(h) × %_exigido(h)  −  Elegíveis(h) )     h ∈ {0, 6, 12} meses após HOJE
                     └─ motor 3 ─┘  └─ motor 1 ─┘   └── motor 2 ──┘
```
- **Motor 1 — degrau da regra** (67%→85% ao cruzar 24 meses): `idade(HOJE)+h`. Determinístico.
- **Motor 2 — amortização da carteira**: as 12.431 do fundo amortizam pela agenda
  contratual (`Cronograma_Amortizacao.csv`). Determinístico.
- **Motor 3 — PL de referência**: **observado até hoje**, **constante depois** (premissa
  única, conservadora, explícita — nada de extrapolação).

## Foto de HOJE (o melhor de cada fonte)
- `PL_ref(hoje) = MIN(PL_hoje observado, média 180d)`. A **média 180d é DIÁRIA** (média
  da cota nos últimos 180 dias corridos, do Informe Diário da CVM), **não** a média de 6
  fotos de fim de mês — que engana: perde a variação intra-mês e pondera errado quem
  captou em datas específicas (ex.: PRODHOS −14%). Fonte: `preparar-pl-media180.mjs`.
- `Elegíveis(hoje) = carteira_M (BLC) rolada pela amortização contratual [M→hoje]`.
- `idade(hoje) = HOJE − 1ª cota` (1º mês com PL no CDA; **não** o registro CVM — ver abaixo).

## Fórmula da projeção (h = 0/6/12 meses após HOJE)
```
PL_ref(h)     = PL_ref(hoje)                                   # flat após hoje
%_exigido(h)  = (idade+h)<6 ? 0 : (idade+h)<24 ? 67% : 85%   # carência 6m
Elegíveis(h)  = Σ_posições  VL_ALOCADO_M × (1 − cumFrac(ticker, HOJE+h)) / (1 − cumFrac(ticker, M))
Compra(h)     = MAX(0, PL_ref(h) × %_exigido(h) − Elegíveis(h))
```
onde `cumFrac(t, d)` = fração acumulada do principal ORIGINAL amortizada do papel `t`
até a data `d` (de `Cronograma_Amortizacao.csv`). O fator `(1−cumFrac(h))/(1−cumFrac(M))`
é a fração da posição de M que ainda sobra em M+h.

## Universo
Os **mesmos fundos da seleção do app** (`tools/Fundos_12431.csv`) — na prática, os do
segmento `'12431'` em `Caixa_Potencial_Fundos.csv` que têm carteira no CDA (~1714).
Sem filtro novo; sem exclusão de feeder por conta própria (a seleção já é curada).
- Fundos da seleção sem CDA (~23): fora do cálculo (sem carteira p/ medir).
- **Idade pela 1ª COTA, não pelo registro CVM.** A idade (carência 6m + degrau 24m)
  parte do **1º mês em que o fundo tem PL no CDA** (proxy da 1ª integralização —
  "sem cota o fundo ainda não existe"). O registro CVM (`Fundos_Atributos.Data_Inicio`)
  antecede a 1ª cota em vários meses (306 fundos com ≥2m de gap) e envelhecia o fundo
  cedo demais, inflando o backlog. Só usa registro CVM como fallback. Efeito medido:
  backlog de mar/26 caiu de **4,12 → 1,11 bi (−73%)**. Fonte: `preparar-primeira-cota.mjs`.
- Fundos sem 1ª cota nem `Data_Inicio`: assume **<24m (67%)** e marca. Imaterial.

## Fontes de dado (todas já existem)
| Ingrediente | Arquivo | Campo |
|---|---|---|
| Carteira em M (mercado) | `public/BLC_PorFundo.csv` | `CNPJ_FUNDO_CLASSE, CD_ATIVO, VL_ALOCADO` |
| **Data de M (ref. do BLC)** | `public/BLC_maturidade.json` | `mesAno` (AAAAMM) — âncora do roll e início da série |
| Flag 12.431 | `public/Debentures.csv` | `Deb. Incent. (Lei 12.431)=S` (join por `Codigo do Ativo`) |
| Amortização por papel | `public/data/Cronograma_Amortizacao.csv` | `Ticker, Data, FracaoPct, Fonte` (vida inteira) |
| PL fresco (hoje) | `public/data/Perf_Diario_12431.csv` | `PL` diário |
| **Média 180d (diária)** | `public/data/Fundos_PL_Media180.csv` | `CNPJ, Ref, Media180` (Ref = AAAAMM ou HOJE; do Informe Diário) |
| PL p/ média (fallback) | `public/data/Caixa_Potencial_Fundos_Historico.csv` | `Mes, CNPJ, PL` (mensal — só se faltar informe) |
| Universo + PL carteira | `public/data/Caixa_Potencial_Fundos.csv` | `Segmento='12431', PL_Carteira` (MesBase **NÃO** é M — é ciclo mais novo, só p/ PL) |
| **1ª cota (idade)** | `public/data/Fundos_PrimeiraCota.csv` | `CNPJ, PrimeiraCotaData` (1º mês com PL no CDA) |
| Data início (fallback) | `public/data/Fundos_Atributos.csv` | `Data_Inicio` (registro CVM — só se faltar 1ª cota) |

## Saída do prep
`tools/preparar-enquadramento-12431.mjs` → `public/data/Enquadramento_12431.csv`
(1 linha/fundo) + meta. Colunas: `CNPJ, Fundo, Gestor, DataInicio, idadeMeses,
dataM, dataHoje, PL_hoje, PL_medio180, PL_ref, Eleg_hoje, Eleg_6m, Eleg_12m,
pctAtual, pctExig_hoje, pctExig_6m, pctExig_12m, Compra_hoje, Compra_6m, Compra_12m,
amortEstimada, semDataInicio`. Meta: `asOf, dataM, dataHoje, premissas, cobertura`.
Wire: passo isolado no `atualizar-tudo.ps1` (após BLC + Cronograma + Perf_Diario).

## App
- Hook `src/hooks/useEnquadramento12431.js` — carrega o CSV (por fundo) + o meta
  (com a `serieMensal`) sob demanda.
- **Layout (`.tecnico-enq-row`, ABAIXO do grid)**: DUAS colunas em flex — **ranking por
  gestora** sticky à esquerda (`enq-card-ranking`, 340px, `Gestora · 6m · 12m` ordenado por
  6m, rola por dentro; clicar filtra TODOS os gráficos) + **pilha de 5 gráficos**
  (`enq-charts-stack`) à direita, cada um `enq-chart` de **200px**, um abaixo do outro.
  **Todos no MESMO eixo x — spine `jan/24 → dez/27`** (`enumMonths`), rótulos inclinados,
  `interval={2}` — p/ leitura vertical alinhada. A metade **REAL** (jan/24 → mar/26=M) vem do
  `Demanda_Movel_12431.json`; a **projeção congelada** (M → dez/27) do `serieMensal`. Um único
  `charts` useMemo monta `data` alinhado ao spine, e cada gráfico lê seus campos.
- **1. Gap** — variação do **estoque do gap** (barra c/ sinal) + nível (linha). stock =
  Σ max(0, exigência×PL_ref − 12.431); `novo[i]=stock[i]−stock[i−1]` SEM `max(0,·)` → barra
  **negativa** (MUTED, "Redução do gap") quando o gap encolhe. Real (mes<M): `c0` do
  Demanda_Movel; projeção (mes≥M): `compra` do serieMensal. **Eixo Y duplo** (esq = fluxo;
  dir = nível, ~5x maior). KPI: "estoque hoje → … em dez/27".
- **2. PL Ref (Fim da Carência)** — PL_ref que **cruza um degrau no mês**: 6m (carência→67%,
  claro) + 24m (67%→85%, escuro), barras empilhadas. Real: `t6`/`t24` do Demanda_Movel;
  projeção: `trig6`/`trig24` do serieMensal. (Spike em jan/25 = coorte pré-2023, ver abaixo.)
- **3. PL Ref (Por Idade)** — 3 linhas do PL_ref por faixa: **0–6m** (carência), **6–24m**
  (67%), **>24m** (85%). Universo envelhecendo: 0–6m drena, >24m cresce até dominar (~255 bi).
  Real: `b1`/`b2`/`b3` do Demanda_Movel; projeção: idem do serieMensal.
- **Consistência histórico↔projeção no PL_ref (charts 1-3)**: as duas metades tinham degrau em
  mar/26 (ex.: 0–6m ~93 bi no histórico vs ~24 bi na projeção). Dois furos, corrigidos:
  (a) o histórico usava **média mensal** (6 fotos, superestima aporte recente); passou a usar a
  **média 180d diária** (`Fundos_PL_Media180`, mesma base da projeção — Informe Diário estendido
  a jan/24 dá refs mensais desde jun/24, fallback mensal antes); (b) fundos **sem 1ª cota**
  (23 fora do Caixa_Potencial, alguns de 27 bi) caíam em `idade=0`→0–6m com PL cheio; agora são
  **pulados** dos buckets/aniversário (a projeção nem os tem). Resultado: seam casa exato em mar/26
  (b1/b2/b3/t6/t24 idênticos nas duas metades).
- **4. Projeção Gap** — em cada mês-âncora, a compra necessária nos próximos **3/6/12m**
  (carteira real do mês, **sem amortização**) — indicador antecedente. Só há âncora real até
  **mar/26** (fim do CDA maduro); de abr/26 a dez/27 o eixo fica **vazio** (`connectNulls={false}`).
  Fonte: `preparar-demanda-movel-12431.mjs` (`c3`/`c6`/`c12` + `serieGestora`).
- **5. Captação líquida** — aportes − resgates por faixa de idade (0–6/6–24/>24m), barras
  **empilhadas com sinal** (`stackOffset="sign"`, negativas abaixo do zero). Fonte:
  `preparar-captacao-liquida-12431.mjs` (Informe Diário `CAPTC_DIA-RESG_DIA`) →
  `Captacao_Liquida_12431.json` (`cap1`/`cap2`/`cap3` + `serieGestora`). Informe Diário local
  cobre **jan/24 → ago/26** (32 meses; jan/24→jun/25 baixados em ago/26); só o futuro (set/26→
  dez/27) fica vazio, e o último mês pode ser parcial. Fluxo real, sem futuro. Com o piso de idade
  em jan/21 (backfill), o bucket >24m já aparece populado em 2024 (~0,4–1,9 bi/mês).
- **Idade da 1ª cota — piso jan/21 (backfill 2021-2022)**: a 1ª cota é o 1º mês com PL>0 no CDA.
  Antes o CDA local começava em **jan/23** → todo fundo pré-2023 era carimbado "jan/23" e cruzava
  24m **junto em jan/25** (torre falsa de R$46,6 bi em `t24`, e degrau no `b3`). Corrigido baixando
  o CDA HIST 2021-2022 (`backfill-pl-hist-cda.mjs`): o piso passou p/ **jan/21**, os cruzamentos se
  espalharam nos meses reais (jan/25 t24 caiu p/ ~R$0,07 bi; `b3` sobe suave de ~27 bi em jan/24).
  Fundos ainda mais velhos que jan/21 seguem no piso, mas cruzam 24m em **jan/23** — fora da janela
  dos gráficos (jan/24→). Reprodução: `backfill-pl-hist-cda.mjs` → `preparar-primeira-cota.mjs`.
- Nota geral: a projeção congela a carteira em M — a metade real (jan/24→M) já mostra a demanda
  verdadeira (sempre pequena, 0,4–1,2 bi/mês); de M em diante o congelamento superestima quem
  deploya capital depois de M (é um teto).
- **PL de referência da série é recalculado MÊS A MÊS** (`plRefNoMes`): a média 180d
  usada em cada mês é a trailing daquele mês, não a de hoje aplicada para trás.
  Sem isso, fundos que captaram há pouco apareceriam com backlog inflado — o aporte
  recente entra pouco na média 180d (é recente), então a exigência de 67% incide
  sobre um PL_ref ainda baixo. A demanda "amadurece" ao longo de ~6 meses conforme
  a média sobe. Meses ≥ hoje congelam no PL_ref de hoje (forward, sem forecast).
- Componente `src/components/tecnico/Enquadramento12431.jsx` — **ranking horizontal**
  (Recharts) da **Compra(horizonte)** em R$, desc, top ~20; **CONSOLIDADO POR GESTORA**
  por padrão (soma da compra dos fundos de cada gestora); **clicar numa barra abre a
  TABELA dos fundos** que a compõem (Fundo · Idade · %atual · Exigido · Compra;
  ordenada por compra; botão Fechar). Selecionar a gestora na tabela de gestores
  também abre essa tabela (sync). **Toggle 6m/12m**; header no padrão dos outros
  gráficos (label + `grafico-kpi` "N de M enquadrados · faltam R$ X"); barra terracota;
  rodapé de avisos.
- Plug no `TecnicoDashboard.jsx`: **linha própria ABAIXO do grid de cards** (largura
  cheia — fora do grid de 2 linhas da coluna), item no array `GRAFICOS` (id
  `enquadramento`), gate `mostra()`, reusa `gestorSel`.

## Rodapé de avisos (premissas / vieses)
- Elegíveis = **só debêntures 12.431** (não capta cotas de FI-Infra) → compra é **teto**.
- Carteira de M; **não vemos compras novas** desde então → teto.
- Amortização real (ANBIMA) na maioria; papéis sem agenda = aproximação (marcado).
- Projeção (h=0/6/12): PL **constante após hoje**. Série mensal: PL_ref **por mês**
  (média 180d trailing daquele mês) nos meses passados; congela no de hoje p/ frente.
- Média 180d = **diária** (Informe Diário; média das fotos mensais só como fallback); idade = 1ª cota (1º mês com PL no CDA), registro CVM só como fallback.

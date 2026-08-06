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
- `PL_ref(hoje) = MIN(PL_hoje observado, média 180d)` — PL real (diário até ~03/ago + mensal).
- `Elegíveis(hoje) = carteira_M (BLC) rolada pela amortização contratual [M→hoje]`.
- `idade(hoje) = HOJE − Data_Início`.

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
- Fundos sem `Data_Inicio` (~16, 0,2% do PL): assume **<24m (67%)** e marca. Imaterial.

## Fontes de dado (todas já existem)
| Ingrediente | Arquivo | Campo |
|---|---|---|
| Carteira em M (mercado) | `public/BLC_PorFundo.csv` | `CNPJ_FUNDO_CLASSE, CD_ATIVO, VL_ALOCADO` |
| **Data de M (ref. do BLC)** | `public/BLC_maturidade.json` | `mesAno` (AAAAMM) — âncora do roll e início da série |
| Flag 12.431 | `public/Debentures.csv` | `Deb. Incent. (Lei 12.431)=S` (join por `Codigo do Ativo`) |
| Amortização por papel | `public/data/Cronograma_Amortizacao.csv` | `Ticker, Data, FracaoPct, Fonte` (vida inteira) |
| PL fresco (hoje) | `public/data/Perf_Diario_12431.csv` | `PL` diário |
| PL p/ média 180d | `public/data/Caixa_Potencial_Fundos_Historico.csv` | `Mes, CNPJ, PL` (mensal) |
| Universo + PL carteira | `public/data/Caixa_Potencial_Fundos.csv` | `Segmento='12431', PL_Carteira` (MesBase **NÃO** é M — é ciclo mais novo, só p/ PL) |
| Data início | `public/data/Fundos_Atributos.csv` | `Data_Inicio` |

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
- **Dois gráficos distintos**: (1) ranking por gestora; (2) **demanda mensal** —
  barras = demanda NOVA por mês (fluxo) + linha do acumulado, do `serieMensal` no
  meta. Começa em **M+1** (o BLC é o mês FECHADO) e vai até dez/27 (21 meses).
  Clicar numa gestora filtra a tabela E o gráfico mensal (`serieMensalGestora`).
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
- Média 180d = proxy mensal; data início = registro CVM (≈ 1ª integralização).

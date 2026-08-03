# Resumo Semanal do Luc — Metodologia (v2)

O Resumo Semanal reproduz a organização das 3 abas principais do app:
**1. Debêntures · 2. Secundário · 3. Técnico**. Cada parte abre com uma síntese
curta e depois os dados detalhados. Fatos observados, indicadores calculados e
alertas de qualidade são separados.

Gerado por `tools/relatorios/semanal.mjs` (`buildSemanal`) + `render-semanal.mjs`
(HTML) e renderizado no app por `SemanalV2` em `ResumoDoDiaModal.jsx`. **O Resumo
do Dia (`gerar-relatorios.mjs`) e o Resumo do Mês (`buildPeriodo`) não são
alterados** — o Semanal diverge via `formato: 'v2'`.

## Regras gerais
- **Semana = ISO 8601** (segunda→domingo), a semana **dos dados** — não a data
  corrente nem o horário da atualização. Convenção de `src/utils/periods.js`.
- Períodos incompletos aparecem como **Parcial** (fronteira crítica não fechou a
  sexta). As datas de referência de cada fonte são exibidas.
- Bases com datas diferentes não são tratadas como sincronizadas.
- Reprodutível: mesma execução no mesmo dia → mesmo resultado quando as fontes
  não mudam (sem `Date.now()` no cálculo; a "data da fonte" de debêntures é capada
  na data de mercado mais recente para ignorar pré-registros futuros).
- Valores em R$ (padrão brasileiro); variações de spread em **bps**.
- Sem recomendações de investimento; sem rating (não existe na base — omitido).

## 1. Debêntures — novas emissões
- Seleção pela **Data de Registro CVM** dentro da semana ISO (nunca data de
  entrada na base nem data da atualização).
- **Dedup por OFERTA** (chave `CNPJ + Emissão`): a base é **por série** (cada
  ticker = uma série com sua própria `Quantidade Emitida × Valor Nominal na
  Emissão`), então o volume da oferta = **soma das séries** — sem dupla contagem.
  As séries ficam rastreáveis dentro de cada oferta.
- Se uma série vem **sem quantidade/valor**, a oferta é marcada `volumeParcial` e
  entra em **inconsistências** — o total não é fechado silenciosamente.
- Volume usa **só as debêntures registradas na CVM** (nunca o Boletim ANBIMA).
- Por oferta/série mostra-se todo campo disponível, **omitindo vazios**: emissor,
  grupo, setor, data de registro, volume, 12.431/tradicional, indexador, taxa de
  emissão, vencimento, duration (ANBIMA), garantia, amortização, recompra/breakeven
  (`Anbima_BE.csv`). **Rating não existe na base → não aparece.**

## 2. Secundário
### 2.1 Tendência de spread (por 12.431 e tradicional)
- Move por ativo = `spread(fim) − spread(antes)` em bps, usando o snapshot ANBIMA
  **imediatamente anterior ao início** da semana e o **último até o fim**. IPCA usa
  `spreadNtnbBps` (só se a mesma NTN-B nos dois snapshots); CDI usa
  `spreadCdiEquivalente`. Split pelo **enquadramento real** (flag `Deb. Incent.`).
- Métricas: mediana, média aparada (10%), n comparáveis, %/nº que abriram, fecharam,
  estáveis; maiores aberturas/fechamentos; trades com spread **acima/abaixo da taxa
  ANBIMA**; direção do **IDA** (confirma/diverge).
- **Classificação (regra explícita, testável)** por mediana `m` (bps) + amplitude
  `b = %abriu − %fechou`:
  - `n < 15` ou sem snapshot → **dados insuficientes** (não conclui);
  - `15 ≤ n < 40` → classifica com **"amostra pequena"**;
  - **Abertura**: `m ≥ 4` ou (`m ≥ 2` e `b ≥ +40`);
  - **Leve abertura**: `m ≥ 2` ou (`m ≥ 1` e `b ≥ +15`);
  - **Fechamento**: `m ≤ −4` ou (`m ≤ −2` e `b ≤ −40`);
  - **Leve fechamento**: `m ≤ −2` ou (`m ≤ −1` e `b ≤ −15`);
  - **Movimento misto**: `|m| ≤ 1` e `%abriu ≥ 30` e `%fechou ≥ 30`;
  - **Estabilidade**: caso contrário.
  Os números que justificam são sempre exibidos.
- **Calibração (provisória v1):** estudo de 2026-W28..W31 (snapshots 03/07→30/07).
  12.431 tem amostra sólida (~600 ativos/sem, mediana semanal ∈ [−1, +2] bps);
  tradicional só ~21 ativos/sem (→ "amostra pequena"). Limiares são versionados
  neste arquivo e em `TENDENCIA` (semanal.mjs) — recalibrar quando o histórico de
  snapshots crescer.

### 2.2 Trades em destaque e resumo
- Negócios (granularidade **asset-dia**, de `Mercado_Verdadeiro.csv` — já sem
  dupla contagem/direta) com volume ≥ **R$ 20 mi**, agrupados por **grupo
  econômico**: volume total, nº, ativos, maior negócio, datas, taxa negociada,
  spread de referência, diferença vs ANBIMA (quando comparável), 12.431/tradicional.
- Resumo semanal: volume total, nº de negócios, 12.431 vs tradicional, comparação
  com a semana anterior e com a **média de 4 semanas** (nominal e %).
- Volume negociado **não** é interpretado como compra ou venda (a base não
  identifica o lado econômico).

## 3. Técnico
- Dois blocos (**12.431** e **tradicional**), com **captação bruta, resgates,
  captação líquida** (de `Fluxo_Diario_*.csv`) e **volume de emissão registrado na
  CVM** (da Parte 1). **Sem** "volume subscrito por fundos" e **sem** Boletim ANBIMA.
- Cada indicador: valor da semana, semana anterior, Δ nominal, Δ% (quando a base
  permite), média de 4 semanas, dias úteis cobertos, data mais recente da fonte.
- Destaques de captação/resgate/líquida **por gestora**; destaques de volume
  emitido **por emissor/grupo/enquadramento** (nunca atribuindo emissão a gestora).

## Downloads e retenção
- HTML e JSON self-contained em `public/reports/weekly/<id>.{json,html}`; o HTML
  baixado traz as mesmas informações essenciais do app. Mantém os **5** semanais
  mais recentes.

## Limitações conhecidas (por falta de dado)
- **Rating**: ausente em todas as fontes → não exibido.
- **Histórico de snapshots ANBIMA curto** (podado): tendência por ativo confiável
  só para semanas recentes; fora disso → "dados insuficientes".
- **Tradicional (secundário)**: poucos papéis CDI com spread ANBIMA (~21/sem) →
  classificação marcada como "amostra pequena".
- **IDA IPCA/Infra**: nível de spread aproximado/regime (emitido como aproximação).
- **Trades**: granularidade asset-dia (não ticket individual) — é a base limpa do
  secundário; grupo sem CNPJ no cadastro cai no nome do emissor.

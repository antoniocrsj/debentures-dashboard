# Metodologia — Mercado Verdadeiro (trade-a-trade de debêntures)

> Separar, no tape trade-a-trade da B3, o que é **negócio de mercado** (descoberta
> de preço) do que é **direta** (transferência entre fundos da mesma gestora) e do
> **double-count** estrutural do balcão — e daí extrair **volume real, taxa e spread
> (CDI+ / NTN-B+)** por ativo/dia. Construído em jul/2026.

> **⚠️ RECALIBRAÇÃO (jul/2026) — parâmetros atuais** (substituem o texto histórico abaixo):
> - **Chave = data de LIQUIDAÇÃO** (era data do trade): pernas T+1 e T+0 que liquidam
>   no mesmo dia entram no mesmo bucket (`gruposPorLiquidacao`).
> - **Banda de fee = [0,7 bps, 2,3 bps] × duration** (era [1, 2]): o fee real de ~2bps
>   na taxa vira ~3,08bps de variação de PU e escapava por arredondamento; a folga
>   captura esses pares.
> - **Sem relevância mínima** (o filtro de ≥10 MM saiu): todo ativo-dia entra.
> - Motivo: reconciliar o mercado tradicional com a referência de **R$ 150–500 MM/dia**
>   (a régua antiga dava ~126 MM; a nova ~277 MM). O CSV grava só linhas com
>   `VolMercado>0` e só as 10 colunas que o app usa.

---

## 1. Motivação

A base que o painel usava no Secundário (REUNE/ANBIMA) é **consolidada e fim de
dia**, e informa volume apenas por **faixa** ("Até 1MM", "Entre 1MM e 5MM",
"Superior a 5MM") — a faixa aberta esconde de R$ 5 MM a > R$ 1 bilhão. Faltava
**granularidade de volume** e um jeito de isolar **preço/spread verdadeiros**.

A B3 publica um tape **negócio a negócio** que resolve isso — se soubermos ler.

---

## 2. Fonte de dados — BDI "Negócio a Negócio" (tabela 528)

- Portal **BDI / DATA VISUALIZATION** da B3: `arquivos.b3.com.br/bdi` (SPA Angular;
  a página "Boletim Diário do Mercado" é só a capa via iframe). API pública, **sem auth**,
  histórico desde **2022-01-01**, atualiza a cada 15 min (D+0, ajuste em D+1).
- Rota de dados (POST; corpo `{}` = sem filtro; `take` máx = 1000):
  ```
  POST https://arquivos.b3.com.br/bdi/table/Trade/{dini}/{dfim}/{pagina}/{take}
  Content-Type: application/json     Body: {}
  ```
- Calendário de pregões: `GET /bdi/table/workdays?date=<hoje>&hasHistory=true`.
- Colunas por negócio: Data, Instrumento (filtrar **DEB**), Emissor, **Código IF**
  (mesmo ticker do REUNE), Qtd, Preço, **Volume R$** (= Preço×Qtd), **Taxa**, Origem
  (`Pre-registro - Voice` = corretora / `Registro` = bloco), Horário, **Cód. do negócio**,
  **ISIN**, Data liquidação, Situação. **Não há coluna de lado (compra/venda)** — a B3
  anonimiza a ponta; o pareamento é inferido.

Volume real: **~5–13 mil negócios DEB/pregão, R$ 2–5 bi/dia, ~700–850 ativos**.

---

## 3. Os fatos (modelo de microestrutura do balcão)

1. **Tudo é dobrado.** Todo negócio econômico gera **2 boletas** (comprador +
   vendedor), ambas registradas — mesmo ativo, mesma quantidade.
2. **Direta ⇒ mesmo PU.** Fundo↔fundo da **mesma gestora**, sem broker: as duas
   boletas saem no **mesmo PU** (ΔPU = 0). Não é descoberta de preço.
3. **Mercado ⇒ PUs diferentes.** Com broker, as pontas saem em PUs diferentes; a
   diferença é o **fee do broker ≈ 2 bps × duration** (em preço). A taxa real do
   negócio é o **meio** das duas pontas.

> **O horário é ignorado** — por experiência de mercado, é variável não confiável
> (registro em lote, atrasos). O pareamento usa **PU, duration e quantidade**.

---

## 4. Algoritmo — varredura gulosa por PU

Por **ativo × pregão**:

1. **Relevância.** Se a soma **dobrada** do dia `< R$ 10 MM` → descarta (irrelevante;
   10 MM dobrado ≈ 5 MM econômico).
2. **Grupos por PU.** Agrega as boletas por PU (4 casas) — tira o tempo da jogada.
   Cada PU carrega quantidade, volume e taxa média.
3. **Duration → fee.** `fee ∈ [1 bp × D, 2 bps × D]` (fração do PU). `D` = duration
   ANBIMA (`durationAnbimaAnos`); **sem ANBIMA** → `D = 0,70 × (anos até o vencimento)`.
4. **Varredura (do PU mais baixo pra cima).** Para o menor PU com saldo, procura a
   contraparte em `PU × (1 + fee)`, dentro da banda; **preenche o par até a quantidade
   do leg baixo** (puxando de 1+ alvos na banda); a quantidade casada vira **negócio de
   mercado** e **some** dos grupos. Repete até esvaziar.
5. **Sobra.** O que não acha contraparte a `+fee` (ex.: dois blocos iguais no mesmo
   PU) = **direta/órfão** → fora da base de mercado.

Saída por par de mercado: **volume = 1 perna** (`qtd × PU_mid`); **PU_mid** e
**taxa_mid** = meio das pontas (tira o fee dos dois lados).

---

## 5. Spread (CDI+ / NTN-B+)

Sobre a `taxa_mid` (mesma metodologia do app, `src/utils/spreadRef.js`):

- **DI_SPREAD → CDI+**: a taxa negociada já **é** o spread → `CDI + X,XX%`.
- **IPCA_SPREAD → NTN-B+ (bps)**: `bps = (taxa_mid − yield_NTN-B_ref) × 100`, onde a
  **NTN-B de referência é a que a ANBIMA DESIGNA** (`codigoNtnbExibicao` /
  `ntnbReferencia`, escolhida pela **duration**, não pelo vencimento do papel), com o
  yield desse ponto na **curva TPF do dia** (`REUNE_Curvas.csv`). Sem ANBIMA →
  fallback pela NTN-B de vencimento mais próximo. Rótulo `B{AA} ± N bps`.
  - Curva ausente no dia → usa a curva do último pregão anterior (sinalizado).

**Validação:** VBBRA0 vence em 2036 mas a ANBIMA referencia **B33** (duration 5,74a);
usando a NTN-B do vencimento (B35) o spread saía +16 bps — com a referência correta
(B33) sai **+5 bps**, batendo com o `spreadNtnbBps` da ANBIMA (+6 bps).

---

## 6. Pipeline e arquivos

| Script | Faz | Entrada | Saída |
|---|---|---|---|
| `tools/preparar-bdi-negocios.mjs` | Puxa o tape DEB (90 pregões), incremental | API BDI | `public/bdi/DEB_AAAA-MM-DD.csv.gz` + `index.json` |
| `tools/varredura-mercado.mjs` | Gera a base mercado (vol+taxa+spread) | `public/bdi/`, `Anbima_Tx.csv`, `Debentures.csv`, `REUNE_Curvas.csv` | `public/Mercado_Verdadeiro.csv` + `_meta.json` |
| `tools/lupa-mercado.mjs` | Inspeciona os últimos N pregões (ranking + zoom por ativo) | idem | terminal |
| `tools/cruzar-reune-bdi.mjs` | Cruza REUNE×BDI (valida PU, anexa volume real) | `REUNE_Historico.csv`, `public/bdi/` | CSV de cruzamento |
| `tools/lib-mercado.mjs` | **Núcleo compartilhado** (varredura, duration, spread, curva) | — | — (import) |

Rodar: `node tools/preparar-bdi-negocios.mjs [dias]` → `node tools/varredura-mercado.mjs`
→ `node tools/lupa-mercado.mjs 5 [TICKER]`.

Colunas de `Mercado_Verdadeiro.csv`: Data, Ativo, Indexador, DurationAnos, FonteDur,
VolMercado, nNegMercado, PU_mid, Taxa_mid, RefSpread, Spread, SpreadFmt,
VolDobradoTotal, VolSobraDobrada, PctMercadoEcon.

---

## 7. Parâmetros calibrados (jul/2026)

| Parâmetro | Valor | Decisão |
|---|---|---|
| Chave (bucket) | **data de LIQUIDAÇÃO** (jul/2026; era trade) | usuário |
| Relevância | **removida** (jul/2026; era ≥ R$ 10 MM/ativo/dia) | usuário |
| Banda de fee | **[0,7 bps, 2,3 bps] × duration** (jul/2026; era [1, 2]) | usuário |
| Duration | ANBIMA; fallback **0,70 × prazo** | usuário |
| Agrupamento de PU | 4 casas decimais | — |
| Pareamento | por PU+duration+qtd; **horário ignorado** | usuário |

---

## 8. Resultados (90 pregões, 18/03–27/07/2026)

- **7.718** ativos-dia relevantes (≥10 MM dobrado); **2.848** com negócio de mercado
  (e spread); os demais são **100% direta**; 11 sem duration.
- **Mercado ≈ 20% do volume econômico**; **~80% é direta/órfão**. (O denominador
  inclui os ativos 100% direta — excluí-los inflava o número para ~44%.) Nos últimos
  pregões o mercado fica em ~8–31%/dia. Distribuição por ativo é bimodal.
- Cruzamento REUNE×BDI: `PU_Medio` do REUNE = VWAP do BDI (Δ mediano **0,00%**) →
  as bases se confirmam; o volume do BDI é o volume real por trás de cada linha do REUNE.

---

## 9. Limitações e cuidados

- **Sem lado (compra/venda)** no tape → pareamento é inferido; colisão de PU/qtd é
  resolvida por proximidade do fee-alvo (guloso, do PU mais baixo).
- **Banda apertada → a "sobra" mistura direta + mercado com fee fora de [1,2]bps×D.**
  Os 44% de mercado são um **piso**; nos casos recentes os fees se empilham no teto
  (~2bps×D), sugerindo que alargar o teto recuperaria mercado hoje marcado como direta.
- **Duration ANBIMA é snapshot** (24/07) aplicado a todos os dias — deriva pouca em 90d.
- **Curva TPF** vai até o penúltimo pregão; o último usa a curva anterior (sinalizado).
- **Ativos fora do `Anbima_Tx`** ficam sem spread (sem indexador/ref) — resolver
  enriquecendo o cadastro.

---

## 10. Próximos passos

- Testar o **teto da banda** (2 → 2,5 → 3 bps×duration) e medir quanto de "direta"
  vira mercado.
- Enriquecer o cadastro para sumir os `--` de spread.
- Plugar `Mercado_Verdadeiro.csv` no Secundário (volume real + spread verdadeiro,
  substituindo a faixa do REUNE; visão intraday por ativo).
- Automatizar `preparar-bdi-negocios` + `varredura-mercado` no pipeline diário.

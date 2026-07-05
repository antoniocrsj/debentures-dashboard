# 🧭 Roadmap — BI Crédito Privado (debentures-dashboard)

Documento-bússola do projeto. Define um **vocabulário comum** (os nomes das tabelas)
e um **backlog priorizado** por complexidade, custo e relevância. É um documento
**vivo**: atualizado a cada decisão.

> **Como ler a priorização.** Cada item recebe três notas — **Complexidade**,
> **Custo** e **Relevância** (Baixa / Média / Alta). Regra de ordenação: *alta
> relevância com baixo esforço vem primeiro*; itens **fundacionais** (que destravam
> outros) vêm antes dos que dependem deles.

> **Convenção de IDs.** `GER-*` = geral (app todo) · `DEB-*` = seção Debêntures ·
> `CAP-*` = seção Captação.

---

## 1. Glossário de tabelas

O app tem **duas seções**: **Debêntures** e **Captação**. Cada tabela recebe um
**código curto** (para comandos diretos) e um **nome canônico**.

### Seção Debêntures
| Código | Nome | Componente | Colunas hoje |
|--------|------|------------|--------------|
| **D1** | Ativos | `src/components/AssetTable.jsx` | Ativo · Emis. · Venc. · Taxa · Tx Anbima · Duration · Vol. emit. · Alocação · (i) |
| **D2** | Gestores (Debêntures) | `src/components/ManagerRanking.jsx` | # · Gestor · Alocação · PL |
| **D3** | Grupos | `src/components/GroupRanking.jsx` | # · Grupo Econômico · Alocação |

### Seção Mercado Secundário
| Código | Nome | Componente | Colunas hoje |
|--------|------|------------|--------------|
| **M1** | Negociações | *(a criar)* | Data · Ativo · PU · Quantidade · Volume · Contraparte |
| **M2** | Evolução de Preço | *(a criar)* | Gráfico de linha: PU ao longo do tempo por ativo |

### Seção Captação
| Código | Nome | Componente | Colunas hoje |
|--------|------|------------|--------------|
| **C1** | Gestores (Captação) | `src/components/fluxo/GestorFlowRanking.jsx` | Gestor · Cap. Líquida · Captação · Resgate |
| **C2** | Semanas | `src/components/fluxo/FluxoTable.jsx` | Semana · Cap. Líquida · Captação · Resgate |
| **C3** | Meses | `src/components/fluxo/FluxoMonthlyTable.jsx` | Mês · Cap. Líquida · Captação · Resgate |

> **Uso:** *"adiciona coluna X na **C1**"* ou *"ordena a **C3** por Captação"*.
> A janela aberta pelo ícone **(i)** na **D1** é chamada de **Modal do Ativo**.
> Tabelas da seção Mercado Secundário: *"filtra a **M1** por ativo"* ou *"gráfico **M2** do PETR21"*.

---

## 2. Backlog priorizado

| ID | Item | Seção | Compl. | Custo | Relev. | Fase |
|----|------|-------|:------:|:-----:|:------:|------|
| **GER-1** | Nomear todas as tabelas (este glossário) | Geral | Baixa | Baixo | Alta | ✅ Concluído |
| **CAP-3** | Coluna **PL** na **C1** (Gestores da Captação) | Captação | Baixa | Baixo | Média | ✅ Concluído |
| **GER-2** | Navegação por **ícones** entre seções no app compacto | Geral | Média | Baixo–Médio | Média–Alta | ✅ Concluído |
| **GER-3** | Painel de controle da atualização (dev) + resumo no header | Geral | Alta | Médio–Alto | Média–Alta | ✅ Concluído |
| **DEB-1** | Enriquecer o **Modal do Ativo** (janela (i)) | Debêntures | Baixa–Média | Baixo | Média–Alta | ⏸️ Pausado |
| **CAP-1** | **Performance** dos fundos (rentabilidade %CDI por gestor) | Captação | Alta | Médio–Alto | Alta | ✅ Concluído |
| **CAP-2** | Regra de seleção do universo de fundos via dados **CVM** | Captação | Alta | Alto | Alta | 🔵 Fase 2 (fundacional) |
| **MER-1** | **Mercado Secundário** — ingestão de dados de negociação | Mercado Sec. | Alta | Médio–Alto | Alta | 🟡 A definir |
| **MER-2** | **Evolução de preço** — gráfico de PU por ativo | Mercado Sec. | Média | Médio | Alta | 🟡 A definir (depende de MER-1) |

**Lógica da ordem**
- **CAP-3, DEB-1 e GER-2** são entregas de **Fase 1**: alto valor percebido, baixo
  risco e sem dependências de dados novos. CAP-3 em especial é quase imediato (o dado
  de PL já é calculado).
- **CAP-1** acabou saindo antes de CAP-2: em vez de esperar a regra de seleção via
  CVM, reaproveitou o universo de fundos já curado manualmente (`Fundos_12431.csv`/
  `Fundos_CDI.csv`) e o Informe Diário da CVM que a Captação já baixava (passou a
  ler também `VL_QUOTA`, não só PL/captação/resgate).
- **CAP-2** continua **fundacional** e em aberto: automatizar a seleção do universo
  de fundos via dados CVM, hoje ainda mantida manualmente.

---

## 3. Detalhamento dos itens

### GER-1 · Nomear as tabelas — ✅ Concluído
Glossário na seção 1. Base para todos os comandos e para este roadmap.

---

### CAP-3 · Coluna PL na C1 (Gestores da Captação) — ✅ Concluído
**O quê:** exibir o Patrimônio Líquido por gestor na tabela **C1**, como já existe na **D2**.

**Estado atual:** `aggregateByGestor` (em `src/utils/fluxo.js`) já calcula:
- `plRecente` — PL total do gestor na semana mais recente do período;
- `plTotalMedio` — média, no tempo, do PL total semanal do gestor.

Falta apenas exibir: adicionar a coluna em `GestorFlowRanking.jsx` (cabeçalho
`SortableTh` + chave de ordenação + célula + formatação).

- **Complexidade:** Baixa · **Custo:** Baixo · **Relevância:** Média
- **Risco:** baixo (nenhuma fonte de dados nova).
- **Decidido:** usa **PL recente** (PL na semana mais recente do período) e a coluna
  ficou como **última** da tabela, à direita do Resgate.

---

### DEB-1 · Enriquecer o Modal do Ativo (janela (i)) — ⏸️ Pausado
**O quê:** ampliar e organizar melhor as informações exibidas na janela aberta pelo
ícone **(i)** de cada debênture na **D1**. Hoje o modal mostra: Emissor (emissor,
grupo, setor), Características (emissão, vencimento, indexador, taxa, Lei 12.431,
garantia, coordenador líder), Posição (volume emitido, alocação BLC), descrição e o
botão **Ver na ANBIMA** (recém-adicionado).

**Direções possíveis** (a confirmar): mais campos da base ANBIMA (% do CDI original,
spread/NTN-B de referência, PU), rating, série/emissão, datas de eventos (próximo
pagamento/repactuação), liquidez, etc.

- **Complexidade:** Baixa–Média (depende de quais campos e da disponibilidade do dado)
- **Custo:** Baixo · **Relevância:** Média–Alta
- **🟡 A definir:** **quais informações** entram (lista priorizada) e quais já existem
  na base atual vs. exigem nova fonte.

---

### GER-2 · Navegação por ícones entre seções (app compacto) — ✅ Concluído
**O quê:** no **app compacto (mobile)**, criar uma navegação de **seção** por ícones,
posicionada **no topo, ao lado do título "BI - Crédito Privado"**. Dois botões —
**Debêntures** e **Captação** — alternam entre as duas seções. O botão **Captação**
sai da posição atual (na faixa de abas) e sobe para junto do título, agora
acompanhado de um botão **Debêntures**.

**Referência visual:** ícones **redondos, minimalistas, de traço (line icons)
monocromáticos**, no estilo da barra superior do app de referência enviado (BEON) —
adaptados à identidade do nosso app.

- **Complexidade:** Média (reorganiza o cabeçalho/abas no compacto e cria os ícones)
- **Custo:** Baixo–Médio · **Relevância:** Média–Alta (clareza de navegação no mobile,
  que é o uso principal)
- **Decidido:**
  - Ícones: **Debêntures = documento/título**; **Captação = fluxo entra/sai** (line icons).
  - As **sub-abas de Debêntures** (Ativos / Gestores / Grupos) aparecem logo abaixo,
    só quando a seção Debêntures está ativa; o app lembra a última sub-aba usada.
  - Ícone da seção atual fica **preenchido**; o outro, em **contorno**. Desktop inalterado.

---

### GER-3 · Painel de controle da atualização + resumo no header — ✅ Concluído
**O quê:** melhorar a experiência de atualizar os dados (antes: só `.bat`s no
Windows + relatório de texto no console, sem nada visível no app publicado).

**Decidido e entregue:**
- **Painel local** (`src/components/ControlPanel.jsx`) — só existe/funciona
  rodando `npm run dev` no notebook do operador (nunca no build de produção:
  `import.meta.env.DEV` é eliminado pelo Rollup no build; nunca alcançável do
  site publicado por CORS/mixed-content mesmo que existisse). Ícone próprio no
  header (visível só em dev). Escolha de modo da Captação
  (Auto/Incremental/Completa — novo `-CaptacaoModo` em `atualizar-tudo.ps1`),
  log ao vivo via SSE (rota dev-only em `vite.config.js`, mesmo padrão do
  proxy GAS já existente), botões explícitos pra fundos (ver sugestão/aplicar)
  e publicar (em vez de pilotar os `Read-Host` interativos do script via
  stdin — mais simples e robusto).
- **Resumo publicado** (`public/Atualizacao_Resumo.json`, escrito por
  `atualizar-tudo.ps1`) — vai junto no `git add public/`, então aparece no app
  publicado também: novo ícone no header (visível em desktop **e** compacto,
  não é uma seção de navegação) abre um modal com o que rodou e os principais
  números antes→depois. Opcional/não-bloqueante — some sozinho se o arquivo
  não existir ainda.

---

### CAP-2 · Regra de seleção do universo de fundos (dados CVM) — 🔵 fundacional
**O quê:** hoje a lista de fundos da Captação reflete uma base própria. A meta é
**construir uma regra reprodutível** que selecione os fundos representativos da
indústria a partir de **dados públicos da CVM** (e classificação ANBIMA), para a
Captação refletir o mercado de forma fidedigna.

**Blocos de trabalho**
1. **Ingestão CVM:** baixar e normalizar as bases públicas (cadastro de fundos +
   informe diário / PL / classe). Definir periodicidade de atualização.
2. **Algoritmo de seleção:** critérios objetivos (classe/categoria, condomínio aberto,
   PL mínimo, excluir exclusivos/FIC, foco em crédito privado…) → produz a lista final.
3. **Integração:** alimentar a Captação com o universo selecionado e documentar a regra.

- **Complexidade:** Alta · **Custo:** Alto · **Relevância:** Alta
- **Nota:** CAP-1 (rentabilidade) já foi entregue sem esperar por este item, reaproveitando
  o universo curado manualmente (`tools/Fundos_12431.csv`/`Fundos_CDI.csv`). Quando CAP-2
  existir, o pipeline de rentabilidade passa a reaproveitá-lo — não é um bloqueador.
- **🟡 A definir (depende da sua visão de negócio):**
  - Qual é a **definição de "indústria"**? (crédito privado? high grade? todos os
    fundos abertos com PL ≥ X?)
  - **Critérios de corte** (PL mínimo, classe ANBIMA, excluir exclusivos/FIC…).
  - **Frequência** de atualização da base CVM (diária? semanal? mensal?).

---

### MER-1 · Ingestão de dados de negociação — 🟡 A definir

**O quê:** criar um pipeline para receber e normalizar dados de negociação do **mercado secundário de debêntures**. Cada negócio registrado (PU, quantidade, data, contraparte) alimenta a nova seção do app.

**Blocos de trabalho**
1. **Fonte de dados:** definir de onde vêm os dados (upload manual de arquivo, API pública como CETIP/B3, ou extração de relatório). Definir periodicidade (diária, sob demanda).
2. **Formato e normalização:** padronizar os campos (ticker, data de negociação, PU, quantidade, volume financeiro, tipo de contraparte) e vinculá-los à base de debêntures existente pelo código do ativo.
3. **Exibição tabular (M1):** tabela de negociações com filtro por ativo, período e contraparte.

- **Complexidade:** Alta · **Custo:** Médio–Alto · **Relevância:** Alta
- **Destrava:** MER-2 (gráfico de evolução de preço).
- **🟡 A definir:**
  - **Fonte dos dados:** upload manual (CSV/Excel), API pública (B3/CETIP) ou outro?
  - **Campos disponíveis:** quais colunas existem no arquivo de negociação?
  - **Periodicidade:** atualização diária automática ou manual por período?
  - **Cobertura:** todos os ativos da carteira, ou todos os negociados no mercado?

---

### MER-2 · Gráfico de evolução de preço — 🟡 A definir

**O quê:** a partir dos dados de negociação (MER-1), exibir a **evolução do PU unitário** de cada ativo ao longo do tempo em um **gráfico de linha**. Permite acompanhar a trajetória de preço de uma debênture e identificar tendências.

**Direções possíveis:** gráfico por ativo (selecionado via filtro ou clicando na D1), múltiplos ativos sobrepostos para comparação, linha de benchmark (CDI ou NTN-B de referência), indicação de eventos relevantes (pagamento de cupom, repactuação).

- **Complexidade:** Média · **Custo:** Médio · **Relevância:** Alta
- **Depende de:** MER-1 (pipeline de negociações).
- **🟡 A definir:**
  - **Eixo Y:** PU absoluto, variação percentual, ou spread sobre benchmark?
  - **Seleção de ativo:** filtro global, clique na tabela D1, ou entrada livre no gráfico?
  - **Múltiplos ativos:** exibir um por vez ou permitir comparação lado a lado?
  - **Onde exibir:** nova seção do app (terceira aba/seção) ou integrada ao Modal do Ativo (DEB-1)?

---

### CAP-1 · Performance dos fundos — ✅ Concluído
**O quê:** trazer a **rentabilidade** dos fundos para a Captação (antes só havia fluxo:
captação / resgate / cap. líquida e PL).

**Decidido e entregue:**
- **Métrica:** **%CDI** (retorno da cota comparado ao CDI do mesmo intervalo), não o
  retorno bruto isolado.
- **Cálculo:** retorno diário da cota ponderado pelo **PL** dos fundos de cada gestor
  (`Σ(PL_dia_anterior × retorno_fundo) / Σ(PL_dia_anterior)`), encadeado nas janelas
  **1s / 1m / 3m / 6m / 12m** (mesmas do filtro de período), comparado ao CDI (API do
  Banco Central, SGS série 12).
- **Granularidade:** por **gestor** (não por fundo individual).
- **Onde exibe:** 5 colunas novas, ordenáveis, na tabela **C1** (Ranking de Gestores) —
  `GestorFlowRanking.jsx`. Verde quando supera 100% do CDI, vermelho quando negativo.
  Semanas (C2) e Meses (C3) não foram alteradas.
- **Fonte:** reaproveita o Informe Diário da CVM que a Captação já baixava (passou a
  ler também `VL_QUOTA`, além de PL/captação/resgate) e o universo de fundos já
  curado manualmente (`tools/Fundos_12431.csv`/`Fundos_CDI.csv`) — não esperou por CAP-2.
- **Limitação conhecida:** a base de rentabilidade não é mesclada entre execuções
  incrementais (diferente de Semanal/Mensal) — é sempre recalculada do zero a partir
  dos meses processados na execução atual. Rodar `preparar-fluxo.bat` sem
  `-Incremental` (12 meses) garante as janelas de 3m/6m/12m preenchidas.

---

## 4. Roadmap por fases

- **Fase 1 — Fundações, UX e quick wins** *(concluída, exceto DEB-1 pausado)*
  - ✅ GER-1 · Glossário de tabelas
  - ✅ CAP-3 · Coluna PL na C1
  - ✅ GER-2 · Navegação por ícones no app compacto
  - ⏸️ DEB-1 · Enriquecer o Modal do Ativo *(pausado a pedido)*
- ✅ **CAP-1 · Performance dos fundos (rentabilidade %CDI)** — entregue fora de ordem,
  sem esperar por CAP-2 (ver detalhe acima)
- ✅ **GER-3 · Painel de controle da atualização + resumo no header** — entregue fora
  de ordem, sem depender de nenhum outro item (ver detalhe acima)
- **Fase 2 — Qualidade de dados** *(fundacional, em aberto)*
  - 🔵 CAP-2 · Pipeline CVM + regra de seleção de fundos
  - 🟡 MER-1 · Ingestão de dados de negociação do mercado secundário *(a definir)*
- **Fase 3 — Mercado Secundário** *(depende da Fase 2)*
  - 🟡 MER-2 · Gráfico de evolução de preço por ativo *(depende de MER-1)*

---

## 5. Ideias / backlog aberto (não priorizado)
*(espaço para acumular ideias que surgirem; movemos para o backlog priorizado quando fizer sentido)*

- _(vazio)_

---

_Documento mantido em colaboração. Edite à vontade — é a fonte da verdade do
direcionamento do projeto._

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

### Seção Captação
| Código | Nome | Componente | Colunas hoje |
|--------|------|------------|--------------|
| **C1** | Gestores (Captação) | `src/components/fluxo/GestorFlowRanking.jsx` | Gestor · Cap. Líquida · Captação · Resgate |
| **C2** | Semanas | `src/components/fluxo/FluxoTable.jsx` | Semana · Cap. Líquida · Captação · Resgate |
| **C3** | Meses | `src/components/fluxo/FluxoMonthlyTable.jsx` | Mês · Cap. Líquida · Captação · Resgate |

> **Uso:** *"adiciona coluna X na **C1**"* ou *"ordena a **C3** por Captação"*.
> A janela aberta pelo ícone **(i)** na **D1** é chamada de **Modal do Ativo**.

---

## 2. Backlog priorizado

| ID | Item | Seção | Compl. | Custo | Relev. | Fase |
|----|------|-------|:------:|:-----:|:------:|------|
| **GER-1** | Nomear todas as tabelas (este glossário) | Geral | Baixa | Baixo | Alta | ✅ Concluído |
| **CAP-3** | Coluna **PL** na **C1** (Gestores da Captação) | Captação | Baixa | Baixo | Média | 🟢 Fase 1 (quick win) |
| **DEB-1** | Enriquecer o **Modal do Ativo** (janela (i)) | Debêntures | Baixa–Média | Baixo | Média–Alta | 🟢 Fase 1 |
| **GER-2** | Navegação por **ícones** entre seções no app compacto | Geral | Média | Baixo–Médio | Média–Alta | 🟢 Fase 1 |
| **CAP-2** | Regra de seleção do universo de fundos via dados **CVM** | Captação | Alta | Alto | Alta | 🔵 Fase 2 (fundacional) |
| **CAP-1** | **Performance** dos fundos | Captação | Alta | Médio–Alto | Alta | 🟣 Fase 3 (depende de CAP-2) |

**Lógica da ordem**
- **CAP-3, DEB-1 e GER-2** são entregas de **Fase 1**: alto valor percebido, baixo
  risco e sem dependências de dados novos. CAP-3 em especial é quase imediato (o dado
  de PL já é calculado).
- **CAP-2** é **fundacional**: define corretamente o universo de fundos e cria o
  **pipeline de dados CVM** que a performance (CAP-1) vai reaproveitar.
- **CAP-1** depende de CAP-2 — medir performance faz sentido sobre o universo certo,
  usando o mesmo pipeline.

---

## 3. Detalhamento dos itens

### GER-1 · Nomear as tabelas — ✅ Concluído
Glossário na seção 1. Base para todos os comandos e para este roadmap.

---

### CAP-3 · Coluna PL na C1 (Gestores da Captação) — 🟢 quick win
**O quê:** exibir o Patrimônio Líquido por gestor na tabela **C1**, como já existe na **D2**.

**Estado atual:** `aggregateByGestor` (em `src/utils/fluxo.js`) já calcula:
- `plRecente` — PL total do gestor na semana mais recente do período;
- `plTotalMedio` — média, no tempo, do PL total semanal do gestor.

Falta apenas exibir: adicionar a coluna em `GestorFlowRanking.jsx` (cabeçalho
`SortableTh` + chave de ordenação + célula + formatação).

- **Complexidade:** Baixa · **Custo:** Baixo · **Relevância:** Média
- **Risco:** baixo (nenhuma fonte de dados nova).
- **🟡 A definir:** mostrar **PL recente** ou **PL médio** (ou ambos)? Sugestão:
  **PL recente** (consistente com a leitura "foto atual" do ranking), com tooltip.

---

### DEB-1 · Enriquecer o Modal do Ativo (janela (i)) — 🟢 Fase 1
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

### GER-2 · Navegação por ícones entre seções (app compacto) — 🟢 Fase 1
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
- **🟡 A definir:**
  - **Quais ícones** representam cada seção? (ex.: Debêntures = documento/título "%";
    Captação = fluxo/setas entrada-saída). Posso propor 2–3 opções de cada.
  - No compacto, como ficam as **sub-abas de Debêntures** (Ativos / Gestores / Grupos)
    depois que a troca de seção vira ícone no topo? (sugestão: viram abas secundárias
    logo abaixo, aparecendo só quando a seção Debêntures está ativa).

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
- **Destrava:** CAP-1 (reaproveita o pipeline CVM).
- **🟡 A definir (depende da sua visão de negócio):**
  - Qual é a **definição de "indústria"**? (crédito privado? high grade? todos os
    fundos abertos com PL ≥ X?)
  - **Critérios de corte** (PL mínimo, classe ANBIMA, excluir exclusivos/FIC…).
  - **Frequência** de atualização da base CVM (diária? semanal? mensal?).

---

### CAP-1 · Performance dos fundos — 🟣 Fase 3
**O quê:** trazer a **rentabilidade** dos fundos para a Captação (hoje só há fluxo:
captação / resgate / cap. líquida e PL).

- **Complexidade:** Alta · **Custo:** Médio–Alto · **Relevância:** Alta
- **Depende de:** CAP-2 (universo + pipeline CVM).
- **🟡 A definir:**
  - **Métrica:** rentabilidade da cota? Em quais **janelas** (mês, 12m, no período
    filtrado)? Comparar contra **benchmark** (CDI / IMA-B)?
  - **Granularidade:** por fundo, por gestor (média ponderada por PL), ou ambos?
  - **Onde exibir:** nova coluna nas tabelas, novo card, ou nova sub-aba?

---

## 4. Roadmap por fases

- **Fase 1 — Fundações, UX e quick wins** *(agora)*
  - ✅ GER-1 · Glossário de tabelas
  - 🟢 CAP-3 · Coluna PL na C1
  - 🟢 DEB-1 · Enriquecer o Modal do Ativo
  - 🟢 GER-2 · Navegação por ícones no app compacto
- **Fase 2 — Qualidade de dados** *(fundacional)*
  - 🔵 CAP-2 · Pipeline CVM + regra de seleção de fundos
- **Fase 3 — Inteligência** *(depende da Fase 2)*
  - 🟣 CAP-1 · Performance dos fundos

---

## 5. Ideias / backlog aberto (não priorizado)
*(espaço para acumular ideias que surgirem; movemos para o backlog priorizado quando fizer sentido)*

- _(vazio)_

---

_Documento mantido em colaboração. Edite à vontade — é a fonte da verdade do
direcionamento do projeto._

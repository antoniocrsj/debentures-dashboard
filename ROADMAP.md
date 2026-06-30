# 🧭 Roadmap — BI Crédito Privado (debentures-dashboard)

Documento-bússola do projeto. Define um **vocabulário comum** (nomes das tabelas) e
um **backlog priorizado** por complexidade, custo e relevância. Vivo: atualizado a
cada decisão.

> Como ler a priorização: cada item recebe **Complexidade**, **Custo** e
> **Relevância** (Baixa / Média / Alta). Regra geral de ordem: *alta relevância +
> baixo esforço primeiro*; itens fundacionais (que destravam outros) vêm antes dos
> que dependem deles.

---

## 1. Glossário de tabelas

O app tem **duas seções**: **Debêntures** e **Captação**. Cada tabela ganha um
**código curto** (para comandos assertivos) e um **nome canônico**.

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

> Uso: *"adiciona coluna X na **C1**"* ou *"ordena a **C3** por Captação"*.
> O modal do ativo (ícone (i) na **D1**) é referido como **Modal do Ativo**.

---

## 2. Backlog priorizado

| ID | Item | Seção | Compl. | Custo | Relev. | Fase |
|----|------|-------|:------:|:-----:|:------:|------|
| **G1** | Nomear todas as tabelas (este glossário) | Geral | Baixa | Baixo | Alta | ✅ Concluído |
| **CAP-3** | Coluna **PL** na **C1** (Gestores da Captação) | Captação | Baixa | Baixo | Média | 🟢 Agora (quick win) |
| **CAP-2** | Regra de seleção do universo de fundos via dados **CVM** | Captação | Alta | Alto | Alta | 🔵 Fundacional (Fase 2) |
| **CAP-1** | **Performance** dos fundos | Captação | Alta | Médio–Alto | Alta | 🟣 Fase 3 (depende de CAP-2) |

**Por que esta ordem**
- **CAP-3** é um quick win: o PL **já é calculado** no backend (`aggregateByGestor`
  → `plRecente` / `plTotalMedio`), só falta exibir. Entrega valor imediato com risco mínimo.
- **CAP-2** é **fundacional**: definir corretamente *quais fundos compõem o universo*
  melhora a fidelidade de tudo na Captação e cria o **pipeline de dados CVM** que a
  performance (CAP-1) vai reaproveitar.
- **CAP-1** depende de CAP-2: medir performance faz mais sentido sobre o universo de
  fundos certo, usando o mesmo pipeline CVM.

---

## 3. Detalhamento dos itens

### G1 · Nomear as tabelas — ✅ Concluído
Glossário na seção 1. Serve de base para todos os comandos e para este roadmap.

---

### CAP-3 · Coluna PL na C1 (Gestores da Captação) — 🟢 quick win
**O quê:** exibir o Patrimônio Líquido por gestor na tabela **C1**, como já existe na **D2**.

**Estado atual:** `aggregateByGestor` (em `src/utils/fluxo.js`) já retorna:
- `plTotalMedio` — média, no tempo, do PL total semanal do gestor;
- `plRecente` — PL total do gestor na semana mais recente do período.

Falta apenas: adicionar a coluna em `GestorFlowRanking.jsx` (chave de ordenação +
célula + cabeçalho `SortableTh`) e formatação.

- **Complexidade:** Baixa · **Custo:** Baixo · **Relevância:** Média
- **Risco:** baixo (sem nova fonte de dados).
- **🟡 A definir:** mostrar **PL recente** ou **PL médio** (ou ambos)? Sugestão: **PL recente**
  (consistente com a leitura "foto atual" do ranking), com tooltip explicando.

---

### CAP-2 · Regra de seleção do universo de fundos (dados CVM) — 🔵 fundacional
**O quê:** hoje a lista de fundos da Captação reflete uma base própria. A ideia é
**construir uma regra reprodutível** que selecione os fundos representativos da
indústria a partir de **dados públicos da CVM** (e classificação ANBIMA), para a
Captação refletir o mercado de forma fidedigna.

**Blocos de trabalho**
1. **Ingestão CVM:** baixar e normalizar as bases públicas (cadastro de fundos +
   informe diário / PL / classe). Definir periodicidade de atualização.
2. **Algoritmo de seleção:** critérios objetivos (ex.: classe/categoria, condomínio
   aberto, PL mínimo, fundos não exclusivos, foco em crédito privado…) → produz a
   lista final de fundos.
3. **Integração:** alimentar a Captação com o universo selecionado e documentar a regra.

- **Complexidade:** Alta · **Custo:** Alto · **Relevância:** Alta
- **Destrava:** CAP-1 (reaproveita o pipeline CVM).
- **🟡 A definir (precisa da sua visão de negócio):**
  - Qual é a **definição de "indústria"** aqui? (crédito privado? high grade? todos os
    fundos abertos com PL ≥ X?)
  - **Critérios de corte** (PL mínimo, classe ANBIMA, excluir exclusivos/FIC, etc.).
  - **Frequência** de atualização da base CVM (diária? semanal? mensal?).

---

### CAP-1 · Performance dos fundos — 🟣 Fase 3
**O quê:** trazer a **rentabilidade** dos fundos para a Captação (hoje só há fluxo:
captação/resgate/cap. líquida e PL).

- **Complexidade:** Alta · **Custo:** Médio–Alto · **Relevância:** Alta
- **Depende de:** CAP-2 (universo + pipeline CVM).
- **🟡 A definir:**
  - **Métrica:** rentabilidade da cota? Em quais **janelas** (mês, 12m, no período
    filtrado)? Comparar contra **benchmark** (CDI / IMA-B)?
  - **Granularidade:** por fundo, por gestor (média ponderada por PL), ou ambos?
  - **Onde exibir:** nova coluna nas tabelas existentes, novo card, ou nova sub-aba?

---

## 4. Roadmap por fases

- **Fase 1 — Fundações & quick wins** *(agora)*
  - ✅ G1 · Glossário de tabelas
  - 🟢 CAP-3 · Coluna PL na C1
- **Fase 2 — Qualidade de dados** *(fundacional)*
  - 🔵 CAP-2 · Pipeline CVM + regra de seleção de fundos
- **Fase 3 — Inteligência** *(depende da Fase 2)*
  - 🟣 CAP-1 · Performance dos fundos

---

## 5. Ideias / backlog aberto (não priorizado)
*(espaço para acumular ideias que surgirem; movemos para o backlog priorizado quando fizer sentido)*

- _(vazio)_

---

_Última atualização: gerada em colaboração. Edite à vontade — este arquivo é a fonte da verdade do direcionamento._

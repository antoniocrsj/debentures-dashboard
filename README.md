# Debêntures CR

Dashboard mobile-first de debêntures de infraestrutura: lista de ativos, ranking de
gestores e grupos econômicos, com cross-filter (estilo Power BI). React + Vite,
publicado na Vercel.

🔗 **Produção:** https://debentures-dashboard-three.vercel.app

> 📅 **Para a rotina de atualização (semanal), veja o [COMO-ATUALIZAR.md](COMO-ATUALIZAR.md)** —
> manual passo a passo, sem jargão.

---

## Sumário

1. [Stack e estrutura](#stack-e-estrutura)
2. [Arquivos de dados que o app usa](#1-arquivos-de-dados-que-o-app-usa)
3. [Colunas obrigatórias](#2-colunas-obrigatórias)
4. [Como rodar localmente](#3-como-rodar-localmente)
5. [Como atualizar a base](#4-como-atualizar-a-base)
6. [Como publicar na Vercel](#5-como-publicar-na-vercel)
7. [O que fazem os `.bat`](#6-o-que-fazem-os-bat)
8. [Aba Captação (Fluxo)](#7-aba-captação-fluxo)
9. [Notas e limitações](#notas-e-limitações)

---

## Stack e estrutura

- **React 18 + Vite 5**, deploy na **Vercel**
- Sem backend próprio: os dados vêm de planilhas (via Google Apps Script) e de um
  arquivo estático.

```
debentures-dashboard/
├── public/
│   ├── BLC_tratado.csv        ← base de ALOCAÇÃO (gerada todo mês, ver seção 4)
│   ├── data/                  ← bases da aba Captação (ver seção 7)
│   │   ├── Fluxo_Semanal_12431.csv
│   │   └── Fluxo_Semanal_Trad.csv
│   └── icon-*.png / icon.svg
├── src/
│   ├── App.jsx                ← orquestra estado, filtros, abas
│   ├── hooks/
│   │   ├── useDebentures.js   ← carrega as 4 fontes de Mercado (URLs aqui)
│   │   └── useFluxo.js        ← carrega as bases de Captação (origem aqui)
│   ├── utils/
│   │   ├── data.js            ← mapeamento de COLUNAS (FIELDS) e cálculos do Mercado
│   │   ├── fluxo.js           ← funções puras da Captação (parse/agregação/format)
│   │   ├── csv.js             ← parser de CSV
│   │   └── format.js          ← formatação de número/data/taxa
│   └── components/
│       ├── …                  ← tabela, rankings, filtros, modal (Mercado)
│       ├── SearchSelect.jsx   ← dropdown com busca (reutilizado)
│       └── fluxo/             ← componentes da aba Captação
├── test/fluxo.test.js         ← testes das funções puras (npm test)
├── api/proxy.js               ← proxy CORS para o GAS (em produção)
├── vite.config.js             ← proxy CORS para o GAS (em dev) + PWA
└── tools/
    ├── preparar-blc.ps1       ← transforma o CDA bruto da CVM no BLC_tratado.csv
    ├── preparar-blc.bat       ← atalho de 1 clique para o script acima
    ├── preparar-fluxo.ps1     ← gera as bases da Captação a partir do Informe Diário CVM
    ├── preparar-fluxo.bat     ← atalho de 1 clique para o script de fluxo
    ├── lista_*.example.csv    ← modelos das listas de fundos (CNPJ → Gestor_Apelido)
    └── publicar.bat           ← sobe os dados de public/ para o ar (git push)
```

> As URLs das fontes ficam em [`src/hooks/useDebentures.js`](src/hooks/useDebentures.js).
> O "de-para" de nomes de coluna fica no objeto `FIELDS` em
> [`src/utils/data.js`](src/utils/data.js) — cada campo aceita vários apelidos, então
> pequenas variações de nome de coluna não quebram o app.

---

## 1. Arquivos de dados que o app usa

O app carrega **4 fontes** em paralelo:

| # | Fonte | Origem | Conteúdo |
|---|-------|--------|----------|
| 1 | **Emissores** | GAS `CADASTRO_URL?sheet=emissores` | Nome, grupo e setor de cada emissor |
| 2 | **Fundos** | GAS `CADASTRO_URL?sheet=fundos` | Gestor, PL e CNPJ de cada fundo |
| 3 | **Debêntures** | GAS `DEB_URL` | Cadastro das debêntures (≈4.600 ativos) |
| 4 | **BLC (alocação)** | **estático** `public/BLC_tratado.csv` | Quanto cada gestor aloca em cada ativo |

As fontes 1–3 são planilhas do Google que você mantém, expostas como CSV por um
Apps Script (com cache de 6h). A fonte 4 é o **único arquivo que precisa de
tratamento mensal** (ver seção 4) — é servida direto pelo app, sem Google, por isso
abre em milissegundos.

> **Por que o BLC é tratado por gestor?** O arquivo bruto da CVM (CDA) tem ~221 mil
> linhas no nível de **fundo** (8,9 MB). O app só mostra **gestores e grupos**, nunca
> fundos individuais, então agregamos para o nível de gestor: ~24,7 mil linhas
> (717 KB). O PL por gestor vem da soma dos fundos no cadastro de fundos.

---

## 2. Colunas obrigatórias

Os nomes abaixo são os "principais"; o app também aceita apelidos alternativos
(veja `FIELDS` em `src/utils/data.js`). Maiúsculas/minúsculas e acentos importam.

### Emissores (`?sheet=emissores`)
| Coluna | Uso |
|--------|-----|
| `CNPJ Emissor` | chave de ligação com a debênture (**obrigatória**) |
| `Emissor` | nome exibido do emissor |
| `Grupo` | usado na aba **Grupos** e no filtro Grupo |
| `Setor` | usado no filtro Setor |

### Fundos (`?sheet=fundos`)
| Coluna | Uso |
|--------|-----|
| `CNPJ Fundo` | chave do fundo (**obrigatória**) |
| `Gestor Apelido` | nome do gestor exibido (cai para `Nome Gestor` se vazio) |
| `Patrimônio Líquido (R$)` | PL somado por gestor na aba **Gestores** |

### Debêntures (`DEB_URL`)
| Coluna | Uso |
|--------|-----|
| `Codigo do Ativo` | chave do ativo, liga com o BLC (**obrigatória**) |
| `CNPJ Emissor` | liga com a planilha de emissores (**obrigatória**) |
| `Data de Emissao` | ordenação "mais recentes" + coluna Emis. |
| `Data de Vencimento` | coluna Venc. |
| `Juros Criterio Novo - Taxa` | coluna Taxa |
| `Quantidade em Mercado` + `Valor Nominal Atual` | calcula o Volume emitido |
| `Deb. Incent. (Lei 12.431)` | filtro Lei 12.431 (valor `S`/`N`) |
| `Indexador`, `Coordenador Lider`, `Garantia` | exibidos no detalhe (opcionais) |

### BLC tratado (`public/BLC_tratado.csv`) — exatamente 3 colunas
| Coluna | Conteúdo |
|--------|----------|
| `CD_ATIVO` | código da debênture (liga com `Codigo do Ativo`) |
| `GESTOR` | apelido do gestor |
| `VL_ALOCADO` | soma alocada por aquele gestor naquele ativo |

### CDA bruto da CVM (entrada do `preparar-blc`) — colunas lidas
`CD_ATIVO`, `CNPJ_FUNDO_CLASSE`, `VL_MERC_POS_FINAL` e, se existir, `TP_APLIC`
(usada para manter só linhas de Debêntures).

---

## 3. Como rodar localmente

Pré-requisito: **Node.js 18+**.

```bash
cd debentures-dashboard
npm install
npm run dev
```

Abre em `http://localhost:5173` (também acessível na rede local, p/ testar no celular).

Em dev, o Vite intercepta `/api/proxy` e busca as planilhas do Google contornando o
CORS (lógica em `vite.config.js`). O `BLC_tratado.csv` é servido direto de `public/`.

Outros comandos:

```bash
npm run build     # gera dist/ (produção)
npm run preview   # serve o dist/ localmente
```

---

## 4. Como atualizar a base

### Alocação (BLC) — mensal
É o fluxo principal. Faça **2 cliques**:

1. Clique 2× em **`tools\preparar-blc.bat`** → baixa o CDA direto da CVM (mês mais
   recente já fechado, mesma regra de defasagem do `selecionar-fundos.ps1`) e gera o
   `BLC_tratado.csv` direto em `public/` (~3 min). Não precisa baixar nada manualmente
   — só se quiser usar um `.xlsx` específico, arraste ele para cima do `.bat`.
2. Clique 2× em **`tools\publicar.bat`** → sobe pro ar (Vercel atualiza em ~1 min).

> Não precisa abrir terminal nem mexer em planilha. O `preparar-blc` busca o mapa
> fundo→gestor em `tools\Fundos_12431.csv` / `tools\Fundos_CDI.csv` (local).

### Cadastros (emissores / fundos / debêntures)
Esses ficam nas **planilhas do Google**. Edite a planilha normalmente — o Apps Script
tem cache de 6h, então a mudança aparece no app no máximo em algumas horas (ou na hora
seguinte ao cache expirar). Não precisa publicar nada.

---

## 5. Como publicar na Vercel

O projeto está conectado ao repositório
[`antoniocrsj/debentures-dashboard`](https://github.com/antoniocrsj/debentures-dashboard).
**Todo push na branch `main` dispara um deploy automático** na Vercel.

- Para atualizar **só o BLC**: use `tools\publicar.bat` (faz o push por você).
- Para mudanças de **código**: `git add`/`commit`/`push` na `main` normalmente; a
  Vercel reconstrói sozinha.

A URL fixa de produção é `https://debentures-dashboard-three.vercel.app`.

---

## 6. O que fazem os `.bat`

### `tools\preparar-blc.bat`
Atalho que roda `preparar-blc.ps1` (PowerShell, sem instalar nada). Ele:
1. Baixa o `cda_fi_{AAAAMM}.zip` da CVM (mês-alvo pela regra de defasagem) e lê o
   bloco BLC_4 (ou um `.xlsx` local, se informado);
2. Mantém só as linhas de Debêntures (coluna `TP_APLIC`);
3. Busca o mapa **fundo→gestor** em `tools\Fundos_12431.csv` / `tools\Fundos_CDI.csv`
   (local) + `Apelido Gestor` no GAS de `Cadastro_Gestores`;
4. **Soma** `VL_MERC_POS_FINAL` por (`CD_ATIVO`, `GESTOR`);
5. Grava `public/BLC_tratado.csv` (3 colunas).

Uso: clique 2× (baixa da CVM sozinho), **ou** arraste um `.xlsx` local para cima do
`.bat` pra usar ele em vez de baixar.

### `tools\publicar.bat`
Sobe o arquivo gerado para o ar. Por dentro faz:
```
git add public/BLC_tratado.csv
git commit -m "Atualiza BLC"
git push
```
Abre uma janela, roda alguns segundos e mostra "Pronto!". A Vercel publica em ~1 min.

> ⚠️ Rode clicando 2× no arquivo dentro de `tools\` — **não** digite o nome no
> terminal de uma pasta qualquer.

---

## 7. Aba Captação (Fluxo)

Mostra a **evolução semanal de captações e resgates** de fundos de crédito, com gráfico
combinado (barras de captação/resgate + linha de líquido), cards de resumo, tabela
semanal e ranking de gestores. É **mobile-first** e independente das demais abas (carrega
seus próprios dados; o Recharts só baixa quando você abre a aba).

### Origem dos dados
Configurada num **único lugar**: [`src/hooks/useFluxo.js`](src/hooks/useFluxo.js).

```js
export const FLUXO_SOURCES = {
  '12431': '/data/Fluxo_Semanal_12431.csv',   // Fundos Incentivados (Lei 12.431)
  'trad':  '/data/Fluxo_Semanal_Trad.csv',    // Crédito Tradicional
}
export const FLUXO_IS_MOCK = false  // true mostra um aviso amarelo de "dados de exemplo"
```

Para trocar a origem por Google Apps Script / API no futuro, basta alterar esse arquivo —
os componentes não mudam.

> Hoje a aba roda com **dados reais da CVM** (`FLUXO_IS_MOCK = false`). Se voltar a usar
> CSVs de exemplo, deixe `true` para exibir o aviso de mock no topo da aba.

### Estrutura esperada dos CSVs (`public/data/`)
Cabeçalho exato (UTF-8, separador vírgula), uma linha por **(semana, gestor)**:

```
Semana,Gestor_Apelido,Captacao,Resgate,Liquido,PL_Medio,Num_Fundos
2026-01-05,Gestora Exemplo A,48000000,30000000,18000000,2000000000,8
```

| Coluna | Definição |
|--------|-----------|
| `Semana` | data inicial da semana (segunda-feira), ISO `AAAA-MM-DD` |
| `Gestor_Apelido` | nome do gestor (chave do filtro/ranking) |
| `Captacao` | soma das captações da semana (positivo) |
| `Resgate` | soma dos resgates (armazenar positivo) |
| `Liquido` | `Captacao − Resgate` (o app **recalcula**, então não depende dessa coluna) |
| `PL_Medio` | **PL total do gestor naquela semana** (soma dos fundos do gestor, suavizada nos dias) — é um estoque, não uma média entre fundos |
| `Num_Fundos` | nº de fundos considerados na semana |

### Como atualizar as bases (semanal)
O gerador é o `tools/preparar-fluxo.ps1` (PowerShell, **sem instalar nada** — mesmo padrão
do BLC). Roda **toda semana** (os 2 meses mais recentes são sempre rebaixados; os antigos
ficam em cache). Fluxo:

1. Mantenha `tools/Fundos_12431.csv` / `tools/Fundos_CDI.csv` (arquivos **locais**,
   versionados no git — não vivem mais na planilha) atualizados —
   `CNPJ_FUNDO_CLASSE, DENOM_SOCIAL, CNPJ Gestor` de cada segmento. Use
   `tools/selecionar-fundos.ps1` para gerar uma sugestão objetiva (≥15% do PL em
   debêntures, ou nome batendo padrão de infraestrutura/incentivado) a partir do CDA da
   CVM. A aba `Cadastro_Gestores` continua na planilha (GAS) — `CNPJ Gestor, Nome Gestor,
   Apelido Gestor`. O script cruza fundo → CNPJ Gestor (CSV local) → Apelido
   (Cadastro_Gestores) — ver `tools/lib-cadastro.ps1`. Se algum dia editar Fundos_12431/
   Fundos_CDI direto na planilha (não recomendado), rode `sincronizar-fundos-planilha.ps1`
   pra trazer de volta pro CSV local.
2. Clique 2× em **`tools\preparar-fluxo.bat`** (sem argumentos = últimos 12 meses). Ele
   baixa os `inf_diario_fi_AAAAMM.zip` da CVM (cache em `C:\Projeto Crédito\CVM _informe_diario`,
   não rebaixa), calcula o fluxo semanal por gestor e grava direto em `public/data/` +
   `public/PL_Gestores.csv`.
3. Da **primeira vez**, troque `FLUXO_IS_MOCK` para `false` em `src/hooks/useFluxo.js`.
4. Publique com **`tools\publicar.bat`** (sobe tudo de `public/`).

> Para baixar meses específicos: `preparar-fluxo.bat -Meses 202504,202505`.

### Testar localmente
- `npm run dev` → abra a aba **Captação**.
- `npm test` → roda os testes das funções puras de fluxo (`test/fluxo.test.js`).

### Indicadores e regras
**PL (estoque — agregado por data, depois média no tempo):**
- **PL total médio** = para cada semana soma-se o PL de todos os fundos do recorte (PL
  total da semana); o indicador é a **média desses totais semanais** no período.
  Não é média entre fundos, nem soma de todas as semanas.
- **PL mais recente** = PL total do recorte na **semana mais recente** disponível.
- Por gestor, mesma metodologia (soma dos fundos do gestor por semana → média no tempo;
  recente = última semana do gestor).

**Fluxos:** `Captacao`/`Resgate` = soma (positivos); `Liquido` = soma(Captacao) −
soma(Resgate). No **gráfico**, o resgate é exibido **negativo** (`-Math.abs(Resgate)`)
abaixo do zero, mas cards, tabelas e cálculos mantêm o resgate **positivo**.

**Nº de fundos:** por semana = soma dos gestores (sem dupla contagem). No ranking é a
**média de fundos por semana** do gestor — a base agregada não permite recuperar fundos
únicos no período (limitação).

**Períodos:** atalhos 1/3/6/12 meses e "Todo o histórico", calculados a partir da
**semana mais recente da base** (não do relógio do computador). O período efetivamente
usado é exibido como "Dados de DD/MM/AAAA a DD/MM/AAAA".

**Ordenação das tabelas:** clique no cabeçalho — 1º clique decrescente, 2º crescente,
3º volta ao padrão (ranking: PL total médio ↓). Ordena pelos **valores numéricos brutos**,
nunca pelo texto formatado; nulos vão para o fim; `aria-sort` para acessibilidade.

**Eixo do gráfico:** dados semanais, mas o eixo X mostra ~1 marca por mês no formato
`jun/25` (menos marcas no celular). O tooltip mantém a semana exata (`DD/MM/AAAA`) e os
sinais explícitos (Captação +, Resgate −, Líquido ±) e o PL total da semana.

**Referência da base:** "Base atualizada até DD/MM/AAAA" usa a semana mais recente do
**segmento selecionado** (12.431 ou Tradicional), não a hora de acesso.

---

## Notas e limitações

- **Carga a frio ~12s** (acima dos 10s alvo): o BLC agora é instantâneo, mas as 3
  chamadas ao Google (cadastros + debêntures) ainda pesam. Próximo passo possível:
  tornar a base de debêntures estática pelo mesmo caminho do BLC. Com cache do
  navegador, visitas seguintes são instantâneas.
- **Um mês por vez:** hoje o app mostra o mês atual (Fev/26). Histórico exigiria um
  arquivo por mês.
- **Tabela limitada a 100 linhas** por padrão (performance); o botão "ver todos"
  libera o restante.
- **Aba Captação com dados reais da CVM** (`FLUXO_IS_MOCK = false`), 52 semanas. Atualize
  pelo `preparar-fluxo.bat` + `publicar.bat`.
- **Gerador em PowerShell, não Python.** O spec pedia `fluxo_semanal.py`, mas como sua
  máquina não tem Python e todo o pipeline (BLC) já é PowerShell de 1 clique, o gerador
  ficou em `tools/preparar-fluxo.ps1`. Posso fornecer a versão Python sob demanda.
- **Nº de fundos no ranking** é a média por semana (não fundos únicos no período) —
  ver seção 7.

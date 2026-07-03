# CLAUDE.md

Guia para assistentes de IA que trabalham neste repositório. **A fonte da verdade é
sempre o código** — quando este documento divergir do código, confie no código e
atualize este arquivo.

O projeto é escrito em **português** (nomes de variáveis, comentários, UI, dados).
Mantenha esse idioma ao escrever código, comentários e mensagens de commit.

---

## O que é

Dashboard **mobile-first** de crédito privado (React 18 + Vite 5, deploy na Vercel).
Sem backend próprio: os dados vêm de planilhas do Google (via Apps Script) e de
arquivos CSV estáticos em `public/`. Duas grandes áreas:

- **Debêntures** (aba "Debêntures" no desktop / sub-abas no mobile):
  - **Ativos** — lista de debêntures de infraestrutura (≈4.600 ativos).
  - **Gestores** — ranking de gestores por alocação + PL.
  - **Grupos** — ranking de grupos econômicos por alocação.
  - Cross-filter estilo Power BI: clicar num gestor/grupo/ativo filtra tudo;
    clicar de novo no mesmo valor limpa.
- **Captação** (aba "Captação") — fluxo semanal/mensal (captações e resgates) de
  fundos de crédito, com filtros de tipo/gestor/período, cards, gráfico combinado
  (Recharts, carregado sob demanda), tabelas e ranking de gestores.

Produção: https://debentures-dashboard-three.vercel.app

---

## Comandos

```bash
npm install         # instalar dependências
npm run dev         # servidor de dev (Vite, --host); inclui o proxy CORS do GAS
npm run build       # build de produção → dist/
npm run preview     # servir o build localmente
npm test            # runner nativo do Node (node --test) — testa as funções puras
```

- **Não há linter/formatter configurado** e não há script de typecheck (é JS puro,
  sem TypeScript). O `npm test` cobre apenas as funções puras de `src/utils/`
  (principalmente `fluxo.js` e `anbima.js`).
- Sempre rode `npm test` após mexer em `src/utils/fluxo.js`, `src/utils/anbima.js`
  ou nos parsers/agregações — os testes em `test/` são a rede de segurança.

---

## Arquitetura

```
debentures-dashboard/
├── index.html                 ← entrada Vite (monta #root)
├── vite.config.js             ← plugin React + PWA + PROXY CORS de DEV para o GAS
├── vercel.json                ← build/deploy Vercel (rewrites /api/*)
├── api/proxy.js               ← PROXY CORS de PRODUÇÃO (Vercel serverless)
├── public/                    ← CSVs estáticos servidos direto pela CDN (sem proxy)
│   ├── BLC_tratado.csv         ← ALOCAÇÃO por (ativo, gestor) — base mensal
│   ├── Debentures.csv          ← cadastro das debêntures
│   ├── Anbima_Tx.csv           ← taxas/duration ANBIMA por ticker
│   ├── PL_Gestores.csv         ← PL por gestor
│   ├── *_meta.json             ← metadados (data de referência) das bases
│   └── data/                   ← bases da aba Captação
│       ├── Fluxo_Semanal_12431.csv / Fluxo_Semanal_Trad.csv
│       ├── Fluxo_Mensal_12431.csv  / Fluxo_Mensal_Trad.csv
│       └── Fluxo_Meta.json
├── src/
│   ├── main.jsx               ← bootstrap React + auto-reload em chunk desatualizado
│   ├── App.jsx                ← orquestra estado, filtros, abas, cross-filter
│   ├── index.css             ← estilos globais (sem framework de CSS)
│   ├── hooks/
│   │   ├── useDebentures.js   ← carrega as fontes de Debêntures (URLs GAS aqui)
│   │   └── useFluxo.js        ← carrega as bases de Captação (caminhos aqui)
│   ├── utils/
│   │   ├── data.js            ← de-para de COLUNAS (objeto FIELDS) + cálculos Debêntures
│   │   ├── fluxo.js           ← funções puras da Captação (parse/agregação/format)
│   │   ├── anbima.js          ← monta URL da ANBIMA a partir do ticker
│   │   ├── csv.js             ← parser de CSV robusto (aspas, detecta HTML de erro)
│   │   ├── format.js          ← número/data/taxa/CNPJ (pt-BR) + isYes/dateKey
│   │   ├── lazyWithRetry.js   ← React.lazy que re-tenta o import se o chunk falhar
│   │   └── mockData.js        ← dados MOCK (USE_MOCK em useDebentures.js)
│   └── components/
│       ├── Header, Filters, AssetTable, AssetModal, ManagerRanking,
│       │   GroupRanking, MonthSelector, SearchSelect, ErrorBoundary  (Debêntures)
│       └── fluxo/             ← componentes da aba Captação (FluxoDashboard = raiz)
├── test/                      ← testes das funções puras (node --test)
└── tools/                     ← pipeline de dados em PowerShell (só roda no Windows)
```

### Fluxo de dados — Debêntures (`useDebentures.js`)

`useDebentures` carrega **5 fontes em paralelo**, cacheia o resultado em
`localStorage` (TTL 4h, chave `deb-cache-v5`) e faz **stale-while-revalidate**:
se há cache válido, mostra na hora e atualiza em segundo plano.

| Fonte | Origem | Como |
|-------|--------|------|
| **Emissores** | GAS `CADASTRO_URL?sheet=Cadastro_Emissores&nocache=1` | via proxy (lida ao vivo — curadoria de Grupo/Setor) |
| **Debêntures** | `public/Debentures.csv` (estático) | fallback GAS `DEB_URL` se falhar |
| **BLC (alocação)** | `public/BLC_tratado.csv` (estático) | direto pela CDN |
| **ANBIMA** | `public/Anbima_Tx.csv` (estático) | opcional (segue sem se faltar) |
| **PL por gestor** | `public/PL_Gestores.csv` (estático) | opcional (segue sem se faltar) |

Só as fontes GAS passam pelo proxy CORS. Os estáticos são servidos direto.

**Transformação:** `App.jsx` chama, em `useMemo`, `buildIndexes`/`buildBlcIndex`/
`buildAnbimaIndex`/`buildPlByGestor` (indexação) e depois `enrichDebenture` em cada
debênture — juntando emissor (por CNPJ), alocação e gestores (do BLC) e taxa ANBIMA
(por ticker). Os rankings (`computeManagers`, `computeGroups`) são recalculados sobre
o subconjunto filtrado.

### Fluxo de dados — Captação (`useFluxo.js` + `utils/fluxo.js`)

Independente das Debêntures. Carrega CSVs estáticos de `public/data/` (semanal +
mensal) e um `Fluxo_Meta.json`. Toda a lógica (parse de semana/mês, filtro por
período, agregação por semana/mês/gestor, cards, séries do gráfico e formatação)
vive em `src/utils/fluxo.js` como **funções puras testáveis** (sem React).

> **Contrato do CSV semanal:** `Semana, Gestor_Apelido, Captacao, Resgate, Liquido,
> PL_Medio, Num_Fundos`. `Liquido` é sempre recalculado como `Captacao − Resgate`
> (a coluna do CSV é ignorada). `Resgate` é sempre tornado absoluto. `PL_Medio` é
> **estoque** (PL total do gestor na semana), não fluxo — leia o cabeçalho de
> `fluxo.js` antes de mexer em agregações de PL.

### Proxy CORS do GAS (importante)

O Google Apps Script devolve páginas intermediárias (interstitial: meta-refresh,
`window.location`, links para `googleusercontent`) antes do CSV. Dois proxies
resolvem isso com a **mesma lógica** (`gasFetch` + `extractRedirect`), acumulando
cookies entre hops:

- **Dev:** middleware `gas-cors-proxy` em `vite.config.js`.
- **Produção:** `api/proxy.js` (serverless na Vercel). Só aceita URLs que começam
  com `https://script.google.com/`; cacheia só respostas boas (CSV), nunca HTML.

**Se editar um, edite o outro** para mantê-los em sincronia.

---

## Convenções e padrões

- **JS puro + ESM** (`"type": "module"`). React function components + hooks. Sem
  TypeScript, sem Redux — estado local em `App.jsx`/`FluxoDashboard.jsx` via
  `useState`/`useMemo`/`useCallback`.
- **De-para de colunas:** nunca acesse nomes de coluna crus espalhados pelo código.
  O objeto `FIELDS` em `src/utils/data.js` mapeia cada campo lógico para uma lista
  de apelidos aceitos (a função `pick` retorna o primeiro que existir). Ao suportar
  uma nova variação de nome de coluna, adicione o apelido em `FIELDS`.
- **Formatação pt-BR centralizada** em `format.js` (moeda compacta `fmtBRL`, datas
  `fmtDate`/`fmtDateShort`, taxa `fmtTaxa`, `parseNum` que entende formato BR e US).
  Reutilize essas funções em vez de formatar inline.
- **Performance:** listas grandes usam `useMemo`; o mobile limita a 100 linhas
  (`PAGE_SIZE`) com botão "ver todos". A aba Captação e o **Recharts são lazy**
  (`lazyWithRetry`) — só carregam ao abrir a aba, preservando a carga inicial.
- **Robustez de chunk/deploy:** `main.jsx` recarrega a página uma vez em
  `vite:preloadError` (chunk antigo após deploy); `ErrorBoundary` + `lazyWithRetry`
  evitam tela em branco quando um import dinâmico falha. Mantenha esses guardas.
- **Cache local:** ao mudar o **formato** de `raw` em `useDebentures`, incremente a
  versão da chave em `cacheKey()` (hoje `deb-cache-v5`) para invalidar caches antigos.
- **PWA:** configurado em `vite.config.js` (`vite-plugin-pwa`, `registerType:
  autoUpdate`). Ícones em `public/icon-*` (gerados por `gen-icons.mjs`).

---

## Pipeline de dados (`tools/`, PowerShell — Windows)

Os scripts de preparação de dados rodam **na máquina Windows do mantenedor**, não no
CI nem neste ambiente. Geram os CSVs de `public/`. Fluxo típico (ver
`COMO-ATUALIZAR.md` para o manual passo a passo):

- **Semanal:** `preparar-fluxo.bat` (Informe Diário da CVM → `Fluxo_*` + `PL_Gestores.csv`)
  → `publicar.bat` (git push).
- **Mensal:** `preparar-blc.bat` (CDA da CVM → `BLC_tratado.csv`, agregado por
  gestor) e `preparar-debentures.bat` (cadastro das debêntures).
- **`atualizar-tudo.bat`/`.ps1`** orquestra tudo; `lib-cadastro.ps1` resolve
  CNPJ da classe → gestor cruzando `tools/Fundos_12431.csv`/`Fundos_CDI.csv`.

> O app **publicado** lê apenas os CSVs versionados em `public/` (+ a planilha
> `Cadastro_Emissores` ao vivo). Os `tools/*.csv` são insumos dos scripts, não do app.
> Ao alterar o **schema** de um CSV, atualize os três lados: o script gerador em
> `tools/`, o `FIELDS`/parser em `src/utils/` e este documento.

---

## Git / workflow

- **Branch de trabalho atual:** `claude/claude-md-docs-vkvpee`. Desenvolva, faça
  commit e push nela; **não** faça push em `main` sem permissão explícita.
- `git push -u origin <branch>`; em falha de rede, tente de novo com backoff.
- **Não abra Pull Request** a menos que solicitado explicitamente.
- Mensagens de commit em português, curtas e descritivas (padrão do histórico:
  "Atualiza dados", "Usa contagem estatica da lista de fundos"). Commits de dados
  ("Atualiza dados") vêm do `publicar.bat`.

---

## Documentação relacionada

- **`README.md`** — visão geral, colunas obrigatórias, como rodar/atualizar/publicar.
- **`COMO-ATUALIZAR.md`** — manual de rotina (semanal/mensal) sem jargão, para o mantenedor.
- **`contexto_projeto.md`** — decisões de arquitetura e estado do projeto.
- **`ROADMAP.md`** — vocabulário de tabelas (códigos D1/C1/…), backlog priorizado e
  convenção de IDs (`GER-*`, `DEB-*`, `CAP-*`).

> Nota: partes do `README.md`/`contexto_projeto.md` podem estar levemente defasadas
> em relação ao código (ex.: as fontes de Debêntures migraram de GAS para estáticas;
> `FLUXO_IS_MOCK` já é `false`). Na dúvida, confie no código em `src/`.

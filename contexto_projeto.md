# Contexto do projeto — Debêntures CR

Documento de estado/decisões do projeto. Para instruções de uso (rodar, atualizar,
publicar), ver o [README.md](README.md). **Fonte da verdade é sempre o código.**

Última atualização: rentabilidade (%CDI por gestor) na aba **Captação**.

---

## O que é

Dashboard mobile-first (React 18 + Vite 5, deploy Vercel) com duas áreas:

- **Mercado** — abas Ativos / Gestores / Grupos. Lista de debêntures de infraestrutura,
  ranking de gestores e de grupos econômicos, com cross-filter estilo Power BI.
- **Captação** — aba de fluxo semanal (captações/resgates) de fundos de crédito.

Produção: https://debentures-dashboard-three.vercel.app
Repo: https://github.com/antoniocrsj/debentures-dashboard

---

## Arquitetura de dados

Sem backend próprio. Duas estratégias de origem, ambas centralizadas em hooks:

| Área | Hook | Fontes |
|------|------|--------|
| Mercado | `src/hooks/useDebentures.js` | 3 planilhas via Google Apps Script (emissores, fundos, debêntures) + `public/BLC_tratado.csv` estático |
| Captação | `src/hooks/useFluxo.js` | `public/data/Fluxo_Semanal_*.csv`, `Fluxo_Mensal_*.csv`, `Fluxo_Rentabilidade_*.csv` e `Fluxo_Meta.json` estáticos |

- **GAS + proxy CORS:** dev via middleware em `vite.config.js`; produção via
  `api/proxy.js` (serverless). Só as 3 planilhas passam por aí.
- **Arquivos estáticos** (`public/`) não passam pelo proxy — servidos direto pela CDN.
- `src/utils/data.js` (`FIELDS`) faz o de-para de colunas do Mercado; `src/utils/fluxo.js`
  tem as funções puras da Captação.

### Decisões-chave
- **BLC tratado por gestor:** o CDA bruto da CVM (~221 mil linhas, nível fundo) é
  pré-agregado por (ativo, gestor) → ~24,7 mil linhas / 717 KB. O app só mostra
  gestores e grupos, então o nível de fundo é descartado. PL por gestor vem do
  cadastro de fundos. Gerado mensalmente por `tools/preparar-blc.bat`.
- **Recharts lazy:** a aba Captação (e o Recharts, ~117 KB gz) só carrega ao ser
  aberta (`React.lazy`), preservando a carga inicial (~168 KB do bundle principal).
- **Captação decoupled:** a aba não depende do carregamento do BLC/debêntures —
  tem estado e dados próprios.

---

## Estado atual

### Pronto e em produção
- Abas Mercado (Ativos/Gestores/Grupos), cross-filter, modal de detalhes.
- BLC estático por gestor + fluxo mensal de 2 cliques (`preparar-blc.bat` + `publicar.bat`).
- PWA, proxy CORS (dev/prod), deploy automático na Vercel.

### Pronto e em produção (Captação)
- **Aba Captação** completa (filtros tipo/gestor/período, cards, gráfico combinado,
  tabela semanal, tabela mensal, ranking de gestores, estados de loading/erro/vazio).
- Roda com dados **reais** (`FLUXO_IS_MOCK = false` em `useFluxo.js`) desde que os
  CSVs de `public/data/` passaram a ser gerados por `preparar-fluxo.ps1`.
- **Rentabilidade (%CDI) por gestor** no ranking de gestores (C1): 5 colunas
  (1s/1m/3m/6m/12m), verde acima de 100% do CDI, vermelho se negativo. Cálculo:
  retorno diário da cota ponderado pelo PL de cada gestor, comparado ao CDI (API do
  Banco Central, SGS série 12). Ver detalhe em `ROADMAP.md` (CAP-1).
- Funções puras testadas (`test/fluxo.test.js`, `npm test`).

### Gerador das bases de Captação — pronto
- **`tools/preparar-fluxo.ps1`** (+ `.bat`) gera `Fluxo_Semanal_12431.csv`, `…_Trad.csv` e
  `public/PL_Gestores.csv` a partir do Informe Diário da CVM. Baixa os
  `inf_diario_fi_AAAAMM.zip` (cache em `C:\Projeto Crédito\CVM _informe_diario`), resolve
  CNPJ_FUNDO_CLASSE → Apelido_Gestor cruzando `tools/Fundos_12431.csv`/`Fundos_CDI.csv`
  (arquivos **locais**, com coluna CNPJ Gestor) + GAS `sheet=Cadastro_Gestores` — ver
  `tools/lib-cadastro.ps1`), calcula o fluxo semanal (seg–dom) por gestor e grava direto
  em `public/data/`.
- **Por que não `cad_fi.csv`?** Desde a Resolução CVM 175 o `CNPJ_FUNDO_CLASSE` (usado no
  Informe Diário) é o CNPJ da *classe*, que não existe no `cad_fi.csv` (cadastro nível
  *fundo*). Não há tabela pública única ligando classe → gestor, então o CNPJ do gestor
  fica na própria lista de fundos, mantido pelo usuário.
- **Decisão:** o spec pedia `fluxo_semanal.py`, mas a máquina do usuário não tem Python e
  o pipeline do BLC já é PowerShell de 1 clique — então o gerador ficou em PowerShell, no
  mesmo padrão. Versão Python pode ser feita sob demanda.
- **Cadastro manual (`tools/lista_12431.csv` / `lista_tradicional.csv`) foi descontinuado** —
  substituído inicialmente pelas abas `Fundos_12431` / `Fundos_CDI` da planilha
  `Cadastro_Credito` (GAS), e depois migrado pra `tools/Fundos_12431.csv` /
  `tools/Fundos_CDI.csv` (arquivos locais, versionados no git): nenhuma das duas é lida
  pelo app publicado (só pelos scripts), e viraram cada vez mais derivadas do CDA da CVM
  (`tools/selecionar-fundos.ps1`) — não fazia mais sentido pagar o preço da planilha (cache
  do Apps Script, encoding, etc.) pra dado que não é mais realmente manual. `Cadastro_Emissores`
  continua na planilha porque o app *lê ela ao vivo* e é genuinamente curadoria subjetiva
  (Grupo/Setor/Descrição). `sincronizar-fundos-planilha.ps1` existe caso precise trazer uma
  edição feita na planilha de volta pro CSV local.

### Pendente
- **Carga a frio do Mercado ~12s** — as 3 chamadas GAS ainda pesam; opção futura é
  tornar a base de debêntures estática (como o BLC).
- **Seletor de meses (BLC) sem ponto de entrada:** `App.jsx` ainda tem o estado
  (`showMonths`/`months`/`localStorage['blc-months']`) e o componente
  `MonthSelector.jsx`, mas o botão do header que abria essa tela foi removido (GER-2) e
  nada mais aciona `setShowMonths(true)` — hoje é código morto. Decisão pendente:
  recriar um jeito de abrir (ex.: ícone no header) ou remover o recurso de vez, já que
  o app sempre lê um único `BLC_tratado.csv` estático.

---

## Limitações conhecidas
- Nº de fundos no ranking de captação = média por semana (não fundos únicos no período);
  a base agregada não permite recuperar o distinto. Documentado em `utils/fluxo.js`.
- Captação mostra o período coberto pelos CSVs; histórico depende do que o script gerar.

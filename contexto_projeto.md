# Contexto do projeto — Debêntures CR

Documento de estado/decisões do projeto. Para instruções de uso (rodar, atualizar,
publicar), ver o [README.md](README.md). **Fonte da verdade é sempre o código.**

Última atualização: implementação da aba **Captação**.

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
| Captação | `src/hooks/useFluxo.js` | `public/data/Fluxo_Semanal_12431.csv` e `…_Trad.csv` estáticos |

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

### Pronto, aguardando dados reais
- **Aba Captação** completa (filtros tipo/gestor/período, cards, gráfico combinado,
  tabela semanal, ranking de gestores, estados de loading/erro/vazio).
- **Roda com CSVs MOCK** em `public/data/` (banner de aviso enquanto
  `FLUXO_IS_MOCK = true` em `useFluxo.js`).
- Funções puras testadas (`test/fluxo.test.js`, `npm test`).

### Pendente
- **`tools/fluxo_semanal.py`** — script que gera as bases reais da Captação a partir do
  Informe Diário da CVM (`inf_diario_fi_AAAAMM.zip`) + listas `lista_12431.csv` /
  `lista_tradicional.csv`. Ainda não implementado (decidiu-se validar a UI com mock
  primeiro). Quando existir: gerar os CSVs, copiar para `public/data/`, virar
  `FLUXO_IS_MOCK` para `false`.
- **Carga a frio do Mercado ~12s** — as 3 chamadas GAS ainda pesam; opção futura é
  tornar a base de debêntures estática (como o BLC).
- **Seletor de meses (BLC)** ainda visível mas inerte: `useDebentures` lê sempre o
  `BLC_tratado.csv` estático, então trocar de mês não muda os dados.

---

## Limitações conhecidas
- Nº de fundos no ranking de captação = média por semana (não fundos únicos no período);
  a base agregada não permite recuperar o distinto. Documentado em `utils/fluxo.js`.
- Captação mostra o período coberto pelos CSVs; histórico depende do que o script gerar.

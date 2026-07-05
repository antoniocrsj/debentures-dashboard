# 📅 Como atualizar o app — rotina SEMANAL

Manual rápido e sem jargão. A atualização normal é **toda semana** e leva **2 cliques**.
Uma vez por mês tem um passo extra (a base de alocação). Nada disso exige abrir terminal
nem mexer em planilha.

> **Onde ficam os arquivos:** tudo está na pasta `tools\` dentro do projeto
> (`debentures-dashboard\tools\`). Você só dá **duplo-clique** nos `.bat`.

---

## ⚡ TL;DR (a rotina de toda semana)

1. **Duplo-clique** em `tools\preparar-fluxo.bat` → espere terminar.
2. **Duplo-clique** em `tools\publicar.bat` → espere aparecer **"Pronto!"**.

Pronto. Em ~1 minuto o app no ar já está atualizado (mesma URL de sempre).

> **Atalho "faz tudo":** `tools\atualizar-tudo.bat` roda Debêntures + Captação + BLC
> (só se o mês novo ainda não estiver registrado) + ANBIMA em sequência e no final
> pergunta se quer publicar — um único duplo-clique em vez dos passos manuais abaixo.
> O passo a passo desta página continua valendo se preferir rodar/conferir uma base
> de cada vez.

> **Prefere uma tela em vez do `.bat` preto?** Rode `npm run dev` na pasta do
> projeto e clique no ícone tracejado (⚙) no topo do app — abre um painel de
> controle com escolha de modo (Auto/Incremental/Completa), log ao vivo e
> botões de fundos/publicar, sem precisar decorar nomes de script. Só funciona
> rodando localmente assim, nunca no site publicado.

---

## 🗓️ O que atualizar e com que frequência

| Base | O que é | Frequência | Como |
|------|---------|-----------|------|
| **Captação** (aba Captação) | Captações e resgates semanais dos fundos | **Toda semana** | `preparar-fluxo.bat` |
| **Alocação / BLC** (abas Gestores e Grupos) | Quanto cada gestor aloca em cada debênture | **1× por mês** | `preparar-blc.bat` |

> **Por que a Alocação é só mensal?** A CVM publica a carteira dos fundos (o arquivo CDA)
> **uma vez por mês**. Não adianta rodar toda semana — o dado não muda. Já a base de
> Captação vem do **Informe Diário**, que a CVM atualiza o tempo todo; por isso ela é semanal.

---

## ✅ Passo a passo — rotina SEMANAL (Captação)

### Passo 1 — Gerar a base nova
Duplo-clique em **`tools\preparar-fluxo.bat`**.

- Ele baixa sozinho o **Informe Diário** mais recente da CVM e recalcula o fluxo semanal.
- Os meses antigos ficam em cache (não rebaixa). **Os 2 meses mais recentes são sempre
  atualizados**, então a semana nova sempre entra.
- Vai abrir uma janela preta com o progresso. **Espere** até aparecer o relatório final
  com `Arquivos gerados`. Pode levar de **1 a 5 minutos** (depende da internet).
- Pode fechar a janela quando terminar.

### Passo 2 — Publicar
Duplo-clique em **`tools\publicar.bat`**.

- Ele sobe os arquivos novos para o ar.
- Espere aparecer a mensagem **"Pronto! O app atualiza no ar em ~1 minuto."**
- Aguarde ~1 minuto e atualize o app no navegador (a URL é a mesma de sempre).

**Acabou.** Esses são os 2 cliques da semana.

---

## 🧩 Passo extra — 1× por mês (Alocação / BLC)

Faça isto **uma vez por mês**, quando a CVM soltar o CDA novo (carteira dos fundos):

1. Duplo-clique em **`tools\preparar-blc.bat`** → baixa o CDA direto da CVM (mês mais
   recente já fechado) e gera a base de alocação (~3 min). Não precisa baixar nada
   manualmente.
2. Duplo-clique em **`tools\publicar.bat`** → sobe pro ar.

> Dica: dá pra publicar tudo junto. Se no mesmo dia você rodar **`preparar-fluxo`** e
> **`preparar-blc`**, basta **um** `publicar.bat` no final — ele sobe as duas bases de uma vez.

---

## 📊 Coluna "Tx Anbima" (etapa separada, quando você quiser)

A coluna **Tx Anbima** da tabela de Ativos usa a precificação pública diária da ANBIMA.
É uma etapa **independente** (não entra na rotina semanal automática) — rode quando quiser
atualizar essa coluna.

**Requisito:** Microsoft Excel instalado (o arquivo da ANBIMA é um `.xls` antigo, lido pelo Excel).

1. Duplo-clique em **`tools\preparar-anbima.bat`** → baixa sozinho os arquivos públicos da
   ANBIMA (debêntures + títulos públicos da última data útil), calcula tudo e gera
   `public\Anbima_Tx.csv` (~1–2 min).
2. Duplo-clique em **`tools\publicar.bat`** → sobe pro ar.

**Data específica:** `preparar-anbima.bat -Data 2026-06-26`

**Modo manual** (se o download automático falhar): baixe os arquivos do site da ANBIMA e rode
`preparar-anbima.bat -DebFile "caminho\d26jun26.xls" -TpfFile "caminho\ms260626.txt"`.

O que cada taxa significa: `CDI + X%` (spread sobre o CDI), `B35 + N bps` (spread vs a NTN-B
de referência), `17,30%` (prefixado), `—` (sem dado na ANBIMA). A data de referência aparece
no tooltip do cabeçalho da coluna. Se a ANBIMA mudar uma URL ou o arquivo do dia faltar, o app
**não quebra**: a coluna mostra `—` e a base anterior é preservada.

---

## 🆘 Se der errado

| O que aconteceu | O que fazer |
|-----------------|-------------|
| A janela fechou sozinha rápido demais | Rode de novo; se repetir, me chame com uma foto da tela. |
| Apareceu **"indisponivel (pulando)"** num mês | Normal se for um mês muito antigo ou o atual ainda sem dados. Se for o mês atual e persistir, tente de novo mais tarde (a CVM pode estar fora do ar). |
| `publicar.bat` pediu usuário/senha ou deu erro de `git` | Me chame — provavelmente é só reconectar o login do GitHub. |
| Rodei tudo mas o app **não mudou** | Espere ~2 min e atualize a página com **Ctrl + F5**. Se ainda assim não mudar, confira se o `publicar.bat` mostrou **"Pronto!"**. |
| Quero reprocessar um mês específico | Abra o `tools\` e rode pelo nome com os meses: `preparar-fluxo.bat -Meses 202606,202607`. |

> ⚠️ **Sempre** dê duplo-clique nos `.bat` **dentro da pasta `tools\`**. Não digite o nome
> deles num terminal de outra pasta — aí dá erro.

---

## 📋 Checklist da semana (para imprimir/colar)

- [ ] Duplo-clique em `preparar-fluxo.bat` e esperei o relatório final
- [ ] Duplo-clique em `publicar.bat` e vi **"Pronto!"**
- [ ] Esperei ~1 min e conferi o app atualizado (Ctrl + F5)
- [ ] *(1× no mês)* Rodei também o `preparar-blc.bat` com o CDA novo

---

### Resumo de uma linha
**Toda semana:** `preparar-fluxo.bat` → `publicar.bat`. **Uma vez no mês:** + `preparar-blc.bat` antes de publicar.

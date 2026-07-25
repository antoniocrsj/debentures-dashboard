# tools/books

Books de **mercado primário** (bookbuilding do CRM). O parser
(`tools/parsear-books.mjs`) monta `public/data/Books_Primario.csv` (1 linha por
série, casada ao **Grupo** do emissor em `public/Emissores.csv`).

## Fonte canônica: a Ana

O jeito recomendado de cadastrar um book novo é **colar na Ana** (painel →
"📌 Colar book do CRM"). A Ana arquiva a fonte crua e a expõe em
`GET /api/v1/books/export`. Na atualização, o parser:

1. **semeia** do `Books_Primario.csv` atual (preserva todo o histórico);
2. puxa o export da Ana e faz **upsert** dos books por chave natural
   (`DataBook|Grupo|EmissorRaw|Série|Prazo`) — nada se perde, nada duplica;
3. grava o CSV + `Books_Meta.json` (fonte, novos, atualizados, total).

Ana fora do ar → **fallback barulhento**: o CSV é preservado e a atualização
segue (não trava). URL sobrescrita por `ANA_BOOKS_URL`.

## Bootstrap / reconciliação por .txt (opcional)

Um **export de conversa** do WhatsApp do grupo "CRM Books" (`.txt`, exportado
Sem mídia) colocado aqui ainda é lido como fonte adicional e mesclado (upsert).
Serve para carregar o histórico de uma vez ou reconciliar. Os `.txt` **não** são
versionados (dado de grupo privado — ver `.gitignore`); só o CSV gerado é publicado.

    node tools/parsear-books.mjs                 # Ana (+ .txt se houver)
    node tools/parsear-books.mjs export.txt      # força um .txt específico

Também roda no passo "Books (mercado primário)" do `atualizar-tudo.ps1`.

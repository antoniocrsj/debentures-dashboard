# tools/books

Coloque aqui o **export de conversa** do grupo de WhatsApp **"CRM Books"**
(bookbuilding de mercado primário), em `.txt` (WhatsApp > Exportar conversa >
Sem mídia). O parser usa automaticamente o `.txt` mais recente desta pasta.

    node tools/parsear-books.mjs

Gera `public/data/Books_Primario.csv` (1 linha por série) + `Books_Meta.json`,
casando cada book ao **Grupo** do emissor (`public/Emissores.csv`). Também roda
no passo "Books (mercado primário)" do `atualizar-tudo.ps1`.

Os arquivos `.txt` **não** são versionados (dado de grupo privado) — veja o
`.gitignore`. Só o CSV gerado (agregado, casado por grupo) é publicado.

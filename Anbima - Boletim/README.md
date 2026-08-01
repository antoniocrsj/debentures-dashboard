# Anbima - Boletim (input do gráfico Emissões)

Coloque aqui o **Boletim de Mercado de Capitais** da ANBIMA (o anexo `.xlsx`,
ex.: `Boletim_MK_Anexo_v1_*.xlsx`). O xlsx **não** é versionado (é grande, ~4 MB/mês).

Depois de trocar o arquivo, rode:

```bash
node tools/preparar-emissoes-anbima.mjs
```

Isso lê a aba `08-05-Vlr-Det` (Subscritores de debêntures por tipo) e gera:

- `public/Emissoes_ANBIMA.csv` — `Mes,Total,Fundos` (versionado; é o que o app lê)
- `public/Emissoes_ANBIMA_meta.json` — referência + conciliação

O gráfico **Emissões** (aba Técnico, desktop) mostra, mês a mês, o total emitido
e a parcela subscrita por **Fundos de Investimento** (barra preenchida).

Também dá pra apontar um arquivo específico:

```bash
node tools/preparar-emissoes-anbima.mjs "C:/caminho/para/Boletim.xlsx"
```

> Ressalva: os 1–2 meses mais recentes subestimam "Fundos" (ofertas ainda não
> encerradas ficam no balde "Intermediários" e só depois migram para o investidor final).

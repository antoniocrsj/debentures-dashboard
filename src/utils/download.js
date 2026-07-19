// Nome de arquivo do download por modo/periodo:
//   daily   -> resumo-do-dia-AAAA-MM-DD.<ext>
//   weekly  -> resumo-da-semana-AAAA-Www.<ext>
//   monthly -> resumo-do-mes-AAAA-MM.<ext>
// O `id` ja carrega o formato certo (date / isoWeekId / monthId), entao o nome
// e' deterministico e casa com o arquivo pre-gerado em public/reports/<modo>/.
const DL_PREFIXO = { daily: 'resumo-do-dia', weekly: 'resumo-da-semana', monthly: 'resumo-do-mes' }
export function downloadName(mode, id, ext) {
  return `${DL_PREFIXO[mode] || 'resumo'}-${id}.${ext}`
}

// Baixa um arquivo estático (já gerado em public/) como download no navegador.
// O relatório é sempre pré-gerado pelo pipeline — nada é montado no cliente.
export async function downloadFile(url, filename) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`)
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename || url.split('/').pop() || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objUrl)
}

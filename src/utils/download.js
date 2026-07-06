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

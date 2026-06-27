/**
 * Robust CSV parser:
 * - Handles quoted fields (with embedded commas/newlines)
 * - Trims all header names
 * - Skips blank rows
 * - Detects HTML error pages from GAS
 */
export function parseCSV(raw) {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  if (text.startsWith('<')) {
    throw new Error(
      'O Apps Script retornou HTML em vez de CSV. ' +
      'Verifique se o script está publicado corretamente e se a URL está certa.'
    )
  }

  const lines = text.split('\n')
  if (lines.length < 2) return []

  const headers = splitLine(lines[0]).map(h => h.trim())

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const vals = splitLine(line)
    const row = {}
    headers.forEach((h, idx) => {
      if (h) row[h] = (vals[idx] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

function splitLine(line) {
  const result = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur)
  return result
}

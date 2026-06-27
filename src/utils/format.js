/** Parse Brazilian or US formatted number strings */
export function parseNum(str) {
  if (str == null || str === '') return 0
  // Brazilian: "1.234.567,89" → remove dots, swap comma→dot
  // US: "1234567.89" → keep as-is
  const s = String(str).trim().replace(/\s/g, '')
  // If has both dot and comma, it's Brazilian format
  if (s.includes('.') && s.includes(',')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
  }
  // If only comma (no dot), it's BR decimal
  if (s.includes(',') && !s.includes('.')) {
    return parseFloat(s.replace(',', '.')) || 0
  }
  return parseFloat(s) || 0
}

/** Strip non-digit chars from CNPJ/CPF for comparison */
export function normCNPJ(cnpj) {
  return (cnpj || '').replace(/\D/g, '')
}

const R$ = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Compact BRL — shows Bi/M/K suffix for large values */
export function fmtBRL(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `R$ ${(n / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}Bi`
  if (abs >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`
  if (abs >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}K`
  return R$.format(n)
}

/** Full BRL with two decimals */
export function fmtBRLFull(n) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

/** Display a date string — converts ISO (YYYY-MM-DD) to DD/MM/YYYY, leaves others as-is */
export function fmtDate(str) {
  if (!str) return '—'
  const s = str.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return s
}

/** Short date — just MM/YY or MMM/YY */
export function fmtDateShort(str) {
  if (!str) return '—'
  const full = fmtDate(str)
  const parts = full.split('/')
  if (parts.length === 3) {
    const [, m, y] = parts
    return `${m}/${y.slice(-2)}`
  }
  return full
}

/** Display a taxa/rate string */
export function fmtTaxa(str) {
  if (!str) return '—'
  return str.trim()
}

/** Normalize a boolean-like field (Sim/S/1/true) */
export function isYes(str) {
  return /^(s|sim|yes|1|true|x)$/i.test((str || '').trim())
}

/** Sort key for date fields in DD/MM/YYYY format */
export function dateKey(str) {
  if (!str) return ''
  const d = fmtDate(str)
  const parts = d.split('/')
  if (parts.length === 3) return `${parts[2]}${parts[1].padStart(2, '0')}${parts[0].padStart(2, '0')}`
  return d
}

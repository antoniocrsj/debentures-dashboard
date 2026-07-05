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

/** Display a date string — handles ISO, DD/MM/YYYY, and JS Date strings */
export function fmtDate(str) {
  if (!str) return '—'
  const s = str.trim()
  // ISO: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  // BR: DD/MM/YYYY already
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  // JS Date string from GAS: "Wed Oct 03 2029 04:00:00 GMT..."
  if (s.includes('GMT') || s.match(/^[A-Z][a-z]{2}\s/)) {
    const d = new Date(s)
    if (!isNaN(d)) {
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yyyy = d.getFullYear()
      return `${dd}/${mm}/${yyyy}`
    }
  }
  return s
}

const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']

/** Short date — MMM/YY ex: jun/26 */
export function fmtDateShort(str) {
  if (!str) return '—'
  const full = fmtDate(str)
  const parts = full.split('/')
  if (parts.length === 3) {
    const [, m, y] = parts
    const mes = MESES[parseInt(m, 10) - 1] || m
    return `${mes}/${y.slice(-2)}`
  }
  return full
}

/** Short date — DD/MM/YY ex: 03/10/29 */
export function fmtDateDDMMYY(str) {
  if (!str) return '—'
  const full = fmtDate(str)
  const parts = full.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    return `${d}/${m}/${y.slice(-2)}`
  }
  return full
}

/** Formata um Date como DD/MM/AAAA */
export function fmtDateOnly(d) {
  if (!d || isNaN(d)) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

/** Parseia "DD/MM/AAAA[ HH:MM[:SS]]" (ex: gerado em Debentures_meta.json) */
export function parseBRDateTime(str) {
  if (!str) return null
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, d, mo, y, h, mi, s] = m
  return new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0))
}

/** Parseia "AAAA-MM-DD" (ISO, ex: dataReferenciaAnbima) como data local */
export function parseISODate(str) {
  if (!str) return null
  const m = String(str).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return new Date(+y, +mo - 1, +d)
}

/** "202602" -> "fev/2026" (mes de referencia do BLC/CDA, ex: BLC_meta.json) */
export function fmtMesAno(mesAno) {
  if (!mesAno || mesAno.length !== 6) return ''
  const y = mesAno.slice(0, 4)
  const m = parseInt(mesAno.slice(4, 6), 10)
  return `${MESES[m - 1] || m}/${y}`
}

/** Percentual — 1 casa decimal com vírgula, ex: 12,3% */
export function fmtPct(n) {
  if (n == null || isNaN(n)) return '—'
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/** Display a taxa/rate — 2 decimal places with comma */
export function fmtTaxa(str) {
  if (!str) return '—'
  const s = str.trim()
  const n = parseFloat(s.replace(',', '.'))
  if (!isNaN(n)) return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return s
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

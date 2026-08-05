// Helpers COMPARTILHADOS do card de oferta do SRE — usados tanto pelo render HTML
// dos relatórios (tools/relatorios/card-sre.mjs) quanto pelo modal React
// (components/ResumoDoDiaModal.jsx). Só lógica pura (sem HTML/JSX).

// Razão social do coordenador -> sigla curta da mesa (dicionário do usuário).
const SIGLAS = [
  [/\bBTG\b/, 'BTG'],
  [/ITA[UÚ].*BBA|\bBBA\b/, 'BBA'],
  [/BRADESCO.*BBI|\bBBI\b/, 'BBI'],
  [/\bXP\b/, 'XP'],
  [/VOTORANTIM|\bBV\b/, 'BV'],
  [/SAFRA/, 'Safra'],
  [/SANTANDER|\bSAN\b/, 'SAN'],
  [/CAIXA|\bCEF\b/, 'CEF'],
  [/\bUBS\b/, 'UBS BB'],
  [/DAYCOVAL|\bDAY\b/, 'DAY'],
  [/\bABC\b/, 'ABC'],
  [/ITA[UÚ].*UNIBANCO|ITA[UÚ]\b/, 'Itaú'],
  [/BANCO DO BRASIL|\bBB\b/, 'BB'],
  [/MORGAN STANLEY/, 'Morgan'],
  [/CITI/, 'Citi'],
  [/J\.?P\.?\s*MORGAN|JPMORGAN/, 'JPM'],
  [/GENIAL/, 'Genial'],
  [/BofA|MERRILL|BANK OF AMERICA/, 'BofA'],
]
export function siglaBanco(razao) {
  const u = String(razao || '').toUpperCase()
  for (const [re, sig] of SIGLAS) if (re.test(u)) return sig
  const w = u.replace(/\b(BANCO|S\.?A\.?|LTDA|CCTVM|DTVM|INVESTMENT|BANKING|ASSESSORIA|FINANCEIRA)\b/g, ' ')
    .replace(/[^A-ZÀ-Ú ]/g, ' ').trim().split(/\s+/)[0] || razao || '—'
  return w.charAt(0) + w.slice(1).toLowerCase()
}

// valor total: R$ X,XX bi / R$ XXX MM
export function fmtValorCurto(v) {
  const n = Number(v) || 0
  if (n >= 1e9) return `R$ ${(n / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bi`
  if (n >= 1e6) return `R$ ${Math.round(n / 1e6).toLocaleString('pt-BR')} MM`
  return `R$ ${n.toLocaleString('pt-BR')}`
}

// dd/MM/yyyy a partir de "yyyy-MM-dd" OU "dd/MM/yyyy" (passa reto).
export function fmtDataDia(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—')
}
// data curta "15/02/33"
export function fmtDataCurta(d) {
  const s = fmtDataDia(d); const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3].slice(2)}` : s
}
// rótulo do vencimento: "10y bullet" / "7y amort." / "15/02/36"
export function tenorAmort(s) {
  const tenor = s.tenor != null ? `${s.tenor}y` : ''
  const amort = s.amort === 'amort' ? 'amort.' : s.amort === 'bullet' ? 'bullet' : (s.amort || '')
  return [tenor, amort].filter(Boolean).join(' ') || '—'
}
// Número do spread final (pós-bookbuilding) para o "(final X%)" ao lado da
// remuneração. Extrai só o número+% do texto (ex.: "DI + 0,72%" -> "0,72%",
// "IPCA − 0,53%" -> "−0,53%"). null quando não há número.
export function spreadFinalCurto(str) {
  const m = String(str || '').match(/([+−–-]?)\s*(\d+(?:[.,]\d+)?)\s*%/)
  if (!m) return null
  const neg = /[−–-]/.test(m[1])
  return `${neg ? '−' : ''}${m[2].replace('.', ',')}%`
}

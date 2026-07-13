// Selo discreto de confiabilidade da carteira dos fundos (CDA/BLC). O CDA vai
// "enchendo" ao longo dos meses; este selo mostra se o mês em uso já está
// completo o suficiente. verde = confiável · amarelo = quase completa ·
// vermelho = ainda enchendo. Alimentado por public/BLC_maturidade.json.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function fmtMes(mesAno) {
  const s = String(mesAno || '')
  if (s.length < 6) return s
  return `${MESES[+s.slice(4, 6) - 1] || s}/${s.slice(2, 4)}`
}
const TXT = { verde: 'confiável', amarelo: 'quase completa', vermelho: 'ainda enchendo' }

export default function BlcMaturitySelo({ maturidade }) {
  if (!maturidade || !maturidade.status) return null
  const { status, mesAno, cobertura, reportaram, totalLista, razao } = maturidade
  const pct = cobertura != null ? Math.round(cobertura * 100) : null
  const label = TXT[status] || status
  const title =
    `Carteira dos fundos (CDA/BLC) de ${fmtMes(mesAno)}: ${reportaram} de ${totalLista} fundos da lista reportaram` +
    (pct != null ? ` (${pct}%)` : '') +
    (razao != null ? ` · ${Math.round(razao * 100)}% do mês anterior` : '')
  return (
    <div className={`blc-selo blc-selo-${status}`} title={title}>
      <span className="blc-selo-dot" aria-hidden="true" />
      Carteira (BLC) {fmtMes(mesAno)} · {label}{pct != null ? ` · ${pct}%` : ''}
    </div>
  )
}

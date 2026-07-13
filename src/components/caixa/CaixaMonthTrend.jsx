import { fmtMes } from '../../utils/caixa.js'
import { fmtFluxo } from '../../utils/fluxo.js'

// Barras CSS (sem Recharts) da evolucao do caixa direto do universo curado por
// mes: meses recentes + referencia madura. Destaca a tendencia (queda/alta).
export default function CaixaMonthTrend({ comparacao, mesRefMadura }) {
  const rows = Array.isArray(comparacao) ? comparacao : []
  if (rows.length < 2) return null
  const max = Math.max(...rows.map(r => r.CaixaDireto || 0)) || 1

  return (
    <div className="caixa-trend" aria-label="Evolução do caixa direto por mês">
      <div className="caixa-trend-head">
        <h3 className="fluxo-section-title">Caixa direto do universo curado por mês</h3>
        <span className="fluxo-ranking-sub">Disponibilidades + títulos públicos + compromissadas (posições abertas + confidenciais)</span>
      </div>
      <div className="caixa-trend-bars">
        {rows.map(r => {
          const v = r.CaixaDireto || 0
          const pct = Math.max(2, (v / max) * 100)
          const madura = r.Mes === mesRefMadura
          return (
            <div className="caixa-bar-col" key={r.Mes} title={`${fmtMes(r.Mes)}: ${fmtFluxo(v)} — ${r.FundosCaixaConfirmados} fundos caixa confirmados, ${r.Candidatos} candidatos`}>
              <span className="caixa-bar-val">{fmtFluxo(v)}</span>
              <div className="caixa-bar-track">
                <div className={`caixa-bar-fill${madura ? ' madura' : ''}`} style={{ height: `${pct}%` }} />
              </div>
              <span className="caixa-bar-mes">
                {fmtMes(r.Mes)}{madura && <span className="caixa-bar-tag" title="Referência madura (fora da janela de retificação da CVM)"> ref</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

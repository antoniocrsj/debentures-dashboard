// Barras de VOLUME DE EMISSÕES por mês. Mesma pegada visual do MonthBars
// (Vencimentos) — reusa as classes .venc-* (plot, coluna, baseline, eixo
// vertical) pra ficar idêntico ao gráfico de cima. Diferenças: série ÚNICA (não
// empilha juros/amort), barra BRANCA com contorno TERRACOTA, e não é clicável
// (emissão é lado do emissor, não filtra a aba). Valor de cada mês vai no
// tooltip da coluna — com 12 meses não cabe um rótulo em cima de cada barra.
export default function EmissoesBars({ rows, max, fmtVal, ariaLabel }) {
  const safeMax = Math.max(1e-9, max)
  return (
    <div className="venc-chart emissoes-chart" role="img" aria-label={ariaLabel}>
      <div className="venc-plot">
        {rows.map(m => {
          const barPct = (m.total / safeMax) * 88
          return (
            <div key={m.mes} className="venc-col emissoes-col"
              title={`${m.label}: ${fmtVal(m.total)}`}>
              {/* Reserva o mesmo topo do MonthBars (paridade de altura), sem texto. */}
              <span className="venc-bar-total" aria-hidden="true" />
              <span className="venc-bar-wrap emissoes-bar" style={{ height: `${barPct}%` }} />
            </div>
          )
        })}
      </div>
      <div className="venc-baseline" aria-hidden="true" />
      <div className="venc-axis">
        {rows.map(m => <span key={m.mes} className="venc-lbl">{m.label}</span>)}
      </div>
    </div>
  )
}

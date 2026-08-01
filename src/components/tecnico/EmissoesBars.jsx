// Barras de EMISSÃO de debêntures por mês (ANBIMA), com a parcela que foi para
// FUNDOS DE INVESTIMENTO preenchida. Reusa as classes .venc-* (plot, coluna,
// baseline, eixo) pra ficar igual ao gráfico de cima. A barra inteira = total
// emitido no mês (branca, contorno terracota); o preenchimento terracota no PÉ
// da barra = quanto foi subscrito por fundos (a diferença até o topo = resto).
// Como a .venc-bar-wrap é flex column-reverse, o filho .emissoes-fundos assenta
// no fundo. Acima de cada barra vão os DOIS montantes: total e fundos.
export default function EmissoesBars({ rows, max, fmtVal, fmtLabel, ariaLabel }) {
  const safeMax = Math.max(1e-9, max)
  return (
    <div className="venc-chart emissoes-chart" role="img" aria-label={ariaLabel}>
      <div className="venc-plot">
        {rows.map(m => {
          const barPct = (m.total / safeMax) * 84
          const fundosPct = m.total > 0 ? Math.min(100, (m.fundos / m.total) * 100) : 0
          return (
            <div key={m.mes} className="venc-col emissoes-col"
              title={`${m.label}: emitido ${fmtVal(m.total)} · fundos ${fmtVal(m.fundos)}`}>
              {/* Montantes acima da barra: total (escuro) e fundos (terracota). */}
              <span className="venc-bar-total emissoes-lbl">
                {m.total > 0.00001 && (
                  <>
                    <span className="emissoes-lbl-total">{fmtLabel(m.total)}</span>
                    <span className="emissoes-lbl-fundos">{fmtLabel(m.fundos)}</span>
                  </>
                )}
              </span>
              <span className="venc-bar-wrap emissoes-bar" style={{ height: `${barPct}%` }}>
                <span className="emissoes-fundos" style={{ height: `${fundosPct}%` }} />
              </span>
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

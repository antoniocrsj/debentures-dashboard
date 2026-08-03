// Barras de EMISSÃO de debêntures por mês (ANBIMA), com a parcela que foi para
// FUNDOS DE INVESTIMENTO preenchida. Reusa as classes .venc-* (plot, coluna,
// baseline, eixo). A barra inteira = total emitido no mês (branca, contorno
// terracota); o preenchimento terracota no PÉ = quanto foi para fundos.
// Se `onBarClick` for passado, cada barra vira um botão (clicar dispara o
// drill-down da tabela Ativos daquele mês); `selectedMes` marca a barra ativa.
export default function EmissoesBars({ rows, max, fmtVal, fmtLabel, ariaLabel, onBarClick, selectedMes }) {
  const safeMax = Math.max(1e-9, max)
  const clickable = typeof onBarClick === 'function'
  return (
    <div className="venc-chart emissoes-chart" role="img" aria-label={ariaLabel}>
      <div className="venc-plot">
        {rows.map(m => {
          const barPct = (m.total / safeMax) * 84
          const fundosPct = m.total > 0 ? Math.min(100, (m.fundos / m.total) * 100) : 0
          const sel = selectedMes === m.mes
          return (
            <div key={m.mes}
              className={`venc-col emissoes-col${clickable ? ' emissoes-col-click' : ''}${sel ? ' sel' : ''}`}
              title={`${m.label}: emitido ${fmtVal(m.total)}${m.fonte === 'cvm' ? ' · base CVM' : ` · fundos ${fmtVal(m.fundos)}`}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-pressed={clickable ? sel : undefined}
              onClick={clickable ? () => onBarClick(m.mes) : undefined}
              onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBarClick(m.mes) } }) : undefined}>
              {/* Montantes acima da barra: total (escuro) e, quando há parcela
                  de fundos (ANBIMA), fundos (terracota). Nos meses da base CVM não
                  há quebra por fundos -> só o total. */}
              <span className="venc-bar-total emissoes-lbl">
                {m.total > 0.00001 && (
                  <>
                    <span className="emissoes-lbl-total">{fmtLabel(m.total)}</span>
                    {m.fundos > 0.00001 && <span className="emissoes-lbl-fundos">{fmtLabel(m.fundos)}</span>}
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

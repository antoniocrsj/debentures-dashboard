// Barras empilhadas (juros + amortizacao) por mes; cada coluna filtra o mes.
// Extraido de VencimentosDashboard.jsx pra ser reaproveitado pela aba Tecnico
// (mesmo grafico, filtrado a um gestor/segmento especifico).
// `compacto` (aba Tecnica, card de ~329px): 12 meses nao cabem escritos nem
// com um valor em cima de cada barra. Nesse modo o eixo mostra so' os FINS DE
// TRIMESTRE (mesma regua do grafico de caixa) e os valores saem das barras --
// continuam no tooltip de cada coluna, que ja' traz juros, amortizacao e total.
export default function MonthBars({ rows, max, selMes, onPick, fmtVal, fmtLabel, ariaLabel, compacto = false }) {
  const safeMax = Math.max(1e-9, max)
  const MIN_SEG = 0.10
  return (
    <div className="venc-chart" role="group" aria-label={ariaLabel}>
      <div className="venc-plot">
        {rows.map(m => {
          const barPct = (m.total / safeMax) * 88
          const jPct = m.total > 0 ? (m.juros / m.total) * 100 : 0
          const aPct = m.total > 0 ? (m.amort / m.total) * 100 : 0
          const showJ = m.juros / safeMax >= MIN_SEG
          const showA = m.amort / safeMax >= MIN_SEG
          return (
            <button key={m.mes} type="button"
              className={`venc-col${selMes === m.mes ? ' sel' : ''}`}
              title={`${m.label}: juros ${fmtVal(m.juros)} + amort. ${fmtVal(m.amort)} = ${fmtVal(m.total)} — clique para ${selMes === m.mes ? 'limpar o filtro' : 'filtrar'}`}
              onClick={() => onPick(m.mes)} aria-pressed={selMes === m.mes}>
              <span className="venc-bar-total">{m.total > 0.00001 ? fmtLabel(m.total) : ''}</span>
              <span className="venc-bar-wrap" style={{ height: `${barPct}%` }}>
                <span className="venc-seg venc-seg-juros" style={{ height: `${jPct}%` }}>
                  {showJ && !compacto && <span className="venc-seg-lbl">{fmtLabel(m.juros)}</span>}
                </span>
                <span className="venc-seg venc-seg-amort" style={{ height: `${aPct}%` }}>
                  {showA && !compacto && <span className="venc-seg-lbl">{fmtLabel(m.amort)}</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="venc-baseline" aria-hidden="true" />
      <div className="venc-axis">
        {rows.map(m => {
          // fim de trimestre: 'AAAA-MM' -> mes divisivel por 3
          const fimTri = (+String(m.mes).slice(5, 7)) % 3 === 0
          const mostra = !compacto || fimTri
          return (
            <span key={m.mes} className={`venc-lbl${selMes === m.mes ? ' sel' : ''}`}>
              {mostra ? m.label : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

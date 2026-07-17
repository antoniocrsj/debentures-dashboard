import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { toChartSeries, fmtDayMonthYY, fmtWeekFull, fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

// Paleta quente (identidade Luc), legível sobre o card claro
const COL_CAP = '#8c5e3a'  // captação — terracota
const COL_RES = '#9a8c7a'  // resgate — taupe/cinza quente
const COL_LIQ = '#2a2420'  // cap. líquida — carvão quente, alto contraste
const COL_ZERO = '#94a3b8' // linha do zero — cinza discreto mas visível

// Eixo Y compacto, sem "R$"
const axisFmt = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}bi`
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mi`
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mil`
  return String(v)
}

function FluxoTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="fluxo-tooltip">
      <div className="fluxo-tooltip-title">Semana de {fmtWeekFull(label)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_CAP }} />Captação: {fmtFluxoSigned(row.captacao)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_RES }} />Resgate: {fmtFluxoSigned(-row.resgate)}</div>
      <div className="fluxo-tooltip-row"><span className="dot" style={{ background: COL_LIQ }} />Cap. líquida: {fmtFluxoSigned(row.liquido)}</div>
      <div className="fluxo-tooltip-row fluxo-tooltip-pl">PL total: {fmtFluxo(row.plTotal)}</div>
    </div>
  )
}

// Largura da barra por tamanho da janela (n de semanas na serie). Valores
// escolhidos a olho pelo usuario, medidos no grafico: 3m=14px, 6m=8px,
// 12m/tudo=4,5px; janelas curtas (1s, 1 mes) ficam nos 26px de sempre.
// E' barSize (largura EXATA) e nao maxBarSize (teto) de proposito: o teto
// deixava o Recharts esticar a barra ate' encher a categoria -- em 3 meses ela
// batia nos 26px. Por n de semanas, e nao pelo chip de periodo, p/ valer
// tambem no "todo o historico" e em faixa de data custom, sem prop nova.
// Os limites sao folgados (16/30) p/ absorver mes de 4 ou 5 semanas.
function barSizeFor(n) {
  if (n <= 5) return 26   // 1s, 1 mes
  if (n <= 16) return 14  // 3 meses  (~14 semanas)
  if (n <= 30) return 8   // 6 meses  (~26 semanas)
  return 4.5              // 12 meses / tudo (~51 semanas)
}

export default function FluxoChart({ weekly }) {
  if (!weekly || !weekly.length) return null

  const data = toChartSeries(weekly)
  const barSize = barSizeFor(data.length)

  return (
    <div className="fluxo-chart" role="img" aria-label="Gráfico semanal de captação (acima de zero), resgate (abaixo de zero) e captação líquida">
      <ResponsiveContainer width="100%" height="100%">
        {/* stackOffset="sign" + stackId comum nas duas barras: captacao e resgate
            ocupam a MESMA coluna da semana (uma p/ cima, outra p/ baixo a partir
            do zero) em vez de duas colunas lado a lado. Como os sinais sao
            opostos elas nunca se sobrepoem, e a semana vira uma coluna so' --
            sem isso o Recharts partia cada semana ao meio e, com dado semanal,
            12 meses (~51 semanas) davam 3px de barra. A largura em si quem
            manda e' o barSize (ver barSizeFor). */}
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
          stackOffset="sign"
          barCategoryGap="8%"
        >
          {/* Mesmo padrao do grafico do Caixa: grade tracejada horizontal fina e
              SEM moldura (axisLine/tickLine) -- a linha de eixo + os tick marks do
              Recharts eram o que deixava este grafico mais "sujo" que o outro.
              #e0d3c0 = var(--grid); o Recharts nao aceita var() em stroke. */}
          <CartesianGrid strokeDasharray="3 3" stroke="#e0d3c0" vertical={false} />
          <XAxis
            dataKey="weekKey"
            tickFormatter={fmtDayMonthYY}
            interval="preserveStartEnd"
            minTickGap={44}
            tick={{ fontSize: 11 }}
            tickMargin={6}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11 }} width={44} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke={COL_ZERO} strokeWidth={1.25} />
          <Tooltip content={<FluxoTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="captacao" name="Captação" fill={COL_CAP} stackId="fluxo" fillOpacity={0.72} radius={[2, 2, 0, 0]} barSize={barSize} />
          <Bar dataKey="resgateNeg" name="Resgate" fill={COL_RES} stackId="fluxo" fillOpacity={0.72} radius={[0, 0, 2, 2]} barSize={barSize} />
          <Line dataKey="liquido" name="Cap. líquida" stroke={COL_LIQ} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { toChartSeries, fmtDayMonthYY, fmtWeekFull, fmtFluxo, fmtFluxoSigned } from '../../utils/fluxo.js'

// Paleta quente (identidade Luc), legível sobre o card claro
// CATALOGO DE 6 CORES (ver :root do index.css). O Recharts nao aceita var()
// em fill/stroke, entao os hex sao repetidos aqui -- mas SAO os do catalogo,
// nao tons proprios. Se mudar la', mude aqui.
//
// Sem fillOpacity de proposito: com 0.72 o terracota que aparecia na tela era
// ~#a98467, uma cor que nao existe em catalogo nenhum -- foi assim que a
// paleta inchou. A cor do token passa a ser a cor da tela.
const COL_CAP = '#8c5e3a'  // captação    — terracota (serie 1)
const COL_RES = '#9a8c7a'  // resgate     — taupe (serie 2)
const COL_LIQ = '#2a2420'  // cap. líquida — carvão (linha)
// Fonte dos eixos/legenda = --fz-graf-dado do catalogo (9px). O Recharts nao
// le var() em tick/wrapperStyle, entao o numero e' repetido aqui -- se mudar o
// token no CSS, mude aqui tambem.
const FZ_DADO = 9
const COL_EIXO = '#2a2420'  // carvao (--text): o Recharts pinta o eixo de #666 (cinza) por padrao, fora do catalogo e diferente dos eixos SVG do Caixa/Vencimentos
const COL_ZERO = '#9a8c7a' // linha do zero — taupe; era #94a3b8, um cinza
                           // AZULADO herdado da paleta navy aposentada: a
                           // unica cor fria fora das semanticas.

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
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          stackOffset="sign"
          barCategoryGap="8%"
        >
          {/* Mesmo padrao do grafico do Caixa: grade tracejada horizontal fina e
              SEM moldura (axisLine/tickLine) -- a linha de eixo + os tick marks do
              Recharts eram o que deixava este grafico mais "sujo" que o outro.
              #f2ede5 = --c-bege = var(--grid). O Recharts nao aceita var() em
              stroke, entao o hex e' repetido -- mas e' o do catalogo. */}
          <CartesianGrid strokeDasharray="3 3" stroke="#f2ede5" vertical={false} />
          <XAxis
            dataKey="weekKey"
            tickFormatter={fmtDayMonthYY}
            minTickGap={20}
            tick={{ fontSize: FZ_DADO, fill: COL_EIXO }}
            tickMargin={3}
            interval="preserveStartEnd" 
            axisLine={false}
            tickLine={false}
          />
          {/* Rotulo do eixo Y encostado na ESQUERDA (textAnchor start + dx negativo p/
              a borda da faixa do eixo), e nao alinhado a' direita como e' o padrao
              do Recharts. Assim o "30bi" comeca na MESMA margem do titulo do card
              -- alinhado a' direita, cada rotulo comecava num x diferente ("0"
              ficava 19px adentro) e nenhum casava com o "C" de Captacao. */}
          <YAxis tickFormatter={axisFmt} tick={{ fontSize: FZ_DADO, fill: COL_EIXO, textAnchor: 'start' }} dx={-22}
                 width={32} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke={COL_ZERO} strokeWidth={1.25} />
          <Tooltip content={<FluxoTooltip />} />
          <Legend wrapperStyle={{ fontSize: FZ_DADO }} iconType="square" iconSize={7} />
          <Bar dataKey="captacao" name="Captação" fill={COL_CAP} stackId="fluxo" radius={[2, 2, 0, 0]} barSize={barSize} />
          <Bar dataKey="resgateNeg" name="Resgate" fill={COL_RES} stackId="fluxo" radius={[0, 0, 2, 2]} barSize={barSize} />
          <Line dataKey="liquido" name="Cap. líquida" stroke={COL_LIQ} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

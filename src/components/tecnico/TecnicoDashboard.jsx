import { useState, useMemo } from 'react'
import { useFluxo } from '../../hooks/useFluxo.js'
import { useCaixa } from '../../hooks/useCaixa.js'
import {
  filterFluxo, aggregateByWeek, aggregateByMonth, aggregateByGestor, mergeRentabilidade,
  filterMensal, periodBounds, startForMonths, fmtWeekFull, latestBaseDate,
} from '../../utils/fluxo.js'
import { buildGestoresPorTicker, flattenEventos, aggMeses, aggGestores, fmtBar, pctFmt } from '../../utils/vencimentos.js'
import { fmtBRL } from '../../utils/format.js'
import FluxoChart from '../fluxo/FluxoChart.jsx'
import FluxoTable from '../fluxo/FluxoTable.jsx'
import FluxoMonthlyTable from '../fluxo/FluxoMonthlyTable.jsx'
import CaixaPctPLLine from '../caixa/CaixaPctPLLine.jsx'
import MonthBars from '../vencimentos/MonthBars.jsx'
import TecnicoGestorTable from './TecnicoGestorTable.jsx'

// Aba TECNICO: junta Captacao + Nivel de Caixa + Vencimentos (as 3 abas que
// dependem de oferta e demanda do mesmo universo de fundos), com a tabela de
// gestoras como filtro PRINCIPAL unico dos 3 graficos. Desktop apenas (ver
// App.jsx — a aba nao existe no BottomNav do compacto).
//
// O nome do gestor e' a mesma "Apelido Gestor" (Cadastro_Gestores) em toda a
// base -> a mesma selecao cruza Captacao (Fluxo_*), Caixa (Caixa_Potencial_*)
// e Vencimentos (BLC-derivado) sem remapeamento. Onde uma fonte nao tem dado
// pro gestor selecionado (ex.: sem caixa estimado), a celula mostra "—" em vez
// de um zero falso.
const DEFAULT_MONTHS = 12
const CAIXA_SEG = { '12431': '12431', trad: 'CDI' }
// Mesmos degraus da aba Captacao (menos "Tudo"): aqui a leitura e' de conjuntura
// -- o que esta' acontecendo agora com oferta e demanda --, entao a janela curta
// e' o que interessa. "Total" saiu porque diluia justamente o movimento recente
// que a aba existe p/ mostrar. '1w' e' tratado pelo startForMonths.
const PERIODOS = [
  { id: '1s', label: '1s', n: '1w' },
  { id: '1m', label: '1m', n: 1 },
  { id: '3m', label: '3m', n: 3 },
  { id: '6m', label: '6m', n: 6 },
  { id: '12m', label: '12m', n: 12 },
]
const PERIODO_PADRAO = '6m'
// Vencimentos: a MESMA serie em duas unidades. Alternador em vez de dois
// graficos -- ver comentario no JSX.
const UNIDADES = [
  { id: 'rs', label: 'R$' },
  { id: 'pct', label: '% do PL' },
]

export default function TecnicoDashboard({ agenda12m, blc, plByGestor }) {
  const [tipo, setTipo] = useState('trad')   // Tradicional: padrao unico do app
  const [gestorSel, setGestorSel] = useState('')
  const [periodo, setPeriodo] = useState(PERIODO_PADRAO)
  const [unidade, setUnidade] = useState('rs')

  const { loading, error, rows, monthly, rentabilidade } = useFluxo(tipo)
  const { historico } = useCaixa()

  const changeTipo = t => { setTipo(t); setGestorSel('') }
  const onSelectGestor = g => setGestorSel(cur => (cur === g ? '' : g))

  // ---- Captacao (semanal + mensal + ranking) ----
  const months = PERIODOS.find(p => p.id === periodo)?.n ?? 6
  const bounds = useMemo(() => periodBounds(rows), [rows])
  const effStart = useMemo(() => startForMonths(rows, months), [rows, months])
  const effEnd = bounds.max
  const refDate = rows.length ? fmtWeekFull(latestBaseDate(rows)) : null

  const filtered = useMemo(
    () => filterFluxo(rows, { gestor: gestorSel, start: effStart, end: effEnd }),
    [rows, gestorSel, effStart, effEnd]
  )
  const weekly = useMemo(() => aggregateByWeek(filtered), [filtered])
  const monthlyAgg = useMemo(
    () => aggregateByMonth(filterMensal(monthly, gestorSel), effStart, null, monthly),
    [monthly, gestorSel, effStart]
  )
  // Ranking com TODAS as gestoras sempre (a selecao nao pode esvaziar a tabela).
  const filteredTodasGestoras = useMemo(
    () => filterFluxo(rows, { gestor: '', start: effStart, end: effEnd }),
    [rows, effStart, effEnd]
  )
  const ranking = useMemo(
    () => mergeRentabilidade(aggregateByGestor(filteredTodasGestoras), rentabilidade),
    [filteredTodasGestoras, rentabilidade]
  )

  // ---- Caixa (%PL em caixa, ultimo mes por gestor p/ a tabela combinada) ----
  const caixaSeg = CAIXA_SEG[tipo]
  const pctCaixaPorGestor = useMemo(() => {
    const series = historico?.series || []
    const meses = historico?.meses?.length ? historico.meses : [...new Set(series.map(r => r.mes))].sort()
    const ultimoMes = meses[meses.length - 1]
    const m = new Map()
    if (!ultimoMes) return m
    const agg = new Map()
    for (const r of series) {
      if (r.mes !== ultimoMes || r.segmento !== caixaSeg) continue
      let o = agg.get(r.gestor); if (!o) { o = { caixa: 0, pl: 0 }; agg.set(r.gestor, o) }
      o.caixa += r.caixa || 0; o.pl += r.pl || 0
    }
    for (const [g, o] of agg) if (o.pl > 0) m.set(g, (o.caixa / o.pl) * 100)
    return m
  }, [historico, caixaSeg])

  // ---- Vencimentos (agenda 12m, sempre olhando pra frente — sem corte por periodo) ----
  const gpt = useMemo(() => buildGestoresPorTicker(blc), [blc])
  const eventos = useMemo(() => flattenEventos(agenda12m), [agenda12m])
  const mesesView = useMemo(
    () => aggMeses(agenda12m, eventos, gpt, { gestorSel, seg: tipo, persp: 'carteira', base: 'view' }),
    [agenda12m, eventos, gpt, gestorSel, tipo]
  )
  const maxVenc = Math.max(1, ...mesesView.map(m => m.total))
  // % do PL: mesma base 'carteira' do VencimentosDashboard (sempre valor de
  // carteira, mesmo em outra perspectiva) dividida pelo PL do gestor selecionado
  // (ou PL total, sem selecao).
  const mesesCarteira = useMemo(
    () => aggMeses(agenda12m, eventos, gpt, { gestorSel, seg: tipo, persp: 'carteira', base: 'carteira' }),
    [agenda12m, eventos, gpt, gestorSel, tipo]
  )
  const totalPL = useMemo(() => {
    let s = 0; for (const k in (plByGestor || {})) s += plByGestor[k] || 0; return s
  }, [plByGestor])
  const plDenom = gestorSel ? (plByGestor?.[gestorSel] || 0) : totalPL
  const mesesPL = useMemo(() => mesesCarteira.map(m => ({
    mes: m.mes, label: m.label,
    juros: plDenom > 0 ? (m.juros / plDenom) * 100 : 0,
    amort: plDenom > 0 ? (m.amort / plDenom) * 100 : 0,
    total: plDenom > 0 ? (m.total / plDenom) * 100 : 0,
  })), [mesesCarteira, plDenom])
  const maxPct = Math.max(0.001, ...mesesPL.map(m => m.total))
  const vencGestorRows = useMemo(
    () => aggGestores(agenda12m, eventos, gpt, { seg: tipo, selMes: null }),
    [agenda12m, eventos, gpt, tipo]
  )
  const vencPorGestor = useMemo(
    () => new Map(vencGestorRows.map(r => [r.nome, (r.juros || 0) + (r.amort || 0)])),
    [vencGestorRows]
  )

  // ---- Tabela combinada (filtro principal) ----
  const gestorRows = useMemo(() => ranking.map(r => ({
    gestor: r.gestor,
    liquido: r.liquido,
    pctCaixa: pctCaixaPorGestor.has(r.gestor) ? pctCaixaPorGestor.get(r.gestor) : null,
    venc12m: vencPorGestor.has(r.gestor) ? vencPorGestor.get(r.gestor) : null,
  })), [ranking, pctCaixaPorGestor, vencPorGestor])

  // O grafico de caixa le uma serie MENSAL: em 1s/1m/3m ele teria 0-3 pontos e
  // nao formaria linha. Pior, o lookup do id nao existente caia em n=0 e ele
  // mostrava a serie INTEIRA calado, enquanto a captacao ao lado mostrava 1
  // semana -- dois graficos lado a lado em janelas diferentes, sem aviso.
  // Aqui o clamp e' explicito e vai rotulado na tela.
  const CAIXA_MIN = '6m'
  const periodoCurto = ['1s', '1m', '3m'].includes(periodo)
  const periodoCaixa = periodoCurto ? CAIXA_MIN : periodo

  const semSelecao = gestorSel ? '' : 'Todos os gestores'
  const escopo = `${gestorSel || semSelecao} · ${tipo === '12431' ? '12.431' : 'Tradicional'}`

  return (
    <section className="tecnico" aria-label="Visão técnica — oferta e demanda">
      <header className="tecnico-header">
        {/* Sem titulo/subtitulo/data soltos: nesta aba TODO texto vive dentro de
            um grafico ou de uma tabela. O nome da aba ja' esta' na navegacao e o
            subtitulo explicava o que os 3 graficos mostram -- que os proprios
            titulos dos graficos agora dizem. A data-base migrou p/ o rodape da
            tabela, junto do dado que ela data. */}
        <div />
        <div className="controls">
          {gestorSel && (
            <span className="tecnico-filtro-ativo">
              {gestorSel}
              <button type="button" onClick={() => setGestorSel('')} title="Limpar filtro">×</button>
            </span>
          )}
          <div className="segmented tecnico-seg" role="tablist" aria-label="Segmento">
            <button className={`segmented-btn${tipo === 'trad' ? ' active' : ''}`} onClick={() => changeTipo('trad')}>Tradicional</button>
            <button className={`segmented-btn${tipo === '12431' ? ' active' : ''}`} onClick={() => changeTipo('12431')}>12.431</button>
          </div>
          <div className="segmented tecnico-seg" role="tablist" aria-label="Período (Captação)">
            {PERIODOS.map(p => (
              <button key={p.id} className={`segmented-btn${periodo === p.id ? ' active' : ''}`} onClick={() => setPeriodo(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
      </header>

      {loading && (
        <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
      )}
      {!loading && error && (
        <div className="state-box error"><span className="state-icon">⚠️</span><p className="error-msg">Não foi possível carregar a Captação.</p><small>{error}</small></div>
      )}

      {!loading && !error && (
        <div className="tecnico-grid">
          <div className="tecnico-charts-col">
            {/* Linha 1: Captacao (fluxo) ao lado de Caixa (estoque). Titulo de UMA
                palavra + a natureza temporal na legenda: lendo de cima a baixo o
                usuario percorre a linha do tempo do dinheiro -- entra, fica
                parado, volta. O escopo saiu dos 4 titulos: repetia "Todos os
                gestores - 12.431" quatro vezes e ja' esta' no cabecalho e no
                filtro. */}
            <div className="tecnico-chart-row">
              <div className="tecnico-chart-cell">
                <div className="grafico-card">
                <p className="tecnico-chart-label">Captação <span className="tecnico-chart-nota">entra por semana</span></p>
                <FluxoChart weekly={weekly} />
                </div>
              </div>
              <div className="tecnico-chart-cell">
                <div className="grafico-card">
                <p className="tecnico-chart-label">
                  Caixa <span className="tecnico-chart-nota">parado hoje{periodoCurto ? ' · janela mínima 6m' : ''}</span>
                </p>
                <CaixaPctPLLine historico={historico} segmento={caixaSeg} gestor={gestorSel} periodo={periodoCaixa} />
                </div>
              </div>
            </div>
            {/* Linha 2: Vencimentos, UM grafico com alternador de unidade. Antes
                eram dois graficos lado a lado mostrando a MESMA serie em R$ e em
                %PL -- peso visual de dois assuntos p/ um so'. Unidos, sobra a
                largura inteira p/ os 12 meses respirarem. */}
            <div className="tecnico-chart-row">
              <div className="tecnico-chart-cell tecnico-chart-cell-full">
                <div className="grafico-card">
                <p className="tecnico-chart-label">
                  Vencimentos <span className="tecnico-chart-nota">volta em 12m</span>
                  <span className="segmented tecnico-unidade" role="tablist" aria-label="Unidade dos vencimentos">
                    {UNIDADES.map(u => (
                      <button key={u.id} type="button" role="tab" aria-selected={unidade === u.id}
                        className={`segmented-btn${unidade === u.id ? ' active' : ''}`}
                        onClick={() => setUnidade(u.id)}>{u.label}</button>
                    ))}
                  </span>
                </p>
                {!agenda12m
                  ? <div className="caixa-line-empty">Sem agenda de vencimentos carregada ainda.</div>
                  : unidade === 'rs'
                    ? <MonthBars rows={mesesView} max={maxVenc} selMes={null} onPick={() => {}}
                        fmtVal={fmtBRL} fmtLabel={fmtBar} ariaLabel="Vencimentos por mês em reais" />
                    : plDenom > 0
                      ? <MonthBars rows={mesesPL} max={maxPct} selMes={null} onPick={() => {}}
                          fmtVal={pctFmt} fmtLabel={pctFmt} ariaLabel="Vencimentos por mês em % do PL" />
                      : <div className="caixa-line-empty">Sem PL de {gestorSel || 'carteira'} para calcular %PL.</div>}
                </div>
              </div>
            </div>
          </div>

          <TecnicoGestorTable rows={gestorRows} activeGestor={gestorSel} onSelect={onSelectGestor} refDate={refDate} />
        </div>
      )}

      {!loading && !error && (
        <div className="fluxo-tables-row tecnico-tables-row">
          <FluxoTable weekly={weekly} />
          <FluxoMonthlyTable months={monthlyAgg} />
        </div>
      )}
    </section>
  )
}

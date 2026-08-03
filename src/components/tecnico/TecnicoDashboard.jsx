import { useState, useMemo, useLayoutEffect, useRef } from 'react'
import { useFluxo } from '../../hooks/useFluxo.js'
import { useCaixa } from '../../hooks/useCaixa.js'
import {
  filterFluxo, aggregateByWeek, aggregateByMonth, aggregateByGestor, mergeRentabilidade,
  agregarFundosPorGestor, computeCards, fmtFluxoSigned,
  filterMensal, periodBounds, startForMonths,
} from '../../utils/fluxo.js'
import { buildGestoresPorTicker, flattenEventos, aggMeses, aggGestores, fmtBar, pctFmt } from '../../utils/vencimentos.js'
import { fmtPct, isYes, dateKey } from '../../utils/format.js'
import { fmtMonthYY } from '../../utils/fluxo.js'
import { useCaixaFundosHistorico } from '../../hooks/useCaixaFundosHistorico.js'
import { fmtBRL } from '../../utils/format.js'
import FluxoChart from '../fluxo/FluxoChart.jsx'
import FluxoTable from '../fluxo/FluxoTable.jsx'
import FluxoMonthlyTable from '../fluxo/FluxoMonthlyTable.jsx'
import CaixaPctPLLine from '../caixa/CaixaPctPLLine.jsx'
import MonthBars from '../vencimentos/MonthBars.jsx'
import EmissoesBars from './EmissoesBars.jsx'
import TecnicoGestorTable from './TecnicoGestorTable.jsx'
import AssetTable from '../AssetTable.jsx'
import { sortAssets } from '../../utils/sortAssets.js'
import { CaptacaoIcon, VencimentosIcon, CaixaIcon } from '../SectionIcons.jsx'

// Icone de Emissoes p/ a barra de graficos do compacto (barras — o proprio grafico).
function EmissoesNavIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 34 V22 M22 34 V14 M32 34 V26 M12 34 h28" />
    </svg>
  )
}

// Barra de graficos (SO' no compacto): escolhe qual grafico + tabela aparece.
const GRAFICOS = [
  { id: 'captacao',    label: 'Captação',   Icon: CaptacaoIcon },
  { id: 'vencimentos', label: 'Vencim.',    Icon: VencimentosIcon },
  { id: 'emissoes',    label: 'Emissões',   Icon: EmissoesNavIcon },
  { id: 'caixa',       label: 'Caixa',      Icon: CaixaIcon },
]
import CorteSelector from '../CorteSelector.jsx'
import { CORTE_OFICIAL, isOficial, cnpjsNoCorte, historicoNoCorte } from '../../utils/corte.js'

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
const BOTTOM_GAP = 16
const TABLE_CHROME = 46
const TABLE_ROW = 20
const TABLE_FRAME = 2
// O grafico de %PL em caixa e' MENSAL: janela abaixo de 3 meses nao forma linha
// (1s = 1 semana, 1m = 1 ponto). 1s/1m/3m viram 3 meses -- o piso que ainda
// desenha tendencia --, 6m/12m passam direto. Modulo (nao dentro do componente)
// p/ ser usado tanto pelo KPI quanto pelo grafico sem armadilha de ordem.
const CAIXA_MESES = { '1s': 3, '1m': 3, '3m': 3, '6m': 6, '12m': 12 }
// Vencimentos: a MESMA serie em duas unidades. Alternador em vez de dois
// graficos -- ver comentario no JSX.
const UNIDADES = [
  { id: 'rs', label: 'R$' },
  { id: 'pct', label: '%PL' },   /* era '% do PL': o botao competia em largura com o titulo */
]
const EMISSOES_MESES = 6   // janela do gráfico de Emissões: 6 meses pra trás

// As 12 chaves 'AAAA-MM' terminando no mês corrente (mais antigo primeiro).
function ultimosMeses(n) {
  const now = new Date()
  let y = now.getFullYear(), m = now.getMonth()   // m 0-based
  const out = []
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (--m < 0) { m = 11; y-- }
  }
  return out
}
// Captacao (tabela): a MESMA serie em duas agregacoes. Uma tabela so', com o
// alternador no canto do grafico de Captacao (ver JSX) -- em vez de duas tabelas
// lado a lado. Ela mora logo abaixo do grafico, na largura de UM grafico.
const VISTAS = [
  { id: 'semanas', label: 'Semanas' },
  { id: 'meses',   label: 'Meses' },
]

export default function TecnicoDashboard({ agenda12m, blc, plByGestor, assets, emissoesAnbima, desktop, onAssetInfo, anbimaRef, recompraRef, corte, onCorte, corteDisponivel, pctPorCnpj }) {
  const [tipo, setTipo] = useState('trad')   // Tradicional: padrao unico do app
  const [gestorSel, setGestorSel] = useState('')
  const [periodo, setPeriodo] = useState(PERIODO_PADRAO)
  const [unidade, setUnidade] = useState('rs')
  const [vista, setVista] = useState('semanas')   // tabela de captacao: Semanas | Meses
  const gridRef = useRef(null)

  const { loading, error, rows: rowsBase, monthly, rentabilidade, fundosSemana } = useFluxo(tipo)

  // O seletor de %Deb estava RENDERIZADO aqui mas nunca ligado ao calculo: o
  // botao mudava e o numero nao. Mesmo caminho da aba Captacao -- no corte
  // oficial usa o agregado do pipeline; fora dele re-soma do per-fundo.
  const rows = useMemo(() => {
    if (isOficial(corte) || !pctPorCnpj || !fundosSemana?.length) return rowsBase
    return agregarFundosPorGestor(fundosSemana, cnpjsNoCorte(pctPorCnpj, corte))
  }, [rowsBase, fundosSemana, pctPorCnpj, corte])
  const { historico: historicoBase } = useCaixa()

  // Corte de %Deb no historico de caixa: o agregado nao tem CNPJ, entao fora do
  // corte oficial trocamos pela serie POR FUNDO filtrada (carregada sob demanda,
  // so' quando o corte sai do oficial). No oficial, o agregado leve de sempre.
  const corteAtivo = !isOficial(corte) && !!pctPorCnpj
  const { rows: caixaFundos } = useCaixaFundosHistorico(corteAtivo)
  const historico = useMemo(() => {
    if (!corteAtivo || !caixaFundos?.length) return historicoBase
    return historicoNoCorte(caixaFundos, cnpjsNoCorte(pctPorCnpj, corte))
  }, [corteAtivo, caixaFundos, historicoBase, pctPorCnpj, corte])

  const changeTipo = t => { setTipo(t); setGestorSel('') }
  const onSelectGestor = g => setGestorSel(cur => (cur === g ? '' : g))

  // ---- Captacao (semanal + mensal + ranking) ----
  const months = PERIODOS.find(p => p.id === periodo)?.n ?? 6
  const bounds = useMemo(() => periodBounds(rows), [rows])
  const effStart = useMemo(() => startForMonths(rows, months), [rows, months])
  const effEnd = bounds.max

  const filtered = useMemo(
    () => filterFluxo(rows, { gestor: gestorSel, start: effStart, end: effEnd }),
    [rows, gestorSel, effStart, effEnd]
  )
  const weekly = useMemo(() => aggregateByWeek(filtered), [filtered])
  // KPI da Captacao: cap. liquida do periodo em R$ e como % do PL medio.
  const capKpi = useMemo(() => {
    const c = computeCards(filtered)
    return { liquido: c.liquido, pctPL: c.plTotalMedio > 0 ? (c.liquido / c.plTotalMedio) * 100 : null }
  }, [filtered])
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

  // KPI do Caixa: variacao do PL no periodo selecionado. Serie mensal de PL do
  // recorte (segmento + gestor), recortada pela mesma janela do grafico, e a
  // variacao ponta a ponta. Reage ao periodo -- p/ 6m/12m; nas janelas curtas o
  // grafico ja' cai no minimo de 6m e o KPI acompanha.
  const caixaPLVar = useMemo(() => {
    const series = historico?.series || []
    const porMes = new Map()
    for (const r of series) {
      if (r.segmento !== caixaSeg) continue
      if (gestorSel && r.gestor !== gestorSel) continue
      porMes.set(r.mes, (porMes.get(r.mes) || 0) + (r.pl || 0))
    }
    const meses = [...porMes.keys()].sort()
    // janela em meses: 1s/1m/3m caem no minimo de 6 (serie mensal), igual ao grafico
    const n = CAIXA_MESES[periodo] || 6   // mesmo piso do grafico (3m)
    const win = meses.slice(-n)
    if (win.length < 2) return null
    const ini = porMes.get(win[0]), fim = porMes.get(win[win.length - 1])
    if (!ini) return null
    return { pct: ((fim - ini) / ini) * 100, deMes: win[0], ateMes: win[win.length - 1] }
  }, [historico, caixaSeg, gestorSel, periodo])

  // ---- Vencimentos (agenda 12m, sempre olhando pra frente — sem corte por periodo) ----
  const gpt = useMemo(() => buildGestoresPorTicker(blc), [blc])
  const eventos = useMemo(() => flattenEventos(agenda12m), [agenda12m])
  const mesesView = useMemo(
    () => aggMeses(agenda12m, eventos, gpt, { gestorSel, seg: tipo, persp: 'carteira', base: 'view' }),
    [agenda12m, eventos, gpt, gestorSel, tipo]
  )
  // Os 6 meses mais proximos concentram a pressao de reinvestimento relevante
  // para esta visao. A agenda segue gerando 12 meses; o recorte e' apenas deste
  // card (a aba Vencimentos, mais detalhada, continua com os 12).
  const MESES_TECNICO = 6
  const mesesViewCurto = useMemo(() => mesesView.slice(0, MESES_TECNICO), [mesesView])
  const maxVenc = Math.max(1, ...mesesViewCurto.map(m => m.total))
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
  const mesesPLCurto = useMemo(() => mesesPL.slice(0, MESES_TECNICO), [mesesPL])
  const maxPct = Math.max(0.001, ...mesesPLCurto.map(m => m.total))
  const vencGestorRows = useMemo(
    () => aggGestores(agenda12m, eventos, gpt, { seg: tipo, selMes: null }),
    [agenda12m, eventos, gpt, tipo]
  )
  // Venc. 3M (nao 12m): a coluna serve p/ ler pressao de reinvestimento PROXIMA
  // -- o que vence daqui a um ano nao concorre com a decisao de hoje. Somamos
  // gestor a gestor os 3 primeiros meses da agenda, cada um pela mesma via do
  // aggGestores (fatia por participacao real no ticker), em vez de ratear o 12m.
  const vencPorGestor = useMemo(() => {
    const meses3 = (agenda12m?.meses || []).slice(0, 3).map(m => m.mes)
    if (!meses3.length) return new Map()
    const acc = new Map()
    for (const mes of meses3) {
      for (const r of aggGestores(agenda12m, eventos, gpt, { seg: tipo, selMes: mes })) {
        acc.set(r.nome, (acc.get(r.nome) || 0) + (r.juros || 0) + (r.amort || 0))
      }
    }
    return acc
  }, [agenda12m, eventos, gpt, tipo])

  // ---- Emissões (volume emitido por mês x quanto foi para Fundos) ----
  // Fonte: ANBIMA (Boletim de Mercado de Capitais), Subscritores de debêntures —
  // total emitido do mês e a parcela subscrita por Fundos de Investimento. É
  // visão de MERCADO (não da nossa base); o "quanto foi para fundos" só existe
  // nesse agregado da ANBIMA. REAGE ao segmento: 12.431 vem direto do boletim
  // (aba 09-06) e Tradicional é o total (aba 08-05) menos o 12.431.
  // Gerado por tools/preparar-emissoes-anbima.mjs -> public/Emissoes_ANBIMA.csv.
  const emissoesMeses = useMemo(() => {
    const inc = tipo === '12431'
    return (emissoesAnbima || [])
      .filter(r => /^\d{4}-\d{2}$/.test((r.Mes || '').trim()))
      .map(r => {
        const total = Number(r.Total) || 0, fundos = Number(r.Fundos) || 0
        const t12 = Number(r.Total12431) || 0, f12 = Number(r.Fundos12431) || 0
        return {
          mes: r.Mes.trim(),
          total: inc ? t12 : Math.max(0, total - t12),
          fundos: inc ? f12 : Math.max(0, fundos - f12),
        }
      })
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .slice(-EMISSOES_MESES)
      .map(r => ({ mes: r.mes, label: fmtMonthYY(r.mes), total: r.total, fundos: r.fundos }))
  }, [emissoesAnbima, tipo])
  const maxEmissoes = Math.max(1, ...emissoesMeses.map(m => m.total))

  // Drill-down: clicar numa barra troca a tabela de gestores pela tabela ATIVOS,
  // filtrada pelas debentures da BASE emitidas naquele mes (por Registro CVM) e no
  // segmento atual (12.431/Tradicional). O mes vem do grafico ANBIMA (mercado); a
  // lista sao as NOSSAS debentures daquele mes -- a contagem nao bate com a barra.
  const [emissaoMes, setEmissaoMes] = useState(null)
  const [ativosSort, setAtivosSort] = useState({ col: 'registroCvm', dir: 'desc' })
  // Compacto: mostra UM grafico por vez (escolhido na barra inferior de graficos).
  // No desktop todos aparecem (grid) -> mostra() e' sempre true.
  const [graficoAtivo, setGraficoAtivo] = useState('captacao')
  const mostra = c => desktop || graficoAtivo === c
  const onAtivosSort = col => setAtivosSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))
  const toggleEmissaoMes = mes => setEmissaoMes(m => (m === mes ? null : mes))
  // Mes efetivo do drill de Ativos: o clicado numa barra; OU, no compacto com
  // Emissoes selecionado, o mes MAIS RECENTE por padrao -- assim ao escolher
  // Emissoes a tabela ja' vem em Ativos (nao a de gestores), como pediu.
  const ultimoMesEmissao = emissoesMeses.length ? emissoesMeses[emissoesMeses.length - 1].mes : null
  const mesDrill = emissaoMes ?? ((!desktop && graficoAtivo === 'emissoes') ? ultimoMesEmissao : null)
  const ativosDoMes = useMemo(() => {
    if (!mesDrill) return []
    const inc = tipo === '12431'
    const filtrados = (assets || []).filter(a => {
      if (!a.registroCvm || isYes(a.lei12431Str) !== inc) return false
      const k = dateKey(a.registroCvm)
      return k && k.length >= 6 && `${k.slice(0, 4)}-${k.slice(4, 6)}` === mesDrill
    })
    return sortAssets(filtrados, ativosSort)
  }, [assets, mesDrill, tipo, ativosSort])

  // ---- Tabela combinada (filtro principal) ----
  const gestorRows = useMemo(() => ranking.map(r => ({
    gestor: r.gestor,
    liquido: r.liquido,
    pctCaixa: pctCaixaPorGestor.has(r.gestor) ? pctCaixaPorGestor.get(r.gestor) : null,
    venc3m: vencPorGestor.has(r.gestor) ? vencPorGestor.get(r.gestor) : null,
    pl: r.plRecente ?? null,
  })), [ranking, pctCaixaPorGestor, vencPorGestor])

  // O grafico de caixa le uma serie MENSAL: em 1s/1m/3m ele teria 0-3 pontos e
  // nao formaria linha. Pior, o lookup do id nao existente caia em n=0 e ele
  // mostrava a serie INTEIRA calado, enquanto a captacao ao lado mostrava 1
  // semana -- dois graficos lado a lado em janelas diferentes, sem aviso.
  // Aqui o clamp e' explicito e vai rotulado na tela.
  const caixaNMeses = CAIXA_MESES[periodo] || 6
  const periodoAbaixoDoPiso = ['1s', '1m'].includes(periodo)   // pediu menos que o grafico mostra

  const semSelecao = gestorSel ? '' : 'Todos os gestores'
  const escopo = `${gestorSel || semSelecao} · ${tipo === '12431' ? '12.431' : 'Tradicional'}`

  // A grade usa o espaco restante da viewport, arredondado para linhas inteiras.
  // A sobra fica fora dos cards: o rodape ganha alguns pixels alem dos 16px
  // minimos, em vez de deixar uma faixa branca sob a ultima linha das tabelas.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof window === 'undefined') return undefined

    const updateHeight = () => {
      const top = grid.getBoundingClientRect().top
      const available = Math.max(0, Math.floor(window.innerHeight - top - BOTTOM_GAP))
      const cardBase = TABLE_CHROME + TABLE_FRAME
      const snapped = available < cardBase
        ? available
        : cardBase + Math.floor((available - cardBase) / TABLE_ROW) * TABLE_ROW
      grid.style.setProperty('--tecnico-grid-height', `${snapped}px`)
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    window.visualViewport?.addEventListener('resize', updateHeight)

    return () => {
      window.removeEventListener('resize', updateHeight)
      window.visualViewport?.removeEventListener('resize', updateHeight)
    }
  }, [rows.length])

  return (
    <section className="tecnico" aria-label="Visão técnica — oferta e demanda">
      <header className="tecnico-header">
        {/* Sem titulo/subtitulo/data soltos: nesta aba TODO texto vive dentro de
            um grafico ou de uma tabela (a data-base migrou p/ o rodape da tabela
            de gestoras). O header e' so' a barra de controle: filtros a
            ESQUERDA e o corte de %Deb a DIREITA, na MESMA linha -- por isso o
            Tecnico renderiza o CorteSelector aqui em vez de usar a .corte-bar
            do App, que ficaria numa linha propria acima e empurraria os
            graficos p/ baixo. */}
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
          <CorteSelector corte={corte} onChange={onCorte} disponivel={corteDisponivel} />
        </div>
      </header>

      {/* Spinner SO' no 1o carregamento (sem dado ainda). Ao trocar de segmento o
          useFluxo mantem as linhas antigas e so' liga loading -- se desmontasse
          o grid aqui, o conteudo sumia e voltava, e' o "pisca". Mantendo montado
          enquanto a nova serie chega, a troca e' um swap suave. */}
      {loading && !rows.length && (
        <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
      )}
      {error && !rows.length && (
        <div className="state-box error"><span className="state-icon">⚠️</span><p className="error-msg">Não foi possível carregar a Captação.</p><small>{error}</small></div>
      )}

      {!error && rows.length > 0 && (
        <div className="tecnico-grid" ref={gridRef}>
          <div className="tecnico-charts-col">
            {/* Linha 1: Captacao (fluxo) ao lado de Caixa (estoque). Titulo de UMA
                palavra + a natureza temporal na legenda: lendo de cima a baixo o
                usuario percorre a linha do tempo do dinheiro -- entra, fica
                parado, volta. O escopo saiu dos 4 titulos: repetia "Todos os
                gestores - 12.431" quatro vezes e ja' esta' no cabecalho e no
                filtro. */}
            <div className="tecnico-chart-row">
              {mostra('captacao') && (
              <div className="tecnico-chart-cell">
                <div className="grafico-card">
                <p className="tecnico-chart-label">
                  Captação
                  {capKpi && (
                    <span className="grafico-kpi">
                      <b className={capKpi.liquido >= 0 ? 'pos' : 'neg'}>{fmtFluxoSigned(capKpi.liquido)}</b>
                      {capKpi.pctPL != null && <em>{fmtPct(capKpi.pctPL)} do PL</em>}
                    </span>
                  )}
                  {/* Alternador da tabela LOGO ABAIXO (Semanas | Meses). Fica no
                      canto do grafico de Captacao porque a tabela e' a mesma
                      serie do grafico, so' que agregada. */}
                  <span className="segmented tecnico-unidade tecnico-vista" role="tablist" aria-label="Agregação da tabela de captação">
                    {VISTAS.map(v => (
                      <button key={v.id} type="button" role="tab" aria-selected={vista === v.id}
                        className={`segmented-btn${vista === v.id ? ' active' : ''}`}
                        onClick={() => setVista(v.id)}>{v.label}</button>
                    ))}
                  </span>
                </p>
                <FluxoChart weekly={weekly} monthly={monthlyAgg} mode={vista} />
                </div>
              </div>
              )}
              {mostra('caixa') && (
              <div className="tecnico-chart-cell">
                <div className="grafico-card">
                <p className="tecnico-chart-label">
                  Caixa{periodoAbaixoDoPiso && <span className="tecnico-chart-nota"> · mín. 3m (mensal)</span>}
                  {caixaPLVar && (
                    <span className="grafico-kpi">
                      <b className={caixaPLVar.pct >= 0 ? 'pos' : 'neg'}>{caixaPLVar.pct >= 0 ? '+' : ''}{fmtPct(caixaPLVar.pct)}</b>
                      <em>PL no período</em>
                    </span>
                  )}
                </p>
                <CaixaPctPLLine historico={historico} segmento={caixaSeg} gestor={gestorSel} nMeses={caixaNMeses} />
                </div>
              </div>
              )}
              {mostra('vencimentos') && (
              <div className="tecnico-chart-cell">
                <div className="grafico-card">
                <p className="tecnico-chart-label">
                  Vencimentos
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
                    ? <MonthBars rows={mesesViewCurto} max={maxVenc} selMes={null} onPick={() => {}}
                        fmtVal={fmtBRL} fmtLabel={fmtBar} ariaLabel="Vencimentos por mês em reais" compacto />
                    : plDenom > 0
                      ? <MonthBars rows={mesesPLCurto} max={maxPct} selMes={null} onPick={() => {}}
                          fmtVal={pctFmt} fmtLabel={pctFmt} ariaLabel="Vencimentos por mês em % do PL" compacto />
                      : <div className="caixa-line-empty">Sem PL de {gestorSel || 'carteira'} para calcular %PL.</div>}
                </div>
              </div>
              )}
            </div>

            {/* Linha de baixo. No desktop: tabela Semanas/Meses (sob a Captacao) +
                grafico de Emissoes (sob o Vencimentos). No compacto so' aparece a
                peca do grafico escolhido na barra de baixo. */}
            <div className="fluxo-tables-row tecnico-tables-row">
              {(desktop || graficoAtivo === 'captacao') && (
                vista === 'semanas'
                  ? <FluxoTable weekly={weekly} allowExpand={false} />
                  : <FluxoMonthlyTable months={monthlyAgg} />
              )}
              {mostra('emissoes') && (
              <div className="tecnico-emissoes-cell">
                <div className="grafico-card">
                  <p className="tecnico-chart-label">Emissões</p>
                  <EmissoesBars rows={emissoesMeses} max={maxEmissoes} fmtVal={fmtBRL} fmtLabel={fmtBar}
                    onBarClick={toggleEmissaoMes} selectedMes={mesDrill}
                    ariaLabel="Emissão mensal de debêntures (ANBIMA) e a parcela subscrita por fundos de investimento — últimos 6 meses. Clique numa barra para listar os ativos da base emitidos no mês." />
                </div>
              </div>
              )}
            </div>
          </div>

          {(desktop || graficoAtivo !== 'captacao') && (mesDrill ? (
            <div className="tecnico-drill">
              <div className="tecnico-drill-head">
                <span className="tecnico-drill-tit">
                  Debêntures da base emitidas em {fmtMonthYY(mesDrill)}
                  <span className="tecnico-drill-seg"> · {tipo === '12431' ? '12.431' : 'Tradicional'}</span>
                  <span className="tecnico-drill-n"> · {ativosDoMes.length}</span>
                </span>
                {desktop && <button type="button" className="tecnico-drill-back" onClick={() => setEmissaoMes(null)}>← gestores</button>}
              </div>
              <AssetTable assets={ativosDoMes} sort={ativosSort} onSort={onAtivosSort}
                onSelect={() => {}} footerAssets={ativosDoMes}
                onInfoClick={onAssetInfo || (() => {})}
                anbimaRef={anbimaRef} recompraRef={recompraRef} desktop={desktop} />
            </div>
          ) : (
            <TecnicoGestorTable rows={gestorRows} activeGestor={gestorSel} onSelect={onSelectGestor} />
          ))}
        </div>
      )}

      {/* Compacto: barra fixa acima do BottomNav para escolher QUAL grafico (e a
          tabela associada) aparece. So' no compacto -- no desktop o grid mostra
          tudo. */}
      {!desktop && (
        <nav className="tecnico-chart-nav" role="tablist" aria-label="Gráfico exibido">
          {GRAFICOS.map(g => (
            <button key={g.id} type="button" role="tab" aria-selected={graficoAtivo === g.id}
              className={`tecnico-chart-nav-btn${graficoAtivo === g.id ? ' active' : ''}`}
              onClick={() => { setGraficoAtivo(g.id); setEmissaoMes(null) }}>
              <span className="tecnico-chart-nav-ico"><g.Icon /></span>
              <span className="tecnico-chart-nav-lbl">{g.label}</span>
            </button>
          ))}
        </nav>
      )}
    </section>
  )
}

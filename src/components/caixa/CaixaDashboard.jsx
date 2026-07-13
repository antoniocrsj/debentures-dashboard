import { useState, useMemo, useCallback } from 'react'
import { useCaixa } from '../../hooks/useCaixa.js'
import { fmtPctPL, fmtMes, aggregateGestores } from '../../utils/caixa.js'
import { fmtFluxo, fmtFluxoSigned, fmtInt } from '../../utils/fluxo.js'
import CaixaMonthTrend from './CaixaMonthTrend.jsx'
import CaixaGestorTable from './CaixaGestorTable.jsx'
import CaixaFundoTable from './CaixaFundoTable.jsx'

const SEGMENTOS = [
  { id: '', label: 'Todos' },
  { id: 'CDI', label: 'Tradicional (CDI)' },
  { id: '12431', label: 'Incentivados (12.431)' },
]
const CLASSES = [
  { id: '', label: 'Todas' },
  { id: 'confirmado', label: 'Fundos caixa' },
  { id: 'candidato', label: 'Candidatos' },
]

export default function CaixaDashboard({ compact = false }) {
  const { loading, error, fundos, gestores, meta, reload } = useCaixa()
  const [segmento, setSegmento] = useState('')
  const [classe, setClasse] = useState('')
  const [gestor, setGestor] = useState('')
  const [search, setSearch] = useState('')

  // Fundos no consolidado (base para os cards e para as tabelas de caixa).
  const consolidaveis = useMemo(() => fundos.filter(f => f.noConsolidado), [fundos])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return fundos.filter(f => {
      if (segmento && f.segmento !== segmento) return false
      if (classe && f.classeKind !== classe) return false
      if (gestor && f.gestor !== gestor) return false
      if (q && ![f.nome, f.gestor, f.cnpj].some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
  }, [fundos, segmento, classe, gestor, search])

  // Recorte por segmento/gestor ativo (sem classe/busca: cards e contagens
  // agregam o consolidado do recorte, nao a lista filtrada por texto).
  const segBase = useMemo(() => fundos.filter(f =>
    (!segmento || f.segmento === segmento) && (!gestor || f.gestor === gestor)),
    [fundos, segmento, gestor])

  // Cards: somam o consolidado do recorte, sempre contando o ativo final 1x
  // (so' linhas noConsolidado).
  const cards = useMemo(() => {
    const base = segBase.filter(f => f.noConsolidado)
    const sum = k => base.reduce((s, f) => s + (f[k] || 0), 0)
    const consolidado = sum('caixaConsolidado')
    const pl = sum('pl')
    return {
      consolidado,
      pctPL: pl > 0 ? consolidado / pl : null,
      estimado: sum('caixaEstimado'),
      fluxoPosterior: sum('fluxoPosterior'),
      pl,
      nFundos: base.length,
    }
  }, [segBase])

  // Contagem de fundos caixa respeita o segmento/gestor ativo (coerente com o
  // card "Fundos no consolidado").
  const confirmados = useMemo(() => segBase.filter(f => f.classeKind === 'confirmado').length, [segBase])
  const candidatos = useMemo(() => segBase.filter(f => f.classeKind === 'candidato').length, [segBase])

  // Ranking de gestores derivado dos fundos (respeita o segmento; coerente com
  // os cards). So' cai para o CSV pre-agregado se os dados nao carregaram —
  // nunca por causa de um filtro que esvaziou o recorte (senao mostraria o
  // universo inteiro num segmento vazio).
  const gestoresRanking = useMemo(() => {
    if (!consolidaveis.length) return gestores
    const base = segmento ? consolidaveis.filter(f => f.segmento === segmento) : consolidaveis
    return aggregateGestores(base)
  }, [consolidaveis, segmento, gestores])

  const mesBase = meta?.mesesRecentes?.[0] || fundos.find(f => f.mesBase)?.mesBase || ''
  const clearFilters = useCallback(() => { setSegmento(''); setClasse(''); setGestor(''); setSearch('') }, [])
  const hasFilter = segmento || classe || gestor || search

  return (
    <section className="fluxo caixa" aria-label="Nível de caixa dos fundos">
      <header className="fluxo-header">
        <h2 className="fluxo-title">Nível de Caixa</h2>
        <p className="fluxo-subtitle">Caixa Potencial dos fundos de crédito — disponibilidades, títulos públicos e compromissadas</p>
        {mesBase && <p className="fluxo-ref">Carteira base {fmtMes(mesBase)} · PL diário e estimativa até {fundos.find(f => f.dataPLDiario)?.dataPLDiario || '—'}</p>}
      </header>

      {loading && (
        <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando nível de caixa…</p></div>
      )}

      {!loading && error && (
        <div className="state-box error">
          <span className="state-icon">⚠️</span>
          <p className="error-msg">Não foi possível carregar o Nível de Caixa.</p>
          <small>{error}</small>
          <button className="btn-retry" onClick={reload}>Tentar novamente</button>
        </div>
      )}

      {!loading && !error && fundos.length > 0 && (
        <>
          {/* Filtros */}
          <div className="caixa-filters">
            <div className="segmented" role="tablist" aria-label="Segmento">
              {SEGMENTOS.map(s => (
                <button key={s.id} type="button" role="tab" aria-selected={segmento === s.id}
                  className={`segmented-btn${segmento === s.id ? ' active' : ''}`}
                  onClick={() => setSegmento(s.id)}>{s.label}</button>
              ))}
            </div>
            <div className="segmented" role="tablist" aria-label="Classificação">
              {CLASSES.map(c => (
                <button key={c.id} type="button" role="tab" aria-selected={classe === c.id}
                  className={`segmented-btn${classe === c.id ? ' active' : ''}`}
                  onClick={() => setClasse(c.id)}>{c.label}</button>
              ))}
            </div>
            <input
              className="caixa-search"
              type="search"
              aria-label="Buscar fundo, gestor ou CNPJ"
              placeholder="Buscar fundo, gestor ou CNPJ…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {gestor && <button type="button" className="caixa-chip-active" onClick={() => setGestor('')}>Gestor: {gestor} ✕</button>}
            {hasFilter && <button type="button" className="btn-clear" onClick={clearFilters}>Limpar</button>}
          </div>

          {/* Cards */}
          <div className="fluxo-cards" aria-label="Indicadores de caixa">
            <Card label="Caixa consolidado" sub="(data-base)" value={fmtFluxo(cards.consolidado)}
              help="Soma do caixa dos fundos compradores diretos, contando o ativo final uma vez (sem feeders, sem dupla contagem via cotas)." />
            <Card label="% do PL" value={fmtPctPL(cards.pctPL)} />
            <Card label="Caixa estimado atual" value={fmtFluxo(cards.estimado)}
              help="% de caixa da última carteira válida × PL diário mais recente do Informe Diário." />
            <div className={`fluxo-card${cards.fluxoPosterior > 0 ? ' fluxo-card-liquido pos' : cards.fluxoPosterior < 0 ? ' fluxo-card-liquido neg' : ''}`}>
              <span className="fluxo-card-label">Pressão de compra posterior
                <span className="fluxo-card-help" title="Fluxo líquido de captação após a data-base. Mostrado à parte — o dinheiro pode já ter sido investido; NÃO somado ao caixa." aria-hidden="true"> ⓘ</span>
              </span>
              <span className="fluxo-card-value">{fmtFluxoSigned(cards.fluxoPosterior)}</span>
            </div>
            <Card label="Fundos caixa" sub="confirmados" value={fmtInt(confirmados)}
              help={`${confirmados} confirmados (≥90% do PL em caixa, estáveis) + ${candidatos} candidatos (75–90%).`} />
            <Card label="Fundos no consolidado" value={fmtInt(cards.nFundos)} />
          </div>

          <CaixaMonthTrend comparacao={meta?.comparacaoMeses} mesRefMadura={meta?.mesRefMadura} filtroAtivo={!!hasFilter} />

          {/* Ranking de gestores (só quando nenhum gestor está selecionado) */}
          {!gestor && <CaixaGestorTable gestores={gestoresRanking} activeGestor={gestor} onSelect={setGestor} />}

          {/* Tabela de fundos */}
          <CaixaFundoTable
            fundos={filtered}
            title={gestor ? `Fundos de ${gestor}` : 'Fundos por caixa potencial'}
            subtitle={gestor
              ? 'Caixa direto (disp.+títulos púb.+compromissadas) e indireto via fundos-caixa'
              : 'Ordenados por caixa potencial total — clique num gestor acima para filtrar'}
          />

          {/* Rodapé: limitações e regra */}
          {meta && (
            <details className="caixa-meta">
              <summary>Metodologia, hipóteses e limitações</summary>
              <div className="caixa-meta-body">
                {meta.discrepancia_839_835 && (
                  <p><strong>Cobertura:</strong> {meta.discrepancia_839_835.descricao}</p>
                )}
                {Array.isArray(meta.regras) && (
                  <>
                    <p><strong>Regras:</strong></p>
                    <ul>{meta.regras.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </>
                )}
                {Array.isArray(meta.limitacoes) && (
                  <>
                    <p><strong>Limitações:</strong></p>
                    <ul>{meta.limitacoes.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </>
                )}
              </div>
            </details>
          )}
        </>
      )}

      {!loading && !error && fundos.length === 0 && (
        <div className="empty-state">
          <span>Sem dados de nível de caixa</span>
          <small>Rode <code>tools/preparar-caixa-potencial.ps1</code> para gerar os arquivos em <code>public/data/</code>.</small>
        </div>
      )}
    </section>
  )
}

function Card({ label, sub, value, help }) {
  return (
    <div className="fluxo-card" title={help || undefined}>
      <span className="fluxo-card-label">
        {label}{sub && <span className="fluxo-card-sub"> {sub}</span>}
        {help && <span className="fluxo-card-help" aria-hidden="true"> ⓘ</span>}
      </span>
      <span className="fluxo-card-value">{value}</span>
    </div>
  )
}

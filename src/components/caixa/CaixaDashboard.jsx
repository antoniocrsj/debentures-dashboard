import { useState, useMemo, useCallback } from 'react'
import { useCaixa } from '../../hooks/useCaixa.js'
import { fmtPctPL, fmtMes, aggregateGestores, ehFundoCredito } from '../../utils/caixa.js'
import { fmtFluxo, fmtFluxoSigned, fmtInt } from '../../utils/fluxo.js'
import CaixaPctPLLine from './CaixaPctPLLine.jsx'
import CaixaGestorTable from './CaixaGestorTable.jsx'
import CaixaFundoTable from './CaixaFundoTable.jsx'

// Mercados vistos SEPARADAMENTE (sem "Todos"): a aba sempre mostra um mercado.
const SEGMENTOS = [
  { id: 'CDI', label: 'Tradicional (CDI)' },
  { id: '12431', label: 'Incentivados (12.431)' },
]
export default function CaixaDashboard({ compact = false }) {
  const { loading, error, fundos, gestores, meta, historico, reload } = useCaixa()
  const [segmento, setSegmento] = useState('CDI')   // padrao: Tradicional (mercados separados)
  const [gestor, setGestor] = useState('')
  const [search, setSearch] = useState('')

  // Gestores do mercado atual (para o dropdown de filtro).
  const gestorOpts = useMemo(() => {
    const base = segmento ? fundos.filter(f => f.segmento === segmento) : fundos
    return [...new Set(base.map(f => f.gestor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [fundos, segmento])

  // Fundos no consolidado (base para os cards e para as tabelas de caixa).
  const consolidaveis = useMemo(() => fundos.filter(f => f.noConsolidado), [fundos])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return fundos.filter(f => {
      if (segmento && f.segmento !== segmento) return false
      if (gestor && f.gestor !== gestor) return false
      if (q && ![f.nome, f.gestor, f.cnpj].some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
  }, [fundos, segmento, gestor, search])

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

  // Fundos CAIXA da analise (money market/soberano): fora do universo de credito
  // e >=90% em caixa. Numero GLOBAL (servem de liquidez pros dois mercados) — nao
  // depende do segmento/gestor. Fundo de credito nunca entra aqui.
  const fundosCaixa = useMemo(() => fundos.filter(f => !ehFundoCredito(f.segmento) && f.classeKind === 'confirmado').length, [fundos])
  const fundosCaixaCand = useMemo(() => fundos.filter(f => !ehFundoCredito(f.segmento) && f.classeKind === 'candidato').length, [fundos])

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
  // "Limpar" zera os sub-filtros mas mantem o mercado escolhido (nunca ha' "Todos").
  const clearFilters = useCallback(() => { setGestor(''); setSearch('') }, [])
  const hasFilter = gestor || search

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
            <select className="caixa-select" aria-label="Filtrar por gestor"
              value={gestor} onChange={e => setGestor(e.target.value)}>
              <option value="">Todos os gestores</option>
              {gestorOpts.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <input
              className="caixa-search"
              type="search"
              aria-label="Buscar fundo, gestor ou CNPJ"
              placeholder="Buscar fundo, gestor ou CNPJ…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {hasFilter && <button type="button" className="btn-clear" onClick={clearFilters}>Limpar</button>}
          </div>

          {/* Cards */}
          <div className="fluxo-cards" aria-label="Indicadores de caixa">
            <Card label="Caixa consolidado" sub="(data-base)" value={fmtFluxo(cards.consolidado)}
              help="Soma do caixa dos fundos compradores diretos, contando o ativo final uma vez (sem feeders, sem dupla contagem via cotas)." />
            <Card label="% do PL" value={fmtPctPL(cards.pctPL)} />
            <Card label="Caixa estimado" value={fmtFluxo(cards.estimado)}
              help="% de caixa da última carteira válida × PL diário mais recente do Informe Diário." />
            <div className={`fluxo-card${cards.fluxoPosterior > 0 ? ' fluxo-card-liquido pos' : cards.fluxoPosterior < 0 ? ' fluxo-card-liquido neg' : ''}`}>
              <span className="fluxo-card-label">Pressão de compra posterior
                <span className="fluxo-card-help" title="Fluxo líquido de captação após a data-base. Mostrado à parte — o dinheiro pode já ter sido investido; NÃO somado ao caixa." aria-hidden="true"> ⓘ</span>
              </span>
              <span className="fluxo-card-value">{fmtFluxoSigned(cards.fluxoPosterior)}</span>
            </div>
            <Card label="Fundos caixa" sub="na análise" value={fmtInt(fundosCaixa)}
              help={`${fundosCaixa} fundos caixa (≥90% do PL em caixa/públicos/compromissada) + ${fundosCaixaCand} candidatos (75–90%). São os fundos de liquidez (money market/soberano) onde os fundos de crédito aplicam — fora das suas listas. Fundo de crédito nunca é fundo caixa. Número global (servem aos dois mercados).`} />
            <Card label="Fundos no consolidado" value={fmtInt(cards.nFundos)} />
          </div>

          <CaixaPctPLLine historico={historico} segmento={segmento} gestor={gestor} />

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

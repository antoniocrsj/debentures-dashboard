import { useState, useMemo, useCallback } from 'react'
import { useCaixa } from '../../hooks/useCaixa.js'
import { fmtPctPL, fmtMes, aggregateGestores, ehFundoCredito } from '../../utils/caixa.js'
import { fmtFluxo, fmtFluxoSigned, fmtInt } from '../../utils/fluxo.js'
import CaixaPctPLLine from './CaixaPctPLLine.jsx'
import CaixaGestorTable from './CaixaGestorTable.jsx'
import CaixaFundoTable from './CaixaFundoTable.jsx'
import CaixaFundosCaixaTable from './CaixaFundosCaixaTable.jsx'
import { CORTE_OFICIAL, isOficial, normCnpj, cnpjsNoCorte, historicoNoCorte } from '../../utils/corte.js'
import { useCaixaFundosHistorico } from '../../hooks/useCaixaFundosHistorico.js'

// Mercados vistos SEPARADAMENTE (sem "Todos"): a aba sempre mostra um mercado.
const SEGMENTOS = [
  { id: 'CDI', label: 'Tradicional' },
  { id: '12431', label: '12.431' },
]
export default function CaixaDashboard({ compact = false, corte = CORTE_OFICIAL, pctPorCnpj = null }) {
  const { loading, error, fundos: fundosBase, gestores, meta, historico: historicoBase, reload } = useCaixa()

  // Corte de %Deb no grafico de %PL em caixa: o agregado nao tem CNPJ, entao
  // fora do corte oficial troca pela serie POR FUNDO filtrada (carregada sob
  // demanda -- so' quando o corte sai do oficial). Mesmo caminho da aba Tecnica.
  const corteAtivo = !isOficial(corte) && !!pctPorCnpj
  const { rows: caixaFundos } = useCaixaFundosHistorico(corteAtivo)
  const historico = useMemo(() => {
    if (!corteAtivo || !caixaFundos?.length) return historicoBase
    return historicoNoCorte(caixaFundos, cnpjsNoCorte(pctPorCnpj, corte))
  }, [corteAtivo, caixaFundos, historicoBase, pctPorCnpj, corte])

  // Corte de %Deb global: como TODO o resto da aba (cards, ranking, tabelas)
  // deriva de `fundos`, filtrar na origem propaga sozinho. No corte oficial
  // devolve a base intacta -- o numero de sempre, sem passar por filtro.
  const fundos = useMemo(() => {
    if (isOficial(corte) || !pctPorCnpj) return fundosBase
    return fundosBase.filter(f => {
      const p = pctPorCnpj.get(normCnpj(f.cnpj))
      return p != null && p > corte
    })
  }, [fundosBase, pctPorCnpj, corte])
  const [segmento, setSegmento] = useState('CDI')   // padrao: Tradicional (mercados separados)
  const [gestor, setGestor] = useState('')

  // Gestores do mercado atual (para o dropdown de filtro).
  const gestorOpts = useMemo(() => {
    const base = segmento ? fundos.filter(f => f.segmento === segmento) : fundos
    return [...new Set(base.map(f => f.gestor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [fundos, segmento])

  // Fundos no consolidado (base para os cards e para as tabelas de caixa).
  const consolidaveis = useMemo(() => fundos.filter(f => f.noConsolidado), [fundos])

  const filtered = useMemo(() => {
    return fundos.filter(f => {
      if (segmento && f.segmento !== segmento) return false
      if (gestor && f.gestor !== gestor) return false
      return true
    })
  }, [fundos, segmento, gestor])

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
  const fundosCaixaAll = useMemo(() => fundos.filter(f =>
    !ehFundoCredito(f.segmento) && (f.classeKind === 'confirmado' || f.classeKind === 'candidato')), [fundos])
  const fundosCaixa = useMemo(() => fundosCaixaAll.filter(f => f.classeKind === 'confirmado').length, [fundosCaixaAll])
  const fundosCaixaCand = fundosCaixaAll.length - fundosCaixa

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
  const clearFilters = useCallback(() => { setGestor('') }, [])
  const hasFilter = gestor

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
            {/* SEMPRE montado (so' desabilita): se ele aparecesse/sumisse com o
                filtro, a barra quebraria de linha e empurraria todo o conteudo
                ~38px ao selecionar uma gestora -- o layout pulava embaixo do
                cursor justo quando se troca de gestora ponto a ponto. */}
            <button type="button" className="btn-clear" onClick={clearFilters} disabled={!hasFilter}>Limpar</button>
          </div>

          {/* Cards */}
          <div className="fluxo-cards" aria-label="Indicadores de caixa">
            {/* Rotulos CURTOS (1 linha): o grid iguala a altura dos 6 cards pelo
                maior, entao um rotulo que quebra em 2 linhas engorda TODOS. O
                detalhe ("data-base", "posterior", "na analise"...) vive no ⓘ. */}
            <Card label="Caixa consolidado" value={fmtFluxo(cards.consolidado)}
              help="Na data-base da carteira. Soma do caixa dos fundos compradores diretos, contando o ativo final uma vez (sem feeders, sem dupla contagem via cotas)." />
            <Card label="% do PL" value={fmtPctPL(cards.pctPL)} />
            <Card label="Caixa estimado" value={fmtFluxo(cards.estimado)}
              help="% de caixa da última carteira válida × PL diário mais recente do Informe Diário." />
            <div className={`fluxo-card${cards.fluxoPosterior > 0 ? ' fluxo-card-liquido pos' : cards.fluxoPosterior < 0 ? ' fluxo-card-liquido neg' : ''}`}>
              <span className="fluxo-card-label">Pressão de compra
                <span className="fluxo-card-help" title="Fluxo líquido de captação APÓS a data-base. Mostrado à parte — o dinheiro pode já ter sido investido; NÃO somado ao caixa." aria-hidden="true"> ⓘ</span>
              </span>
              <span className="fluxo-card-value">{fmtFluxoSigned(cards.fluxoPosterior)}</span>
            </div>
            <Card label="Fundos caixa" value={fmtInt(fundosCaixa)}
              help={`Na análise: ${fundosCaixa} fundos caixa (≥90% do PL em caixa/públicos/compromissada) + ${fundosCaixaCand} candidatos (75–90%). São os fundos de liquidez (money market/soberano) onde os fundos de crédito aplicam — fora das suas listas. Fundo de crédito nunca é fundo caixa. Número global (servem aos dois mercados).`} />
            <Card label="Fundos" value={fmtInt(cards.nFundos)}
              help="Fundos de crédito incluídos no consolidado (compradores diretos, sem feeders)." />
          </div>

          {/* Mesma disposição da Captação: no desktop o gráfico fica à esquerda e
              o ranking de gestores à direita, na mesma altura; no compacto empilham. */}
          <div className="caixa-main-row">
            {/* O grafico agora SEGUE o corte: fora do oficial, `historico` vem da
                serie por fundo (Caixa_Potencial_Fundos_Historico) reagregada so'
                com os fundos acima da regua. No oficial, o agregado leve. */}
            <CaixaPctPLLine historico={historico} segmento={segmento} gestor={gestor} />
            {/* A tabela fica SEMPRE montada: selecionar uma gestora nao pode
                remove-la do DOM, senao o grafico (flex) se estica e o layout
                pula embaixo do cursor. Selecionar so' filtra o grafico/os cards
                e destaca a linha -- as outras gestoras continuam ali, pra dar
                pra ir trocando ponto a ponto. Clicar na ativa desmarca. */}
            <CaixaGestorTable
              gestores={gestoresRanking}
              activeGestor={gestor}
              onSelect={g => setGestor(cur => (cur === g ? '' : g))}
            />
          </div>

          {/* Tabelas em 2 colunas no desktop (a de fundos e' a larga) */}
          <div className="caixa-tables-row">
            <CaixaFundoTable
              className="caixa-col-wide"
              fundos={filtered}
              title={gestor ? `Fundos de ${gestor}` : 'Fundos por caixa potencial'}
              subtitle={gestor
                ? 'Caixa direto (disp.+títulos púb.+compromissadas) e indireto via fundos-caixa'
                : 'Ordenados por caixa potencial total — clique num gestor acima para filtrar'}
            />
            {/* Fundos caixa (liquidez): os money market/soberano onde o crédito
                aplica. Lista global — independe do mercado/gestor selecionado. */}
            <CaixaFundosCaixaTable className="caixa-col-narrow" fundos={fundosCaixaAll} />
          </div>

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

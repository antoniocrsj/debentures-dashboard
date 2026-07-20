import { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import { useDebentures, BLC_DEFAULT_URL } from './hooks/useDebentures.js'
import { usePeriodReports } from './hooks/usePeriodReports.js'
import { useAgenda12m } from './hooks/useAgenda12m.js'
import {
  buildIndexes, buildBlcIndex, buildAnbimaIndex, buildPlByGestor,
  enrichDebenture, computeManagers, computeGroups, recomputeAlocByGestor
} from './utils/data.js'
import { isYes, dateKey, fmtDateOnly, parseBRDateTime, parseISODate, fmtMesAno } from './utils/format.js'
import { lazyWithRetry } from './utils/lazyWithRetry.js'
import Header from './components/Header.jsx'
import BottomNav from './components/BottomNav.jsx'
import Filters from './components/Filters.jsx'
import AssetTable from './components/AssetTable.jsx'
import BlcMaturitySelo from './components/BlcMaturitySelo.jsx'
import AssetModal from './components/AssetModal.jsx'
import ManagerRanking from './components/ManagerRanking.jsx'
import GroupRanking from './components/GroupRanking.jsx'
import MonthSelector from './components/MonthSelector.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Resumo do Dia (modal do relógio) — carregado sob demanda.
const ResumoDoDiaModal = lazyWithRetry(() => import('./components/ResumoDoDiaModal.jsx'))

// Aba Captação carregada sob demanda (Recharts só entra ao abrir a aba).
// lazyWithRetry: re-tenta o import se o chunk falhar (evita tela em branco).
const FluxoDashboard = lazyWithRetry(() => import('./components/fluxo/FluxoDashboard.jsx'))
const VencimentosDashboard = lazyWithRetry(() => import('./components/vencimentos/VencimentosDashboard.jsx'))
const CaixaDashboard = lazyWithRetry(() => import('./components/caixa/CaixaDashboard.jsx'))
const TecnicoDashboard = lazyWithRetry(() => import('./components/tecnico/TecnicoDashboard.jsx'))

// Painel de controle da atualização: só existe no bundle de DEV. Em produção
// import.meta.env.DEV é substituído por `false` em tempo de build e o Rollup
// elimina este branch inteiro (import incluído) do bundle publicado.
const ControlPanel = import.meta.env.DEV
  ? lazyWithRetry(() => import('./components/ControlPanel.jsx'))
  : null

const DEFAULT_MONTHS = [{ label: 'Fev/26', url: BLC_DEFAULT_URL }]

function loadMonths() {
  try {
    const s = JSON.parse(localStorage.getItem('blc-months') || '[]')
    return Array.isArray(s) && s.length ? s : DEFAULT_MONTHS
  } catch { return DEFAULT_MONTHS }
}

function saveMonths(m) {
  try { localStorage.setItem('blc-months', JSON.stringify(m)) } catch {}
}

const INIT_FILTERS = { grupo: '', setor: '', gestor: '', lei12431: '', ativo: '', search: '' }
const INIT_SORT    = { col: 'emissao', dir: 'desc' }
const PAGE_SIZE    = 100  // mostra os 100 mais recentes ao abrir

export default function App() {
  const [months, setMonths]           = useState(loadMonths)
  const [monthIdx, setMonthIdx]       = useState(0)
  const [tab, setTab]                 = useState(() => {
    // Atalho da area de trabalho: abre direto no painel (só em dev, onde ele existe).
    if (import.meta.env.DEV && window.location.hash === '#atualizacao') return 'atualizacao'
    return localStorage.getItem('view-desktop') === '1' && window.innerWidth >= 700 ? 'debentures' : 'ativos'
  })
  const [filters, setFilters]         = useState(INIT_FILTERS)
  const [sort, setSort]               = useState(INIT_SORT)
  const [selectedAsset, setSelected]  = useState(null)
  const [showMonths, setShowMonths]   = useState(false)
  const [showResumo, setShowResumo]   = useState(false)
  const periodReports = usePeriodReports()
  const [showAll, setShowAll]         = useState(false)
  const [desktop, setDesktop]         = useState(() => {
    try { return localStorage.getItem('view-desktop') === '1' && window.innerWidth >= 700 } catch { return false }
  })

  const toggleDesktop = useCallback(() => setDesktop(d => !d), [])

  // Seção atual (compacto): 'debentures' (abas Ativos/Gestores/Grupos), 'captacao'
  // ou 'atualizacao' (painel de controle, dev-only).
  const [lastDebTab, setLastDebTab] = useState('ativos')   // lembra a sub-aba ao voltar p/ Debêntures
  const section = tab === 'captacao' ? 'captacao'
    : tab === 'vencimentos' ? 'vencimentos'
    : tab === 'caixa' ? 'caixa'
    : tab === 'atualizacao' ? 'atualizacao'
    : 'debentures'
  const selectSection = useCallback(
    s => setTab(s === 'captacao' || s === 'vencimentos' || s === 'caixa' || s === 'atualizacao' ? s : lastDebTab),
    [lastDebTab]
  )
  const { data: agenda12m } = useAgenda12m()

  useEffect(() => {
    try { localStorage.setItem('view-desktop', desktop ? '1' : '0') } catch {}
    setTab(t => {
      if (desktop && (t === 'ativos' || t === 'gestores' || t === 'grupos')) return 'debentures'
      if (!desktop && t === 'debentures') return 'ativos'
      // "Técnico" é desktop-only (sem entrada no BottomNav) — se o usuário
      // alternar pra compacto enquanto está nela, volta pra uma aba válida.
      if (!desktop && t === 'tecnico') return 'ativos'
      return t
    })
  }, [desktop])

  // Título da aba do navegador: no painel (dev) mostra "Painel de Atualização".
  useEffect(() => {
    document.title = section === 'atualizacao' ? 'Painel de Atualização - Luc' : 'Luc'
  }, [section])

  // Sempre que mudar filtro/busca, volta a limitar (evita renderizar tudo)
  useEffect(() => { setShowAll(false) }, [filters])

  const currentMonth = months[monthIdx] ?? months[0]
  const { loading, refreshing, error, raw } = useDebentures(currentMonth.url)

  // Data de atualização real de cada fonte (não a hora em que o navegador buscou/cacheou).
  const dataFreshness = useMemo(() => {
    if (!raw) return null
    const sources = []

    const debGen = parseBRDateTime(raw.debenturesMeta?.generatedAtSource)
    if (debGen) sources.push({ label: 'Debêntures (cadastro)', date: debGen })

    const anbimaIso = raw.anbima?.find(r => r.dataReferenciaAnbima)?.dataReferenciaAnbima
    const anbimaDate = parseISODate(anbimaIso)
    if (anbimaDate) sources.push({ label: 'ANBIMA', date: anbimaDate })

    const mesRef = fmtMesAno(raw.blcMeta?.mesAno)
    if (mesRef) sources.push({ label: 'Carteira dos fundos (BLC)', date: null, text: mesRef })

    if (!sources.length) return null
    const dated = sources.filter(s => s.date)
    const latest = dated.length ? dated.reduce((a, b) => (b.date > a.date ? b : a)) : null

    return {
      label: latest ? fmtDateOnly(latest.date) : '',
      tooltip: sources.map(s => `${s.label}: ${s.text || fmtDateOnly(s.date)}`).join('\n'),
    }
  }, [raw])

  // Build indexes once per raw load
  const indexes = useMemo(() => {
    if (!raw) return null
    return {
      ...buildIndexes(raw),
      blcByAtivo: buildBlcIndex(raw.blc),
      anbimaByTicker: buildAnbimaIndex(raw.anbima),
    }
  }, [raw])

  const plByGestor = useMemo(() => buildPlByGestor(raw?.plGestores), [raw])

  // Data de referencia da ANBIMA (vem do arquivo, nao do relogio). DD/MM/AAAA.
  const anbimaRef = useMemo(() => {
    const d = raw?.anbima?.find(r => r.dataReferenciaAnbima)?.dataReferenciaAnbima
    if (!d) return ''
    const [y, m, dd] = d.split('-')
    return (y && m && dd) ? `${dd}/${m}/${y}` : d
  }, [raw])

  // Enrich all debentures
  const allAssets = useMemo(() => {
    if (!raw || !indexes) return []
    return raw.debentures.map(d => enrichDebenture(d, indexes))
  }, [raw, indexes])

  // Distinct filter options (from full dataset)
  const options = useMemo(() => ({
    grupos:    [...new Set(allAssets.map(a => a.grupo).filter(Boolean))].sort(),
    setores:   [...new Set(allAssets.map(a => a.setor).filter(Boolean))].sort(),
    gestores:  [...new Set(allAssets.flatMap(a => a.gestores))].sort(),
    ativos:    [...new Set(allAssets.map(a => a.codigoAtivo).filter(Boolean))].sort(),
  }), [allAssets])

  // Apply filters
  const filteredAssets = useMemo(() => {
    const q = filters.search.toLowerCase()
    let assets = allAssets.filter(a => {
      if (filters.grupo    && a.grupo           !== filters.grupo)           return false
      if (filters.setor    && a.setor           !== filters.setor)           return false
      if (filters.gestor   && !a.gestores.includes(filters.gestor))          return false
      if (filters.lei12431 === 'Sim' && !isYes(a.lei12431Str))              return false
      if (filters.lei12431 === 'Não' && isYes(a.lei12431Str))               return false
      if (filters.ativo    && a.codigoAtivo     !== filters.ativo)           return false
      if (q && ![a.codigoAtivo, a.emissorNome, a.grupo, a.setor]
        .some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
    // Quando gestor está ativo, mostra só a alocação desse gestor
    if (filters.gestor && indexes) {
      assets = recomputeAlocByGestor(assets, indexes.blcByAtivo, filters.gestor)
    }
    return assets
  }, [allAssets, filters, indexes])

  // Sort
  const sortedAssets = useMemo(() => {
    const arr = [...filteredAssets]
    const { col, dir } = sort
    if (!col) return arr
    const key = a => {
      if (col === 'ativo')      return (a.codigoAtivo || '').toLowerCase()
      if (col === 'emissao')    return dateKey(a.emissao)
      if (col === 'vencimento') return dateKey(a.vencimento)
      if (col === 'taxa')       return parseFloat((a.taxa || '').replace(',', '.')) || 0
      if (col === 'vol')        return a.volumeEmitido
      if (col === 'alocacao')   return a.alocacao
      return ''
    }
    arr.sort((a, b) => {
      const va = key(a), vb = key(b)
      const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb)
      return dir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filteredAssets, sort])

  // No desktop a tabela tem scroll próprio → mostra tudo. No mobile limita a 100.
  const displayedAssets = useMemo(
    () => (showAll || desktop) ? sortedAssets : sortedAssets.slice(0, PAGE_SIZE),
    [showAll, sortedAssets, desktop]
  )

  const handleSort = useCallback(col =>
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'desc' }
    ), [])

  // Toggle cross-filter: clica no mesmo valor → limpa
  const handleFilter = useCallback((key, value) =>
    setFilters(f => ({ ...f, [key]: f[key] === value ? '' : value }))
  , [])

  // Abre o modal de outra debenture pelo codigo (ex.: series irmas de um book).
  // Se estiver na base atual, abre o modal dela; senao filtra a tabela por ela.
  const openTicker = useCallback(cod => {
    const a = allAssets.find(x => x.codigoAtivo === cod)
    if (a) setSelected(a)
    else { setSelected(null); setFilters(f => ({ ...f, ativo: cod })) }
  }, [allAssets])

  // Manager ranking — only BLC rows for currently-filtered assets
  const filteredCodes = useMemo(
    () => new Set(filteredAssets.map(a => a.codigoAtivo)),
    [filteredAssets]
  )

  const managers = useMemo(() => {
    if (!raw || !indexes) return []
    const subset = raw.blc.filter(r =>
      filteredCodes.has((r['CD_ATIVO'] || r['Codigo do Ativo'] || '').trim())
    )
    return computeManagers(subset, plByGestor)
  }, [raw, indexes, filteredCodes, plByGestor])

  const groups = useMemo(() => computeGroups(filteredAssets), [filteredAssets])

  // PL do gestor selecionado — habilita a coluna %PL no ranking de Grupos.
  const selectedGestorPl = filters.gestor ? (plByGestor[filters.gestor] || 0) : 0

  const handleMonthsChange = useCallback((newMonths, idx) => {
    setMonths(newMonths)
    setMonthIdx(idx)
    saveMonths(newMonths)
  }, [])

  const tabsNav = (
    <nav className={`tabs${desktop ? ' tabs-inline' : ''}`} role="tablist">
      {(desktop
        ? [
            { id: 'debentures',  label: 'Debêntures' },
            { id: 'captacao',    label: 'Captação' },
            { id: 'caixa',       label: 'Nível de Caixa' },
            { id: 'vencimentos', label: 'Vencimentos' },
            { id: 'tecnico',     label: 'Técnico' },
          ]
        : [
            // Captação saiu daqui (virou ícone no header — GER-2); restam as sub-abas de Debêntures.
            { id: 'ativos',   label: `Ativos (${filteredAssets.length.toLocaleString('pt-BR')})` },
            { id: 'gestores', label: `Gestores (${managers.length.toLocaleString('pt-BR')})` },
            { id: 'grupos',   label: `Grupos (${groups.length.toLocaleString('pt-BR')})` },
          ]
      ).map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={`tab-btn tab-${t.id}${tab === t.id ? ' active' : ''}`}
          onClick={() => {
            setTab(t.id)
            if (t.id === 'ativos' || t.id === 'gestores' || t.id === 'grupos') setLastDebTab(t.id)
          }}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )

  return (
    <div className={`app${desktop ? ' desktop' : ''}`}>

      {/* Fixed header */}
      <Header
        loading={loading}
        refreshing={refreshing}
        error={!!error}
        desktop={desktop}
        onToggleView={toggleDesktop}
        section={section}
        onSection={selectSection}
        hasResumo={periodReports.hasAny}
        onOpenResumo={() => setShowResumo(true)}
      />

      {/* Filters + tabs scroll together as one sticky block */}
      <div className="sticky-area">
        {section === 'debentures' && (
          <Filters
            filters={filters}
            options={options}
            disabled={loading}
            onChange={setFilters}
            tabsSlot={desktop ? tabsNav : null}
            updatedLabel={dataFreshness?.label}
            updatedTooltip={dataFreshness?.tooltip}
            compact={!desktop}
          />
        )}

        {/* Desktop: abas standalone só na Captação (nas demais vão ao lado da busca).
            Compacto: sub-abas só na seção Debêntures (Captação não tem sub-abas). */}
        {(desktop ? (tab === 'captacao' || tab === 'vencimentos' || tab === 'caixa' || tab === 'tecnico') : section === 'debentures') && tabsNav}
      </div>

      {/* Scrollable content */}
      <main className="content" role="tabpanel">
        {/* Aba Captação: independente do carregamento do BLC/debêntures.
            ErrorBoundary garante que uma falha no import do chunk NUNCA deixe
            a aba em branco — mostra erro + "Tentar novamente". */}
        {tab === 'captacao' && (
          <ErrorBoundary label="a Captação">
            <Suspense fallback={
              <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
            }>
              <FluxoDashboard compact={!desktop} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* Nível de Caixa: Caixa Potencial dos fundos (disp.+títulos púb.+compromissadas),
            fundos-caixa (look-through) e estimativa atual. Independente do BLC/debêntures. */}
        {tab === 'caixa' && (
          <ErrorBoundary label="o Nível de Caixa">
            <Suspense fallback={
              <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
            }>
              <CaixaDashboard compact={!desktop} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* Vencimentos 12m: juros + amortizacao previstos, por carteira/mercado. */}
        {tab === 'vencimentos' && (
          <ErrorBoundary label="os Vencimentos">
            <Suspense fallback={
              <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
            }>
              <VencimentosDashboard data={agenda12m} blc={raw?.blc} assets={allAssets} plByGestor={plByGestor} compact={!desktop} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* Tecnico: Captacao + Caixa + Vencimentos sob o mesmo filtro de gestora.
            Desktop apenas (sem entrada no BottomNav do compacto). */}
        {tab === 'tecnico' && (
          <ErrorBoundary label="a visão Técnica">
            <Suspense fallback={
              <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
            }>
              <TecnicoDashboard agenda12m={agenda12m} blc={raw?.blc} plByGestor={plByGestor} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* Painel de controle da atualização: dev-only (ControlPanel é null em produção). */}
        {tab === 'atualizacao' && ControlPanel && (
          <ErrorBoundary label="o Painel de Atualização">
            <Suspense fallback={
              <div className="state-box"><div className="spinner" aria-label="Carregando" /><p>Carregando…</p></div>
            }>
              <ControlPanel />
            </Suspense>
          </ErrorBoundary>
        )}

        {section === 'debentures' && loading && (
          <div className="state-box">
            <div className="spinner" aria-label="Carregando" />
            <p>Carregando dados…</p>
          </div>
        )}

        {section === 'debentures' && !loading && error && (
          <div className="state-box error">
            <span className="state-icon">⚠️</span>
            <p className="error-msg">{error}</p>
            <small>
              Se for erro de CORS, adicione o header no Apps Script:<br />
              <code>ContentService.createTextOutput(csv).setMimeType(MimeType.CSV)</code><br />
              e republique com acesso <em>"Qualquer pessoa"</em>.
            </small>
          </div>
        )}

        {section === 'debentures' && tab !== 'debentures' && !loading && !error && raw && (
          <>
            <BlcMaturitySelo maturidade={raw.blcMaturidade} />
            {tab === 'ativos' && (
              <>
                <AssetTable
                  assets={displayedAssets}
                  sort={sort}
                  onSort={handleSort}
                  activeAtivo={filters.ativo}
                  onFilter={handleFilter}
                  onInfoClick={setSelected}
                  anbimaRef={anbimaRef}
                  desktop={desktop}
                />
                {!showAll && filteredAssets.length > PAGE_SIZE && (
                  <button className="show-all-btn" onClick={() => setShowAll(true)}>
                    Mostrando {PAGE_SIZE} de {filteredAssets.length.toLocaleString('pt-BR')} ativos — ver todos
                  </button>
                )}
              </>
            )}
            {tab === 'gestores' && (
              <ManagerRanking
                managers={managers}
                activeGestor={filters.gestor}
                onFilter={handleFilter}
                desktop={desktop}
              />
            )}
            {tab === 'grupos' && (
              <GroupRanking
                groups={groups}
                activeGrupo={filters.grupo}
                onFilter={handleFilter}
                gestorPl={selectedGestorPl}
                desktop={desktop}
              />
            )}
          </>
        )}

        {tab === 'debentures' && !loading && !error && raw && (
          <>
            <AssetTable
              assets={displayedAssets}
              sort={sort}
              onSort={handleSort}
              activeAtivo={filters.ativo}
              onFilter={handleFilter}
              onInfoClick={setSelected}
              anbimaRef={anbimaRef}
              desktop={desktop}
            />
            <div className="desktop-split">
              <div className="desktop-split-col">
                <ManagerRanking
                  managers={managers}
                  activeGestor={filters.gestor}
                  onFilter={handleFilter}
                  desktop={desktop}
                />
              </div>
              <div className="desktop-split-col">
                <GroupRanking
                  groups={groups}
                  activeGrupo={filters.grupo}
                  onFilter={handleFilter}
                  gestorPl={selectedGestorPl}
                  desktop={desktop}
                />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Navegação por abas no rodapé — só no compacto (substitui os ícones do topo). */}
      {!desktop && <BottomNav section={section} onSection={selectSection} />}

      {selectedAsset && (
        <AssetModal asset={selectedAsset} onClose={() => setSelected(null)} onSelectTicker={openTicker} />
      )}

      {showMonths && (
        <MonthSelector
          months={months}
          monthIdx={monthIdx}
          onChange={handleMonthsChange}
          onClose={() => setShowMonths(false)}
        />
      )}

      {showResumo && periodReports.hasAny && (
        <Suspense fallback={null}>
          <ResumoDoDiaModal {...periodReports} onClose={() => setShowResumo(false)} />
        </Suspense>
      )}

    </div>
  )
}

import { useState, useMemo, useCallback } from 'react'
import { useDebentures, BLC_DEFAULT_URL } from './hooks/useDebentures.js'
import {
  buildIndexes, buildBlcIndex,
  enrichDebenture, computeManagers, computeGroups
} from './utils/data.js'
import { isYes, dateKey } from './utils/format.js'
import Header from './components/Header.jsx'
import Filters from './components/Filters.jsx'
import AssetTable from './components/AssetTable.jsx'
import AssetModal from './components/AssetModal.jsx'
import ManagerRanking from './components/ManagerRanking.jsx'
import GroupRanking from './components/GroupRanking.jsx'
import MonthSelector from './components/MonthSelector.jsx'

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

const INIT_FILTERS = { grupo: '', setor: '', lei12431: '', ativo: '', search: '' }
const INIT_SORT    = { col: 'alocacao', dir: 'desc' }

export default function App() {
  const [months, setMonths]           = useState(loadMonths)
  const [monthIdx, setMonthIdx]       = useState(0)
  const [tab, setTab]                 = useState('ativos')
  const [filters, setFilters]         = useState(INIT_FILTERS)
  const [sort, setSort]               = useState(INIT_SORT)
  const [selectedAsset, setSelected]  = useState(null)
  const [showMonths, setShowMonths]   = useState(false)

  const currentMonth = months[monthIdx] ?? months[0]
  const { loading, error, raw } = useDebentures(currentMonth.url)

  // Build indexes once per raw load
  const indexes = useMemo(() => {
    if (!raw) return null
    return { ...buildIndexes(raw), blcByAtivo: buildBlcIndex(raw.blc) }
  }, [raw])

  // Enrich all debentures
  const allAssets = useMemo(() => {
    if (!raw || !indexes) return []
    return raw.debentures.map(d => enrichDebenture(d, indexes))
  }, [raw, indexes])

  // Distinct filter options (from full dataset)
  const options = useMemo(() => ({
    grupos:      [...new Set(allAssets.map(a => a.grupo).filter(Boolean))].sort(),
    setores:     [...new Set(allAssets.map(a => a.setor).filter(Boolean))].sort(),
    indexadores: [...new Set(allAssets.map(a => a.indexador).filter(Boolean))].sort(),
    ativos:      [...new Set(allAssets.map(a => a.codigoAtivo).filter(Boolean))].sort(),
  }), [allAssets])

  // Apply filters
  const filteredAssets = useMemo(() => {
    const q = filters.search.toLowerCase()
    return allAssets.filter(a => {
      if (filters.grupo     && a.grupo     !== filters.grupo)     return false
      if (filters.setor     && a.setor     !== filters.setor)     return false
if (filters.lei12431 === 'Sim' && !isYes(a.lei12431Str))   return false
      if (filters.lei12431 === 'Não' && isYes(a.lei12431Str))    return false
      if (filters.ativo     && a.codigoAtivo !== filters.ativo)  return false
      if (q && ![a.codigoAtivo, a.emissorNome, a.grupo, a.setor, a.indexador]
        .some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
  }, [allAssets, filters])

  // Sort
  const sortedAssets = useMemo(() => {
    const arr = [...filteredAssets]
    const { col, dir } = sort
    if (!col) return arr
    const key = a => {
      if (col === 'ativo')      return (a.codigoAtivo || '').toLowerCase()
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

  const handleSort = useCallback(col =>
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'desc' }
    ), [])

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
    return computeManagers(subset, indexes.fundoMap)
  }, [raw, indexes, filteredCodes])

  const groups = useMemo(() => computeGroups(filteredAssets), [filteredAssets])

  const handleMonthsChange = useCallback((newMonths, idx) => {
    setMonths(newMonths)
    setMonthIdx(idx)
    saveMonths(newMonths)
  }, [])

  return (
    <div className="app">

      {/* Fixed header */}
      <Header
        loading={loading}
        error={!!error}
        currentMonth={currentMonth}
        onMonthClick={() => setShowMonths(true)}
      />

      {/* Filters + tabs scroll together as one sticky block */}
      <div className="sticky-area">
        <Filters
          filters={filters}
          options={options}
          disabled={loading}
          onChange={setFilters}
        />

        <nav className="tabs" role="tablist">
          {[
            { id: 'ativos',   label: `Ativos (${filteredAssets.length})` },
            { id: 'gestores', label: 'Gestores' },
            { id: 'grupos',   label: 'Grupos' },
          ].map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Scrollable content */}
      <main className="content" role="tabpanel">
        {loading && (
          <div className="state-box">
            <div className="spinner" aria-label="Carregando" />
            <p>Carregando dados…</p>
          </div>
        )}

        {!loading && error && (
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

        {!loading && !error && raw && (
          <>
            {tab === 'ativos'   && (
              <AssetTable
                assets={sortedAssets}
                sort={sort}
                onSort={handleSort}
                onRowClick={setSelected}
              />
            )}
            {tab === 'gestores' && <ManagerRanking managers={managers} />}
            {tab === 'grupos'   && <GroupRanking   groups={groups}   />}
          </>
        )}
      </main>

      {selectedAsset && (
        <AssetModal asset={selectedAsset} onClose={() => setSelected(null)} />
      )}

      {showMonths && (
        <MonthSelector
          months={months}
          monthIdx={monthIdx}
          onChange={handleMonthsChange}
          onClose={() => setShowMonths(false)}
        />
      )}

    </div>
  )
}

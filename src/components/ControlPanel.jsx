import { useState, useRef, useCallback, useEffect } from 'react'

// Painel de controle da atualização — SÓ EXISTE em dev (import.meta.env.DEV,
// ver App.jsx). Fala com as rotas dev-only registradas em vite.config.js
// (spawn de tools/*.ps1 + streaming via SSE). Nunca é incluído no build de
// produção nem funciona fora de `npm run dev` no notebook do operador.

const MODOS = [
  { id: 'Auto', label: 'Auto', hint: 'completa só se a lista de fundos mudou (padrão histórico)' },
  { id: 'Incremental', label: 'Incremental', hint: 'rápido: só mês atual + anterior' },
  { id: 'Completa', label: 'Completa', hint: 'últimos 12 meses — repopula %CDI 3m/6m/12m' },
]

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fmtMesAno = yyyymm => `${MESES_PT[+yyyymm.slice(4, 6) - 1]}/${yyyymm.slice(2, 4)}`

// Últimos 6 meses em AAAAMM (do mais recente ao mais antigo).
function ultimosMeses(n = 6) {
  const now = new Date()
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// Mês-alvo do BLC pela regra de defasagem da CVM (dia<=15 → -5; senão -4).
function blcMesAlvo() {
  const now = new Date()
  const lag = now.getDate() <= 15 ? 5 : 4
  const d = new Date(now.getFullYear(), now.getMonth() - lag, 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

const PROGRESS_RE = /^##PROGRESS (\d+)\/(\d+) (.+)##$/

function LogLine({ entry }) {
  const cls = {
    meta: 'cp-log-meta',
    stdout: 'cp-log-stdout',
    stderr: 'cp-log-stderr',
    done: 'cp-log-done',
  }[entry.stream] || 'cp-log-stdout'
  if (entry.stream === 'done') {
    if (entry.text === '130') return <div className="cp-log-stderr">■ cancelado</div>
    const ok = entry.text === '0'
    return <div className={cls}>{ok ? '✔ concluído (código 0)' : `✘ terminou com código ${entry.text}`}</div>
  }
  return <div className={cls}>{entry.text}</div>
}

export default function ControlPanel() {
  const [modo, setModo] = useState('Auto')
  // Etapas ligadas/desligadas (checkbox). Fundos é ação separada (não entra aqui).
  const [steps, setSteps] = useState({ debentures: true, captacao: true, blc: false, anbima: true, ofertas: true, relatorios: true })
  const [blcMes, setBlcMes] = useState(blcMesAlvo())

  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const [actionLabel, setActionLabel] = useState('')
  const [error, setError] = useState('')
  const [resumo, setResumo] = useState(null)
  const [progress, setProgress] = useState(null)   // { n, total, title }
  const [stepElapsed, setStepElapsed] = useState(0) // segundos na etapa atual
  const esRef = useRef(null)
  const stepStartRef = useRef(0)

  const toggleStep = k => setSteps(s => ({ ...s, [k]: !s[k] }))

  const closeStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }, [])

  useEffect(() => () => closeStream(), [closeStream])

  // Cronômetro da etapa atual (pra detectar demora/travamento).
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setStepElapsed(Math.floor((Date.now() - stepStartRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [running, progress])

  const attachStream = useCallback((label) => {
    closeStream()
    setLog([])
    setRunning(true)
    setActionLabel(label)
    setError('')
    setProgress(null)
    stepStartRef.current = Date.now()
    setStepElapsed(0)
    const es = new EventSource('/api/atualizar/stream?since=0')
    esRef.current = es
    es.addEventListener('run', e => {
      if (e.data === 'null') { setRunning(false); es.close() }
    })
    es.onmessage = e => {
      const entry = JSON.parse(e.data)
      // Marcador de progresso: atualiza a barra e NÃO entra no log visível.
      const m = entry.stream === 'stdout' && PROGRESS_RE.exec(entry.text.trim())
      if (m) {
        setProgress({ n: +m[1], total: +m[2], title: m[3] })
        stepStartRef.current = Date.now()
        setStepElapsed(0)
        return
      }
      if (entry.stream === 'done') {
        setRunning(false)
        es.close()
        fetch(`/Atualizacao_Resumo.json?t=${Date.now()}`)
          .then(r => (r.ok ? r.json() : null))
          .then(setResumo)
          .catch(() => {})
      }
      setLog(prev => [...prev, entry])
    }
    es.onerror = () => { setRunning(false); es.close() }
  }, [closeStream])

  const startAction = useCallback(async (label, url, opts) => {
    if (running) return
    try {
      const res = await fetch(url, opts)
      if (res.status === 409) {
        const body = await res.json()
        setError(body.erro || 'Já há uma atualização em andamento.')
        return
      }
      attachStream(label)
    } catch (e) {
      setError(e.message)
    }
  }, [running, attachStream])

  const rodar = () => startAction(
    'atualizar-tudo',
    '/api/atualizar/rodar',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modo: steps.captacao ? modo : 'Auto',
        skipDebentures: !steps.debentures,
        skipCaptacao: !steps.captacao,
        skipBlc: !steps.blc,
        blcMesAno: steps.blc ? blcMes : '',
        skipAnbima: !steps.anbima,
        skipOfertas: !steps.ofertas,
        skipRelatorios: !steps.relatorios,
      }),
    },
  )
  const verSugestaoFundos = () => startAction('fundos-sugestao', '/api/atualizar/fundos/sugestao', { method: 'POST' })
  const aplicarSugestaoFundos = () => startAction('fundos-aplicar', '/api/atualizar/fundos/aplicar', { method: 'POST' })
  const conferirPublicar = () => startAction('publicar-status', '/api/atualizar/publicar/status', { method: 'GET' })
  const publicar = () => startAction('publicar', '/api/atualizar/publicar', { method: 'POST' })
  const cancelar = () => fetch('/api/atualizar/cancelar', { method: 'POST' }).catch(() => {})

  const pct = progress ? Math.round((progress.n / progress.total) * 100) : 0
  const demorou = running && stepElapsed >= 180   // 3 min na mesma etapa

  const StepCheck = ({ k, label, hint }) => (
    <label className="cp-step" title={hint}>
      <input type="checkbox" checked={steps[k]} onChange={() => toggleStep(k)} disabled={running} />
      {label}
    </label>
  )

  return (
    <section className="control-panel" aria-label="Painel de controle da atualização">
      <header className="cp-header">
        <h2 className="cp-title">Painel de controle — Atualização</h2>
        <p className="cp-subtitle">Só funciona aqui, no `npm run dev` local. Nunca vai para produção.</p>
      </header>

      {/* Rotina diária: só 2 cliques. */}
      <div className="cp-block cp-daily">
        <h3 className="cp-block-title">Atualização diária</h3>
        <p className="cp-daily-hint">No dia a dia é só isto: <strong>1) Iniciar atualização</strong> e, quando terminar, <strong>2) Publicar agora</strong>.</p>
        <div className="cp-btn-row">
          <button type="button" className="cp-btn cp-btn-primary cp-btn-big" onClick={rodar} disabled={running}>
            {running && actionLabel === 'atualizar-tudo' ? 'Rodando…' : '1 · Iniciar atualização'}
          </button>
          <button type="button" className="cp-btn cp-btn-danger cp-btn-big" onClick={publicar} disabled={running}>
            {running && actionLabel === 'publicar' ? 'Publicando…' : '2 · Publicar agora'}
          </button>
          {running && (
            <button type="button" className="cp-btn cp-btn-danger" onClick={cancelar}>Cancelar</button>
          )}
        </div>
      </div>

      {/* Controles detalhados — só quando precisar mexer em algo. */}
      <details className="cp-advanced">
        <summary className="cp-advanced-summary">Opções avançadas — etapas, modo da captação, mês do BLC, fundos, conferência</summary>

        <div className="cp-block">
          <h3 className="cp-block-title">Etapas do "Iniciar atualização"</h3>
          <div className="cp-steps">
            <StepCheck k="debentures" label="Debêntures (cadastro)" hint="Regenera public/Debentures.csv" />
            <StepCheck k="captacao" label="Captação" hint="Fluxo semanal/mensal, rentabilidade e fundos" />
            <StepCheck k="blc" label="BLC / Alocação" hint="Carteira dos fundos (mensal)" />
            <StepCheck k="anbima" label="ANBIMA" hint="Taxas indicativas" />
            <StepCheck k="ofertas" label="Ofertas CVM" hint="Novas emissões registradas na CVM" />
            <StepCheck k="relatorios" label="Resumo do Dia" hint="Gera os relatórios diários (public/reports)" />
          </div>

          {steps.captacao && (
            <div className="cp-sub">
              <span className="cp-sub-label">Modo da Captação:</span>
              <div className="cp-modos">
                {MODOS.map(m => (
                  <button key={m.id} type="button" className={`cp-modo-btn${modo === m.id ? ' active' : ''}`}
                    onClick={() => setModo(m.id)} disabled={running} title={m.hint}>{m.label}</button>
                ))}
              </div>
            </div>
          )}

          {steps.blc && (
            <div className="cp-sub">
              <span className="cp-sub-label">Mês do BLC (sobrescreve o atual):</span>
              <select className="cp-select" value={blcMes} onChange={e => setBlcMes(e.target.value)} disabled={running}>
                {ultimosMeses(6).map(m => <option key={m} value={m}>{fmtMesAno(m)}</option>)}
              </select>
            </div>
          )}
          <p className="cp-note">As etapas marcadas aqui valem para o botão "Iniciar atualização" lá em cima.</p>
        </div>

        <div className="cp-block">
          <h3 className="cp-block-title">Lista de fundos 12.431 / CDI</h3>
          <div className="cp-btn-row">
            <button type="button" className="cp-btn" onClick={verSugestaoFundos} disabled={running}>Ver sugestão de fundos</button>
            <button type="button" className="cp-btn" onClick={aplicarSugestaoFundos} disabled={running}>Aplicar sugestão de fundos</button>
          </div>
        </div>

        <div className="cp-block">
          <h3 className="cp-block-title">Conferir antes de publicar</h3>
          <div className="cp-btn-row">
            <button type="button" className="cp-btn" onClick={conferirPublicar} disabled={running}>Conferir o que vai ser publicado</button>
          </div>
        </div>
      </details>

      {error && <p className="cp-error">{error}</p>}

      {progress && (
        <div className="cp-block">
          <div className="cp-progress-head">
            <span>Passo {progress.n} de {progress.total} — {progress.title}</span>
            <span className="cp-progress-time">{stepElapsed}s{running ? '' : ' (fim)'}</span>
          </div>
          <div className="cp-progress-track"><div className="cp-progress-bar" style={{ width: `${pct}%` }} /></div>
          {demorou && (
            <p className="cp-warn">⚠️ Essa etapa está demorando mais que o normal ({stepElapsed}s). Pode ter travado — se precisar, clique em Cancelar.</p>
          )}
        </div>
      )}

      {(log.length > 0 || running) && (
        <div className="cp-block">
          <h3 className="cp-block-title">Log — {actionLabel}</h3>
          <div className="cp-log">
            {log.map(entry => <LogLine key={entry.seq} entry={entry} />)}
            {running && <div className="cp-log-meta">…</div>}
          </div>
        </div>
      )}

      {resumo && (
        <div className="cp-block">
          <h3 className="cp-block-title">Resultado (Atualizacao_Resumo.json)</h3>
          <pre className="cp-resumo">{JSON.stringify(resumo, null, 2)}</pre>
        </div>
      )}
    </section>
  )
}

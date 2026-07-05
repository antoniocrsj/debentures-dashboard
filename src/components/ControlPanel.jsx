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

function LogLine({ entry }) {
  const cls = {
    meta: 'cp-log-meta',
    stdout: 'cp-log-stdout',
    stderr: 'cp-log-stderr',
    done: 'cp-log-done',
  }[entry.stream] || 'cp-log-stdout'
  if (entry.stream === 'done') {
    const ok = entry.text === '0'
    return <div className={cls}>{ok ? '✔ concluído (código 0)' : `✘ terminou com código ${entry.text}`}</div>
  }
  return <div className={cls}>{entry.text}</div>
}

export default function ControlPanel() {
  const [modo, setModo] = useState('Auto')
  const [skipAnbima, setSkipAnbima] = useState(false)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const [actionLabel, setActionLabel] = useState('')
  const [error, setError] = useState('')
  const [resumo, setResumo] = useState(null)
  const esRef = useRef(null)

  const closeStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }, [])

  useEffect(() => () => closeStream(), [closeStream])

  const attachStream = useCallback((label) => {
    closeStream()
    setLog([])
    setRunning(true)
    setActionLabel(label)
    setError('')
    const es = new EventSource('/api/atualizar/stream?since=0')
    esRef.current = es
    es.addEventListener('run', e => {
      if (e.data === 'null') { setRunning(false); es.close() }
    })
    es.onmessage = e => {
      const entry = JSON.parse(e.data)
      if (entry.stream === 'done') {
        setRunning(false)
        es.close()
        // Recarrega os resumos publicados (cache-busted) após terminar.
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
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modo, skipAnbima }) },
  )
  const verSugestaoFundos = () => startAction('fundos-sugestao', '/api/atualizar/fundos/sugestao', { method: 'POST' })
  const aplicarSugestaoFundos = () => startAction('fundos-aplicar', '/api/atualizar/fundos/aplicar', { method: 'POST' })
  const conferirPublicar = () => startAction('publicar-status', '/api/atualizar/publicar/status', { method: 'GET' })
  const publicar = () => startAction('publicar', '/api/atualizar/publicar', { method: 'POST' })

  return (
    <section className="control-panel" aria-label="Painel de controle da atualização">
      <header className="cp-header">
        <h2 className="cp-title">Painel de controle — Atualização</h2>
        <p className="cp-subtitle">Só funciona aqui, no `npm run dev` local. Nunca vai para produção.</p>
      </header>

      <div className="cp-block">
        <h3 className="cp-block-title">1. Atualizar dados (Debêntures + Fundos + Captação + BLC + ANBIMA)</h3>
        <div className="cp-modos">
          {MODOS.map(m => (
            <button
              key={m.id}
              type="button"
              className={`cp-modo-btn${modo === m.id ? ' active' : ''}`}
              onClick={() => setModo(m.id)}
              disabled={running}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="cp-checkbox">
          <input type="checkbox" checked={skipAnbima} onChange={e => setSkipAnbima(e.target.checked)} disabled={running} />
          Pular ANBIMA nesta rodada
        </label>
        <button type="button" className="cp-btn cp-btn-primary" onClick={rodar} disabled={running}>
          {running && actionLabel === 'atualizar-tudo' ? 'Rodando…' : 'Iniciar atualização'}
        </button>
      </div>

      <div className="cp-block">
        <h3 className="cp-block-title">2. Lista de fundos 12.431 / CDI</h3>
        <div className="cp-btn-row">
          <button type="button" className="cp-btn" onClick={verSugestaoFundos} disabled={running}>Ver sugestão de fundos</button>
          <button type="button" className="cp-btn" onClick={aplicarSugestaoFundos} disabled={running}>Aplicar sugestão de fundos</button>
        </div>
      </div>

      <div className="cp-block">
        <h3 className="cp-block-title">3. Publicar</h3>
        <div className="cp-btn-row">
          <button type="button" className="cp-btn" onClick={conferirPublicar} disabled={running}>Conferir o que vai ser publicado</button>
          <button type="button" className="cp-btn cp-btn-danger" onClick={publicar} disabled={running}>Publicar agora (git add/commit/push)</button>
        </div>
      </div>

      {error && <p className="cp-error">{error}</p>}

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

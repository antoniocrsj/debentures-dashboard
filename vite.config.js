import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR = path.join(__dirname, 'tools')
const REPO_ROOT = __dirname
// Ana (credit-analyst) e' repo IRMAO. Antes de atualizar, o painel garante que o
// servidor da Ana esteja no ar; senao o sync do cadastro de emissores cai no
// fallback (curadoria pendente). Caminho configuravel via env ANA_ROOT.
const ANA_ROOT = process.env.ANA_ROOT || path.resolve(REPO_ROOT, '..', 'credit-analyst')

// Cookie store persists for the lifetime of the dev server.
// The first request to a GAS URL gets the interstitial and sets cookies;
// subsequent requests reuse those cookies and land straight on the CSV.
const COOKIE_STORE = {}

// ─── ANBIMA Data API (agenda de eventos, sob demanda no dev) ───────────────
// Mesma auth do preparar-anbima.ps1: um JWT HS256 assinado com um segredo que a
// propria ANBIMA embute no frontend (é so' um "prove que veio do site").
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function anbimaJwt() {
  const secret = 'Sx!RNAMs@TXN_d!v9e*B%bPG-+AB%DZv9tq@TuFB'
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))
  const payload = b64url(JSON.stringify({ tokenRecaptcha: crypto.randomUUID(), verificationHashCache: Date.now() }))
  const data = `${header}.${payload}`
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest())
  return `${data}.${sig}`
}
async function fetchAnbimaAgenda(ticker) {
  const url = `https://data-api.prd.anbima.com.br/web-bff/v1/debentures/${encodeURIComponent(ticker)}/agenda?page=0&size=200`
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Origin': 'https://data.anbima.com.br',
      'Referer': `https://data.anbima.com.br/debentures/${ticker}/agenda`,
      'g-google-authorization': anbimaJwt(),
      'Params': '?view=precos',
    },
  })
  if (!r.ok) throw new Error(`ANBIMA HTTP ${r.status}`)
  const j = await r.json()
  return j.content || []
}

function cookiesFor(urlStr) {
  try {
    const host = new URL(urlStr).hostname
    return COOKIE_STORE[host] || {}
  } catch { return {} }
}

function storeCookies(urlStr, header) {
  if (!header) return
  try {
    const host = new URL(urlStr).hostname
    if (!COOKIE_STORE[host]) COOKIE_STORE[host] = {}
    // set-cookie may be one string with comma-separated directives
    header.split(/,(?=[^;]+=[^;]+)/).forEach(c => {
      const pair = c.trim().split(';')[0]
      const eq   = pair.indexOf('=')
      if (eq > 0) COOKIE_STORE[host][pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    })
  } catch {}
}

function cookieStr(urlStr) {
  const jar = cookiesFor(urlStr)
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

// Tries to extract a redirect URL from GAS interstitial HTML pages.
// GAS uses meta-refresh, JS window.location, or a plain <a> to googleusercontent.
function extractRedirect(html, base) {
  // <meta http-equiv="refresh" content="0; url=...">
  const meta = html.match(/content=["']\d+;\s*url=([^"']+)["']/i)
  if (meta) return meta[1].replace(/&amp;/g, '&').trim()

  // window.location[.href/.replace/.assign] = "..."
  const js = html.match(
    /window\.location(?:\.(?:href|replace|assign)\s*(?:\(|=)|[\s=])\s*["']([^"']+)["']/
  )
  if (js) return js[1]

  // <a href="https://script.googleusercontent.com/...">
  const link = html.match(/href="(https:\/\/script\.googleusercontent\.com[^"]+)"/)
  if (link) return link[1].replace(/&amp;/g, '&')

  // form action pointing to googleusercontent
  const form = html.match(/action="(https:\/\/script\.googleusercontent\.com[^"]+)"/)
  if (form) return form[1].replace(/&amp;/g, '&')

  return null
}

async function gasFetch(originalUrl, maxHops = 8) {
  let url = originalUrl
  let htmlRetried = false   // only retry from original once

  for (let hop = 0; hop < maxHops; hop++) {
    const jar = cookieStr(url)
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        Accept: 'text/plain,text/csv,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(jar ? { Cookie: jar } : {}),
      },
    })

    storeCookies(url, res.headers.get('set-cookie'))

    // ── HTTP redirect ──
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      url = loc.startsWith('http') ? loc : new URL(loc, url).href
      console.log(`[proxy] ${res.status} → ${url.slice(0, 90)}`)
      continue
    }

    const text = await res.text()

    // ── HTML page: try to extract redirect ──
    if (text.trimStart().startsWith('<')) {
      const target = extractRedirect(text, url)
      if (target) {
        url = target.startsWith('http') ? target : new URL(target, url).href
        console.log(`[proxy] html-redirect → ${url.slice(0, 90)}`)
        continue
      }

      // No extractable link — retry original URL once with accumulated cookies
      if (!htmlRetried) {
        htmlRetried = true
        console.log(`[proxy] interstitial w/o link, retrying original with cookies…`)
        console.log(`[proxy] html snippet: ${text.slice(0, 400).replace(/\s+/g, ' ')}`)
        await new Promise(r => setTimeout(r, 500))
        url = originalUrl
        continue
      }

      // Still HTML after retry — give up
      console.log(`[proxy] still HTML after retry, returning as-is`)
      return text
    }

    console.log(`[proxy] 200 CSV | ${text.slice(0, 60).replace(/\n/g, '↵')}`)
    return text
  }

  throw new Error('Too many redirects fetching ' + originalUrl)
}

// ─── Painel de controle da atualização (dev-only) ──────────────────────────
// Roda os scripts de tools/ (PowerShell) sob demanda a partir de uma tela web
// local (src/components/ControlPanel.jsx, so' existe no bundle de dev — ver
// import.meta.env.DEV em App.jsx). So' faz sentido em `vite dev`/`vite preview`
// rodando no notebook do operador: nunca existe no build de producao, e
// mesmo que existisse não teria como alcançar `localhost` a partir do site
// publicado (CORS/mixed-content bloqueiam isso pelo navegador).
//
// Um "run" por vez (uso é sempre de um único operador local): guarda um
// buffer das linhas de stdout/stderr (para reconectar via SSE sem perder
// log) e o estado (rodando / concluído / código de saída).
let currentRun = null
let runSeq = 0

function newRun(label) {
  runSeq += 1
  currentRun = {
    id: runSeq,
    label,
    buffer: [],
    seq: 0,
    running: true,
    exitCode: null,
    listeners: new Set(),
  }
  return currentRun
}

function pushLine(run, streamName, text) {
  run.seq += 1
  const entry = { seq: run.seq, stream: streamName, text }
  run.buffer.push(entry)
  if (run.buffer.length > 4000) run.buffer.shift()
  for (const send of run.listeners) send(entry)
}

function finishRun(run, exitCode) {
  run.running = false
  run.exitCode = exitCode
  const entry = { seq: ++run.seq, stream: 'done', text: String(exitCode) }
  run.buffer.push(entry)
  for (const send of run.listeners) send(entry)
}

// PowerShell 5.1 escreve stdout redirecionado na codepage do console, nao
// necessariamente UTF-8 -- forcamos via $OutputEncoding antes de chamar o
// script real (truque padrao para redirecionamento de pipeline em PS 5.1).
//
// Nomes de parametro (-SkipFundos, -CaptacaoModo, ...) NAO podem ir entre
// aspas: aspas fazem o PowerShell tratar o token como um valor de string
// literal em vez de reconhecer o nome do parametro, e ele acaba caindo no
// bind posicional do primeiro parametro nao-switch do script (foi exatamente
// o bug: '-SkipFundos' virava o VALOR de -CaptacaoModo). Só os valores em si
// (ex.: 'Auto') precisam de aspas.
function psCommand(scriptPath, args) {
  const rendered = args
    .map(a => String(a))
    .map(a => (/^-[A-Za-z]/.test(a) ? a : `'${a.replace(/'/g, "''")}'`))
    .join(' ')
  const inner = `$OutputEncoding = [System.Text.UTF8Encoding]::new(); & '${scriptPath}' ${rendered}`
  return { cmd: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', inner] }
}

function spawnStep(run, cmd, args, cwd) {
  return new Promise(resolve => {
    pushLine(run, 'meta', `$ ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, { cwd: cwd || REPO_ROOT, windowsHide: true })
    run.child = child
    child.stdout.on('data', d => pushLine(run, 'stdout', d.toString('utf8')))
    child.stderr.on('data', d => pushLine(run, 'stderr', d.toString('utf8')))
    child.on('error', err => { pushLine(run, 'stderr', `[erro ao iniciar] ${err.message}`); resolve(1) })
    child.on('close', code => { if (run.child === child) run.child = null; resolve(code == null ? 1 : code) })
  })
}

// Mata o processo do run em andamento (e a arvore de filhos no Windows).
function killRun(run) {
  const child = run && run.child
  if (!child || child.killed) return false
  run.cancelled = true
  pushLine(run, 'meta', '[cancelado pelo usuario]')
  try {
    if (process.platform === 'win32') {
      // taskkill /T mata a arvore inteira (powershell + qualquer filho externo).
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
  } catch { /* ignore */ }
  return true
}

// Roda uma sequencia de passos no MESMO run/buffer, parando no primeiro que falhar.
async function runSequence(label, steps) {
  const run = newRun(label)
  ;(async () => {
    let code = 0
    for (const step of steps) {
      if (run.cancelled) { code = 130; break }
      const c = await spawnStep(run, step.cmd, step.args, step.cwd)
      if (run.cancelled) { code = 130; break }
      if (c !== 0) {
        if (step.allowFail) continue   // erro benigno (ex.: "nada pra commitar"): segue adiante
        code = c; break
      }
      code = 0
    }
    finishRun(run, code)
  })()
  return run
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192-v2.png', 'icon-512-v2.png', 'icon-maskable-512-v2.png'],
      manifest: {
        name: 'Luc',
        short_name: 'Luc',
        description: 'Luc — crédito privado: debêntures e captação de fundos',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2ede5',
        theme_color: '#26211d',
        icons: [
          { src: '/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // cleanupOutdatedCaches: remove os precaches de deploys ANTIGOS. Sem ele,
        // chunks velhos ficavam no cache e o index.html cacheado podia apontar p/
        // um arquivo ja' removido -> tela BRANCA ate' limpar o cache na mao. Com o
        // registerType 'autoUpdate' (skipWaiting/clientsClaim implicitos), o SW
        // novo assume na hora e limpa o antigo.
        cleanupOutdatedCaches: true,
        runtimeCaching: [{
          urlPattern: /^https:\/\/.*\/api\//,
          handler: 'NetworkFirst',
          options: { cacheName: 'api-cache' },
        }],
      },
    }),
    {
      name: 'gas-cors-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith('/api/proxy')) return next()
          const qs = req.url.includes('?') ? req.url.split('?')[1] : ''
          const targetUrl = new URLSearchParams(qs).get('url')
          if (!targetUrl) {
            res.statusCode = 400
            return res.end('Missing url parameter')
          }
          try {
            const text = await gasFetch(targetUrl)
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.end(text)
          } catch (e) {
            console.error('[proxy] error:', e.message)
            res.statusCode = 502
            res.end(`Proxy error: ${e.message}`)
          }
        })
      },
    },
    {
      // DEV-only: proxy da AGENDA de eventos da ANBIMA (data-api web-bff),
      // reproduzindo a auth JWT/HMAC do preparar-anbima.ps1. Sob demanda: o modal
      // de detalhe chama /api/anbima-agenda?ticker=XXX ao abrir. Só existe no dev
      // (o app publicado no Vercel não tem servidor, então o bloco degrada).
      name: 'anbima-agenda-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith('/api/anbima-agenda')) return next()
          const qs = req.url.includes('?') ? req.url.split('?')[1] : ''
          const ticker = (new URLSearchParams(qs).get('ticker') || '').trim().toUpperCase()
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (!ticker) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing ticker' })) }
          try {
            const content = await fetchAnbimaAgenda(ticker)
            res.end(JSON.stringify({ content }))
          } catch (e) {
            console.error('[anbima-agenda] error:', e.message)
            res.statusCode = 502
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      },
    },
    {
      name: 'atualizacao-control-panel',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith('/api/atualizar')) return next()
          const [urlPath, qs] = req.url.split('?')

          // GET /api/atualizar/stream?since=N — SSE: replay do buffer + tail ao vivo.
          if (urlPath === '/api/atualizar/stream' && req.method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            })
            const since = Number(new URLSearchParams(qs || '').get('since') || 0)
            const run = currentRun
            const send = entry => res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`)
            if (run) {
              res.write(`event: run\ndata: ${JSON.stringify({ id: run.id, label: run.label, running: run.running })}\n\n`)
              for (const entry of run.buffer) { if (entry.seq > since) send(entry) }
              if (run.running) {
                run.listeners.add(send)
                req.on('close', () => run.listeners.delete(send))
              } else {
                res.end()
              }
            } else {
              res.write(`event: run\ndata: null\n\n`)
              res.end()
            }
            return
          }

          // POST /api/atualizar/rodar — seleção de etapas + modo + mês do BLC.
          // { modo, skipDebentures, skipCaptacao, skipBlc, blcMesAno, skipAnbima, skipOfertas }
          // Fundos nunca roda por aqui (é ação separada) → sempre -SkipFundos.
          if (urlPath === '/api/atualizar/rodar' && req.method === 'POST') {
            if (currentRun && currentRun.running) return sendJson(res, 409, { erro: 'Ja ha uma atualizacao em andamento.' })
            const body = await readJsonBody(req)
            const modo = ['Auto', 'Incremental', 'Completa'].includes(body.modo) ? body.modo : 'Auto'
            const args = ['-SkipFundos', '-NoPublishPrompt', '-CaptacaoModo', modo]
            if (body.skipDebentures) args.push('-SkipDebentures')
            if (body.skipCaptacao)   args.push('-SkipCaptacao')
            if (body.skipBlc)        args.push('-SkipBlc')
            else if (/^\d{6}$/.test(String(body.blcMesAno || ''))) args.push('-BlcMesAno', String(body.blcMesAno))
            if (body.skipAnbima)     args.push('-SkipAnbima')
            if (body.skipOfertas)    args.push('-SkipOfertas')
            if (body.skipRelatorios) args.push('-SkipRelatorios')
            const steps = []
            // Pre-flight: se o cadastro de emissores vai rodar (nao -SkipRelatorios),
            // garante a Ana no ar primeiro (sobe se preciso, via painel_ana -ServerOnly).
            // allowFail: se nao subir, a atualizacao segue e o passo Emissores avisa
            // FALLBACK -- nunca trava por causa da Ana.
            if (!body.skipRelatorios) {
              const ana = psCommand(path.join(ANA_ROOT, 'tools', 'painel_ana.ps1'), ['-ServerOnly'])
              steps.push({ cmd: ana.cmd, args: ana.args, cwd: ANA_ROOT, allowFail: true })
            }
            const { cmd, args: psArgs } = psCommand(path.join(TOOLS_DIR, 'atualizar-tudo.ps1'), args)
            steps.push({ cmd, args: psArgs })
            const run = await runSequence('atualizar-tudo', steps)
            return sendJson(res, 200, { id: run.id })
          }

          // POST /api/atualizar/cancelar — mata o processo em andamento.
          if (urlPath === '/api/atualizar/cancelar' && req.method === 'POST') {
            const ok = currentRun && currentRun.running ? killRun(currentRun) : false
            return sendJson(res, 200, { cancelado: ok })
          }

          // POST /api/atualizar/fundos/sugestao — roda selecionar-fundos.ps1 sozinho.
          if (urlPath === '/api/atualizar/fundos/sugestao' && req.method === 'POST') {
            if (currentRun && currentRun.running) return sendJson(res, 409, { erro: 'Ja ha uma atualizacao em andamento.' })
            const { cmd, args } = psCommand(path.join(TOOLS_DIR, 'selecionar-fundos.ps1'), [])
            const run = await runSequence('fundos-sugestao', [{ cmd, args }])
            return sendJson(res, 200, { id: run.id })
          }

          // POST /api/atualizar/fundos/aplicar — copia a sugestao por cima dos CSVs reais.
          if (urlPath === '/api/atualizar/fundos/aplicar' && req.method === 'POST') {
            if (currentRun && currentRun.running) return sendJson(res, 409, { erro: 'Ja ha uma atualizacao em andamento.' })
            const { cmd, args } = psCommand(path.join(TOOLS_DIR, 'aplicar-fundos.ps1'), [])
            const run = await runSequence('fundos-aplicar', [{ cmd, args }])
            return sendJson(res, 200, { id: run.id })
          }

          // GET /api/atualizar/publicar/status — o que git veria pra publicar, sem publicar.
          if (urlPath === '/api/atualizar/publicar/status' && req.method === 'GET') {
            const run = await runSequence('publicar-status', [{
              cmd: 'git',
              args: ['status', '--short', '--', 'public/', 'tools/Fundos_12431.csv', 'tools/Fundos_CDI.csv'],
            }])
            return sendJson(res, 200, { id: run.id })
          }

          // POST /api/atualizar/publicar — git add/commit/push de fato.
          if (urlPath === '/api/atualizar/publicar' && req.method === 'POST') {
            if (currentRun && currentRun.running) return sendJson(res, 409, { erro: 'Ja ha uma atualizacao em andamento.' })
            // add -> commit (tolera "nada novo") -> pull --rebase (integra o que ja
            // esta no remoto, ex.: correcoes de codigo) -> push. Assim o "Publicar"
            // nao falha mais com "fetch first"/remoto-a-frente. --autostash cobre
            // qualquer mudanca solta; os dados (public/) e o codigo (src/) nao colidem.
            const run = await runSequence('publicar', [
              { cmd: 'git', args: ['add', 'public/', 'tools/Fundos_12431.csv', 'tools/Fundos_CDI.csv'] },
              { cmd: 'git', args: ['commit', '-m', 'Atualiza dados (painel de controle)'], allowFail: true },
              { cmd: 'git', args: ['pull', '--rebase', '--autostash', 'origin', 'main'] },
              { cmd: 'git', args: ['push', '-u', 'origin', 'main'] },
            ])
            return sendJson(res, 200, { id: run.id })
          }

          next()
        })
      },
    },
  ],
})

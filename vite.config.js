import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cookie store persists for the lifetime of the dev server.
// The first request to a GAS URL gets the interstitial and sets cookies;
// subsequent requests reuse those cookies and land straight on the CSV.
const COOKIE_STORE = {}

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

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'BI - Crédito Privado',
        short_name: 'BI Crédito',
        description: 'BI de crédito privado — debêntures e captação de fundos',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#eef1f5',
        theme_color: '#14253f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
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
  ],
})

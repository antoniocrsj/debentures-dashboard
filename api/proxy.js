// Vercel serverless — proxy para Google Apps Script.
// Resolve os varios formatos de pagina intermediaria (interstitial) que o Google
// pode devolver antes do CSV: redirect HTTP, meta-refresh, window.location (JS),
// link/form para googleusercontent — e, se nada resolver, tenta de novo a URL
// original com os cookies acumulados. Mesma logica do proxy de dev (vite.config.js).

// Tenta extrair uma URL de redirect de uma pagina HTML de interstitial do GAS.
function extractRedirect(html) {
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

  // form action apontando para googleusercontent
  const form = html.match(/action="(https:\/\/script\.googleusercontent\.com[^"]+)"/)
  if (form) return form[1].replace(/&amp;/g, '&')

  return null
}

async function gasFetch(originalUrl, maxHops = 8) {
  let url = originalUrl
  let htmlRetried = false
  const jar = {}

  const cookieHeader = () =>
    Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

  const storeCookies = (header) => {
    if (!header) return
    header.split(/,(?=[^;]+=[^;]+)/).forEach(c => {
      const pair = c.trim().split(';')[0]
      const eq = pair.indexOf('=')
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    })
  }

  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        Accept: 'text/plain,text/csv,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(Object.keys(jar).length ? { Cookie: cookieHeader() } : {}),
      },
    })

    storeCookies(res.headers.get('set-cookie'))

    // ── redirect HTTP ──
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      url = loc.startsWith('http') ? loc : new URL(loc, url).href
      continue
    }

    const text = await res.text()

    // ── pagina HTML: tenta extrair o redirect ──
    if (text.trimStart().startsWith('<')) {
      const target = extractRedirect(text)
      if (target) {
        url = target.startsWith('http') ? target : new URL(target, url).href
        continue
      }
      // sem link extraivel — tenta a original de novo com os cookies (uma vez)
      if (!htmlRetried) {
        htmlRetried = true
        await new Promise(r => setTimeout(r, 500))
        url = originalUrl
        continue
      }
      // ainda HTML — desiste (lanca p/ o handler devolver 502 e NAO cachear HTML)
      throw new Error('GAS retornou HTML (interstitial nao resolvido)')
    }

    return text
  }

  throw new Error('Too many redirects fetching ' + originalUrl)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    return res.status(200).end()
  }

  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url parameter' })
  if (!url.startsWith('https://script.google.com/'))
    return res.status(403).json({ error: 'URL not allowed' })

  try {
    const text = await gasFetch(url)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    // So cacheia respostas boas (CSV). Em erro nao chega aqui (cai no catch, sem cache).
    res.setHeader('Cache-Control', 'public, s-maxage=14400, stale-while-revalidate=3600')
    return res.status(200).send(text)
  } catch (err) {
    // 502 sem Cache-Control -> nao envenena a CDN com HTML
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(502).json({ error: err.message })
  }
}

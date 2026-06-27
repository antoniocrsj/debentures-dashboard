// Vercel serverless — proxy para Google Apps Script com suporte a redirect+cookie
async function gasFetch(url, maxHops = 6) {
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
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36',
        ...(Object.keys(jar).length ? { Cookie: cookieHeader() } : {}),
      },
    })

    storeCookies(res.headers.get('set-cookie'))

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      url = loc.startsWith('http') ? loc : new URL(loc, url).href
      continue
    }

    const text = await res.text()

    const metaMatch = text.match(/content=["']\d+;\s*url=([^"']+)["']/i)
    if (metaMatch) {
      url = metaMatch[1].replace(/&amp;/g, '&').trim()
      if (!url.startsWith('http')) url = new URL(url, url).href
      continue
    }

    return text
  }

  throw new Error('Too many redirects fetching ' + url)
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
    res.setHeader('Cache-Control', 'public, s-maxage=14400, stale-while-revalidate=3600')
    return res.status(200).send(text)
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}

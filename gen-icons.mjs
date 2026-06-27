import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

function createPNG(size) {
  const R = 0x1e, G = 0x3a, B = 0x8a

  const pad = Math.floor(size * 0.2)
  const charW = Math.floor(size * 0.55)
  const charH = Math.floor(size * 0.65)
  const startX = Math.floor((size - charW) / 2)
  const startY = Math.floor((size - charH) / 2)
  const stemW = Math.floor(size * 0.12)
  const curveR = Math.floor(charH / 2)

  function isWhite(x, y) {
    if (x < startX || y < startY || y >= startY + charH) return false
    if (x >= startX && x < startX + stemW) return true
    const cy = startY + curveR
    const dx = x - (startX + stemW)
    const dy = y - cy
    const maxR = charW - stemW
    const minR = maxR - stemW
    if (dx >= 0) {
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r <= maxR && r >= minR) return true
    }
    return false
  }

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      if (isWhite(x, y)) row.push(255, 255, 255)
      else row.push(R, G, B)
    }
    rows.push(Buffer.from(row))
  }

  const compressed = deflateSync(Buffer.concat(rows))

  function crc32(buf) {
    let crc = 0xffffffff
    for (const b of buf) {
      crc ^= b
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (~crc) >>> 0
  }

  function chunk(type, data) {
    const t = Buffer.from(type)
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, c])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', createPNG(192))
writeFileSync('public/icon-512.png', createPNG(512))
console.log('Ícones gerados!')

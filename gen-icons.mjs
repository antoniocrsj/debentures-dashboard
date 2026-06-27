import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

function makePNG(size) {
  const R = 0x1e, G = 0x3a, B = 0x8a  // #1e3a8a azul

  // Cada linha: 1 byte filter (0) + size*3 bytes RGB
  const rowBytes = 1 + size * 3
  const raw = Buffer.alloc(size * rowBytes, 0)

  for (let y = 0; y < size; y++) {
    const base = y * rowBytes
    raw[base] = 0  // filter None
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3 + 0] = R
      raw[base + 1 + x * 3 + 1] = G
      raw[base + 1 + x * 3 + 2] = B
    }
  }

  function crc32(buf) {
    const table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    let crc = 0xffffffff
    for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(data.length, 0)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // RGB
  // bytes 10-12 = 0 (compress/filter/interlace)

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', makePNG(192))
writeFileSync('public/icon-512.png', makePNG(512))
console.log('✓ icon-192.png e icon-512.png gerados')

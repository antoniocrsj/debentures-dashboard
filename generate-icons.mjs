// Gera ícones PNG simples sem dependências externas
import { writeFileSync } from 'fs'

function svgToPngBase64(size) {
  // SVG com fundo azul escuro e texto "D"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#1e3a8a"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    font-family="Arial Black, sans-serif" font-weight="900"
    font-size="${size * 0.52}" fill="#ffffff">D</text>
  <text x="50%" y="80%" dominant-baseline="middle" text-anchor="middle"
    font-family="Arial, sans-serif" font-size="${size * 0.16}" fill="#93c5fd">CR</text>
</svg>`
}

writeFileSync('public/icon-192.svg', svgToPngBase64(192))
writeFileSync('public/icon-512.svg', svgToPngBase64(512))
console.log('SVG icons generated in public/')

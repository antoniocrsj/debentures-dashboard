// Card unificado de "Nova oferta de debênture na CVM (SRE)" — usado tanto pelo
// Resumo do Dia (gerar-relatorios.mjs) quanto pelo Semanal (render-semanal.mjs).
// Estilos INLINE com hex literais (paleta Luc) p/ ficar idêntico nos dois
// templates, independente do CSS de cada um. Dados vêm prontos do prep
// (preparar-ofertas-sre.mjs): a oferta já traz sindicato[], valorTotal, status e
// series[] (cada série com incentivada/final/spread/teto/venc/tenor/amort/resgate).

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Razão social do coordenador -> sigla curta da mesa (dicionário do usuário).
// Casa por palavra-chave no nome em maiúsculas; fallback = 1ª palavra "significativa".
const SIGLAS = [
  [/\bBTG\b/, 'BTG'],
  [/ITA[UÚ].*BBA|\bBBA\b/, 'BBA'],
  [/BRADESCO.*BBI|\bBBI\b/, 'BBI'],
  [/\bXP\b/, 'XP'],
  [/VOTORANTIM|\bBV\b/, 'BV'],
  [/SAFRA/, 'Safra'],
  [/SANTANDER|\bSAN\b/, 'SAN'],
  [/CAIXA|\bCEF\b/, 'CEF'],
  [/\bUBS\b/, 'UBS BB'],
  [/DAYCOVAL|\bDAY\b/, 'DAY'],
  [/\bABC\b/, 'ABC'],
  [/ITA[UÚ].*UNIBANCO|ITA[UÚ]\b/, 'Itaú'],
  [/BANCO DO BRASIL|\bBB\b/, 'BB'],
  [/MORGAN STANLEY/, 'Morgan'],
  [/CITI/, 'Citi'],
  [/J\.?P\.?\s*MORGAN|JPMORGAN/, 'JPM'],
  [/GENIAL/, 'Genial'],
  [/BofA|MERRILL|BANK OF AMERICA/, 'BofA'],
]
export function siglaBanco(razao) {
  const u = String(razao || '').toUpperCase()
  for (const [re, sig] of SIGLAS) if (re.test(u)) return sig
  // fallback: 1ª palavra que não seja "BANCO"/"S.A." etc.
  const w = u.replace(/\b(BANCO|S\.?A\.?|LTDA|CCTVM|DTVM|INVESTMENT|BANKING|ASSESSORIA|FINANCEIRA)\b/g, ' ')
    .replace(/[^A-ZÀ-Ú ]/g, ' ').trim().split(/\s+/)[0] || razao || '—'
  return w.charAt(0) + w.slice(1).toLowerCase()
}

// dd/MM/yyyy a partir de "yyyy-MM-dd" OU "dd/MM/yyyy" (passa reto).
const fmtDia = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—') }
// data curta "15/02/33" p/ o rodapé do vencimento
const fmtCurta = d => { const s = fmtDia(d); const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? `${m[1]}/${m[2]}/${m[3].slice(2)}` : s }
// valor total: R$ X,XX bi / R$ XXX MM
function fmtValor(v) {
  const n = Number(v) || 0
  if (n >= 1e9) return `R$ ${(n / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bi`
  if (n >= 1e6) return `R$ ${Math.round(n / 1e6).toLocaleString('pt-BR')} MM`
  return `R$ ${n.toLocaleString('pt-BR')}`
}

// paleta (hex literais p/ independer do CSS do template)
const T = '#8c5e3a', CARVAO = '#26211d', MUTED = '#8a7d6c', FAINT = '#b4a893'
const LINHA = '#ece0cd', BORDA = '#e0d0bb'

// célula da remuneração: final (destaque) + spread Bnn+ (muted) + teto (tiny).
// Em oferta ainda não precificada, cai no teto como linha principal.
function celRemun(s) {
  const final = s.final ? esc(s.final) : null
  const spread = s.spread ? esc(s.spread) : null
  const teto = s.teto ? esc(s.teto) : null
  const l1 = final || teto || '—'
  const partes = [`<span style="font-weight:600;color:${T}">${l1}</span>`]
  if (final && spread) partes.push(`<span style="color:${MUTED}">${spread}</span>`)
  else if (!final && spread) partes.push(`<span style="color:${MUTED}">${spread}</span>`)
  if (final && teto) partes.push(`<span style="color:${FAINT};font-size:11px">teto ${teto}</span>`)
  return partes.join('<br>')
}

// selo 12.431 / Trad
function seloTipo(inc) {
  return inc
    ? `<span style="font-size:10.5px;font-weight:600;color:#55611f;background:#eef0dc;border-radius:4px;padding:1px 6px">12.431</span>`
    : `<span style="font-size:10.5px;font-weight:600;color:#7a6a55;background:#efe4d3;border-radius:4px;padding:1px 6px">Trad</span>`
}

// vencimento "10y bullet (15/02/36)" — reflete a amortização real (bullet vs amort.)
function celVenc(s) {
  const tenor = s.tenor != null ? `${s.tenor}y` : ''
  const amort = s.amort === 'amort' ? 'amort.' : s.amort === 'bullet' ? 'bullet' : (s.amort || '')
  const topo = [tenor, amort].filter(Boolean).join(' ') || '—'
  return `${esc(topo)}<br><span style="color:${MUTED};font-weight:400">(${esc(fmtCurta(s.venc))})</span>`
}

const thS = 'padding:8px 6px 6px;font-weight:600;text-align:center'
const tdLbl = `text-align:left;padding:7px 8px;color:${MUTED}`
const tdV = 'text-align:center;padding:7px 6px;vertical-align:top'
const trTop = `border-top:1px solid ${LINHA}`

// Renderiza UM card. `o` = oferta normalizada do prep (+ grupo, opcional).
export function renderCardSre(o) {
  const series = Array.isArray(o.series) ? o.series : []
  const sind = (o.sindicato || []).map(c =>
    `${esc(siglaBanco(c.nome || c.razaoSocial))}${c.lider ? ` <span style="color:${T}">(líder)</span>` : ''}`).join(' · ')
  const tags = [
    o.rating ? `<span style="font-size:11px;font-weight:600;color:#5f4a33;background:#efe1cd;border-radius:5px;padding:2px 8px">${esc(o.rating)}</span>` : '',
    o.status ? `<span style="font-size:11px;font-weight:600;color:#5b6b2e;background:#eef0dc;border-radius:5px;padding:2px 8px">${esc(o.status)}</span>` : '',
  ].filter(Boolean).join(' ')

  const colHead = series.map((_, i) => `<th style="${thS}">${i + 1}ª</th>`).join('')
  const rowTipo = series.map(s => `<td style="${tdV}">${seloTipo(s.incentivada)}</td>`).join('')
  const rowRem = series.map(s => `<td style="${tdV}">${celRemun(s)}</td>`).join('')
  const rowVenc = series.map(s => `<td style="${tdV};font-weight:600">${celVenc(s)}</td>`).join('')
  const rowResg = series.map(s => `<td style="${tdV};font-weight:600">${esc(s.resgate || '—')}</td>`).join('')

  const tabela = series.length
    ? `<div style="padding:6px 8px 12px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:${Math.max(560, 120 + series.length * 96)}px">
          <thead><tr><th style="text-align:left;padding:8px 8px 6px;color:${MUTED};font-weight:600">Série</th>${colHead}</tr></thead>
          <tbody>
            <tr style="${trTop}"><td style="${tdLbl}">Tipo</td>${rowTipo}</tr>
            <tr style="${trTop}"><td style="${tdLbl};vertical-align:top">Remuneração<br><span style="font-size:10px;color:${FAINT}">final · spread · teto</span></td>${rowRem}</tr>
            <tr style="${trTop}"><td style="${tdLbl}">Vencimento</td>${rowVenc}</tr>
            <tr style="${trTop}"><td style="${tdLbl}">Resgate antec.</td>${rowResg}</tr>
          </tbody>
        </table>
      </div>`
    : `<div style="padding:10px 16px;color:${MUTED};font-style:italic;font-size:12px">Detalhamento das séries ainda não disponível no SRE (oferta recém-protocolada).</div>`

  const razao = o.razaoSocial && o.razaoSocial.toLowerCase() !== String(o.emissor || '').toLowerCase()
    ? `<span style="font-size:12px;color:${MUTED}">${esc(o.razaoSocial)}</span>` : ''
  const grupo = o.grupo ? `<span style="font-size:12px;color:${MUTED}">${esc(o.grupo)}</span>` : ''

  return `<div style="background:#fff;border:1px solid ${BORDA};border-radius:12px;overflow:hidden;margin:10px 0;font-size:13px;color:${CARVAO}">
    <div style="padding:13px 16px 12px;border-bottom:1px solid ${LINHA};display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;color:${T};font-weight:600">${esc(fmtDia(o.data))}</span>
        <span style="font-size:16px;font-weight:600">${esc(o.emissor || '—')}</span>
        ${razao || grupo}
      </div>
      <div style="display:flex;gap:6px">${tags}</div>
    </div>
    <div style="padding:10px 16px;border-bottom:1px solid ${LINHA};font-size:12.5px;line-height:1.7">
      <span style="color:${MUTED}">Sindicato </span><span style="font-weight:600">${sind || '—'}</span>
      <span style="color:#d9c9b3;margin:0 10px">|</span>
      <span style="color:${MUTED}">Total </span><span style="font-weight:600">${fmtValor(o.valorTotal)}</span>
      <span style="color:#d9c9b3;margin:0 10px">|</span>
      <span style="font-weight:600">${series.length || o.numSeries || '—'} série${(series.length || o.numSeries) === 1 ? '' : 's'}</span>
    </div>
    ${tabela}
  </div>`
}

// Renderiza a LISTA de cards (ou o vazio). janelaDias -> caption do heading.
// Estilos do caption/vazio inline p/ independer do CSS (diário tem cap-dia/empty;
// semanal não).
export function renderSecaoSre(ofertas, janelaDias) {
  const cap = janelaDias ? ` <span style="font-weight:400;color:${MUTED};font-size:11px">últimos ${janelaDias} dias</span>` : ''
  const head = `<h4>Novas ofertas de debêntures na CVM (SRE)${cap}</h4>`
  if (!ofertas || !ofertas.length) return `${head}<p style="color:${MUTED};font-style:italic;font-size:12.5px;margin:4px 0">Nenhuma nova oferta de debênture na CVM na janela.</p>`
  return head + ofertas.map(renderCardSre).join('')
}

// Card unificado de "Nova oferta de debênture na CVM (SRE)" — usado tanto pelo
// Resumo do Dia (gerar-relatorios.mjs) quanto pelo Semanal (render-semanal.mjs).
// Estilos INLINE com hex literais (paleta Luc) p/ ficar idêntico nos dois
// templates, independente do CSS de cada um. Dados vêm prontos do prep
// (preparar-ofertas-sre.mjs): a oferta já traz sindicato[], valorTotal, status e
// series[] (cada série com incentivada/final/spread/teto/venc/tenor/amort/resgate).

import { siglaBanco, fmtValorCurto, fmtDataDia as fmtDia, tenorAmort, spreadFinalCurto } from '../../src/utils/sreCard.js'
export { siglaBanco }

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmtValor = fmtValorCurto

// paleta Luc (hex literais p/ independer do CSS do template)
const T = '#8c5e3a'        // terracota (destaque: data + remuneração)
const CARVAO = '#2a2420'   // texto predominante
const TAUPE = '#9a8c7a'    // secundário, só quando necessário
const BORDA = '#6f4a2e'    // borda principal — terracota escura (contorno do card)
const DIV = '#eee5db'      // divisórias internas discretas
const BEGE = '#f2ede5'     // fundo do cabeçalho da tabela

// remuneração numa linha: teto em terracota + "(final X%)" em carvão quando existir
// o spread final. Sem final -> só o teto. Sem teto -> cai no final. Sem parênteses vazio.
function celRemun(s) {
  const main = s.teto || s.final || '—'
  const fin = (s.teto && s.final) ? spreadFinalCurto(s.final) : null
  return `<span style="font-size:12px;font-weight:500;color:${T}">${esc(main)}</span>`
    + (fin ? ` <span style="font-size:9.5px;font-weight:400;color:${CARVAO}">(final ${esc(fin)})</span>` : '')
}

// 12.431 / Trad como texto simples (sem fundo, borda, badge ou negrito)
function seloTipo(inc) {
  return `<span style="font-size:12px;font-weight:400;color:${CARVAO}">${inc ? '12.431' : 'Trad'}</span>`
}

// vencimento: "10y bullet" / "7y amort." (sem a data abaixo)
function celVenc(s) {
  return `<span style="font-size:12px;font-weight:500;color:${CARVAO}">${esc(tenorAmort(s))}</span>`
}

const thNum = `height:28px;padding:3px 7px;text-align:center;font-size:11px;font-weight:500;color:${CARVAO}`
const tdLbl = `text-align:left;padding:3px 7px;font-size:11px;font-weight:400;color:${CARVAO}`
const tdV = 'text-align:center;padding:3px 7px;vertical-align:middle'

// Renderiza UM card. `o` = oferta normalizada do prep (+ grupo, opcional).
export function renderCardSre(o) {
  const series = Array.isArray(o.series) ? o.series : []
  const sind = (o.sindicato || []).map(c =>
    `${esc(siglaBanco(c.nome || c.razaoSocial))}${c.lider ? ' (líder)' : ''}`).join(' · ')

  const colHead = series.map((_, i) => `<th style="${thNum}">${i + 1}ª</th>`).join('')
  const rowVenc = series.map(s => `<td style="${tdV};height:28px">${celVenc(s)}</td>`).join('')

  const bb = `border-bottom:1px solid ${DIV}`
  const tabela = series.length
    ? `<div style="padding:5px 8px 7px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:${Math.max(360, 110 + series.length * 90)}px">
          <thead><tr style="background:${BEGE}"><th style="${tdLbl};height:28px">Série</th>${colHead}</tr></thead>
          <tbody>
            <tr><td style="${tdLbl};height:28px;${bb}">Tipo</td>${series.map(s => `<td style="${tdV};height:28px;${bb}">${seloTipo(s.incentivada)}</td>`).join('')}</tr>
            <tr><td style="${tdLbl};height:34px;${bb}">Remuneração</td>${series.map(s => `<td style="${tdV};height:34px;${bb}">${celRemun(s)}</td>`).join('')}</tr>
            <tr><td style="${tdLbl};height:28px">Vencimento</td>${rowVenc}</tr>
          </tbody>
        </table>
      </div>`
    : `<div style="padding:8px 10px;color:${TAUPE};font-style:italic;font-size:11px">Detalhamento das séries ainda não disponível no SRE (oferta recém-protocolada).</div>`

  const razao = o.razaoSocial && o.razaoSocial.toLowerCase() !== String(o.emissor || '').toLowerCase()
    ? esc(o.razaoSocial) : (o.grupo ? esc(o.grupo) : '')

  return `<div style="background:#fff;border:1px solid ${BORDA};border-radius:8px;box-shadow:0 1px 2px rgb(42 36 32 / 7%);overflow:hidden;margin:8px 0;color:${CARVAO}">
    <div style="min-height:42px;padding:5px 10px;border-bottom:1px solid ${DIV};display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0">
        <span style="font-size:11px;color:${T};font-weight:500">${esc(fmtDia(o.data))}</span>
        <span style="font-size:14px;font-weight:500;color:${CARVAO}">${esc(o.emissor || '—')}</span>
        ${razao ? `<span style="font-size:11px;color:${CARVAO}">${razao}</span>` : ''}
      </div>
      ${o.rating ? `<span style="font-size:11px;color:${TAUPE}">${esc(o.rating)}</span>` : ''}
    </div>
    <div style="min-height:32px;padding:4px 10px;border-bottom:1px solid ${DIV};font-size:11px;line-height:1.6;color:${CARVAO}">
      Sindicato <span style="font-weight:500">${sind || '—'}</span>
      <span style="color:${TAUPE};margin:0 7px">|</span>
      Total <span style="font-weight:500">${fmtValor(o.valorTotal)}</span>
      <span style="color:${TAUPE};margin:0 7px">|</span>
      <span style="font-weight:500">${series.length || o.numSeries || '—'} série${(series.length || o.numSeries) === 1 ? '' : 's'}</span>
    </div>
    ${tabela}
  </div>`
}

// Recorta as ofertas SRE pelo intervalo [de, ate] (inclusive, yyyy-MM-dd) e carimba
// o caption do intervalo. Usado pelo semanal e pelo mensal (o diário recorta por
// (prevD, D] direto no build). Devolve null quando não há SRE.
export function recortarSre(sre, de, ate, caption) {
  if (!sre) return null
  const itens = (sre.itens || []).filter(o => o.data >= de && o.data <= ate)
  // Janela de coleta do SRE (periodo.de vem em dd/MM/yyyy). Se o intervalo do
  // relatório termina ANTES do início da coleta, não temos dado — não é "zero
  // ofertas" (regra: nunca afirmar ausência sem ter lido).
  const winDe = sre.periodo?.de ? sre.periodo.de.split('/').reverse().join('-') : null
  const foraDaJanela = !!(winDe && ate < winDe)
  return { ...sre, caption, itens, foraDaJanela }
}

// Renderiza a LISTA de cards (ou o vazio). caption -> rótulo do intervalo.
// Estilos do caption/vazio inline p/ independer do CSS (diário tem cap-dia/empty;
// semanal não).
export function renderSecaoSre(ofertas, caption, foraDaJanela = false) {
  const cap = caption ? ` <span style="font-weight:400;color:${TAUPE};font-size:11px">${esc(caption)}</span>` : ''
  const head = `<h4>Novas ofertas de debêntures na CVM (SRE)${cap}</h4>`
  const vazio = foraDaJanela
    ? 'Período anterior à janela de coleta do SRE — sem dados para este intervalo.'
    : (caption ? `Nenhuma nova oferta de debênture na CVM ${esc(caption)}.` : 'Nenhuma nova oferta de debênture na CVM na janela.')
  if (!ofertas || !ofertas.length) return `${head}<p style="color:${TAUPE};font-style:italic;font-size:12.5px;margin:4px 0">${vazio}</p>`
  return head + ofertas.map(renderCardSre).join('')
}

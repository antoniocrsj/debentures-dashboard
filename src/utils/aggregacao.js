// Agregacao PURA de um PERIODO (semana/mes) a partir das SERIES DIARIAS completas
// (nunca somando relatorios diarios prontos). Sem React, sem I/O.
//   - Captacao/resgate: SOMA no periodo; PL: ULTIMA data (nunca soma/media).
//   - Gestores: liquido somado sobre a serie inteira (nao Top-5 diarios).
//   - Performance: retorno COMPOSTO geometrico ∏(1+r/100)-1; cobertura clara.
import { parseNum } from './format.js'

// Dias uteis distintos que EXISTEM na serie dentro do intervalo (base de cobertura).
export function diasNoIntervalo(rows, range, col = 'Dia') {
  const s = new Set()
  for (const r of rows) { const d = String(r[col] || ''); if (d >= range.start && d <= range.end) s.add(d) }
  return [...s].sort()
}

// §3 Captacao por periodo. rows = Fluxo_Diario (Dia,Gestor_Apelido,Captacao,Resgate,Liquido,PL,Num_Fundos).
export function aggCaptacaoPeriodo(rows, range) {
  let captacao = 0, resgate = 0
  const dias = new Set()
  const plPorDia = new Map()      // dia -> soma PL dos gestores
  const fundosPorDia = new Map()
  for (const r of rows) {
    const d = String(r.Dia || '')
    if (d < range.start || d > range.end) continue
    dias.add(d)
    captacao += parseNum(r.Captacao)
    resgate += parseNum(r.Resgate)
    plPorDia.set(d, (plPorDia.get(d) || 0) + parseNum(r.PL))
    fundosPorDia.set(d, (fundosPorDia.get(d) || 0) + parseNum(r.Num_Fundos))
  }
  const ord = [...dias].sort()
  const ate = ord[ord.length - 1] || null
  const de = ord[0] || null
  return {
    captacao, resgate, liquido: captacao - resgate,
    pl: ate ? (plPorDia.get(ate) || 0) : 0,       // PL na ULTIMA data (nao soma)
    numFundos: ate ? (fundosPorDia.get(ate) || 0) : 0,
    dataPl: ate, de, ate, diasUteis: dias.size,
  }
}

// §4 Destaques por gestor no periodo (serie completa, nao Top-5 diarios).
export function aggGestoresPeriodo(rows, range) {
  const m = new Map()
  for (const r of rows) {
    const d = String(r.Dia || '')
    if (d < range.start || d > range.end) continue
    const g = String(r.Gestor_Apelido || r.Gestor || '').trim()
    if (!g) continue
    let o = m.get(g)
    if (!o) { o = { gestor: g, captacao: 0, resgate: 0, dias: new Set(), plPorDia: new Map() }; m.set(g, o) }
    o.captacao += parseNum(r.Captacao)
    o.resgate += parseNum(r.Resgate)
    o.dias.add(d)
    o.plPorDia.set(d, parseNum(r.PL))
  }
  return [...m.values()].map(o => {
    const ate = [...o.dias].sort().pop()
    return {
      gestor: o.gestor, captacao: o.captacao, resgate: o.resgate,
      liquido: o.captacao - o.resgate, pl: ate ? o.plPorDia.get(ate) : 0, dias: o.dias.size,
    }
  }).sort((a, b) => b.liquido - a.liquido)
}

// §8 Performance por periodo: retorno COMPOSTO por fundo + cobertura.
// rows = Perf_Diario (Dia,CNPJ_Fundo,Gestor_Apelido,RetornoCota[% diario],PL).
// Regra de cobertura: precisa de >= minCobertura dos dias uteis do periodo; dias
// com retorno |r|>MAX_DIARIO% sao GLITCH de dado (cotizacao) -> o fundo sai do
// ranking (nao vira retorno zero) e conta na cobertura.
const MAX_DIARIO = 25
export function aggPerfPeriodo(rows, range, { minCobertura = 0.6, nomePorCnpj = new Map() } = {}) {
  const diasSerie = diasNoIntervalo(rows, range).length
  const m = new Map()
  for (const r of rows) {
    const d = String(r.Dia || '')
    if (d < range.start || d > range.end) continue
    const cnpj = String(r.CNPJ_Fundo || '').replace(/\D/g, '')
    if (!cnpj) continue
    let o = m.get(cnpj)
    if (!o) o = m.set(cnpj, { cnpj, gestor: String(r.Gestor_Apelido || '').trim(), fator: 1, obs: 0, dias: [], glitch: false, pl: 0 }).get(cnpj)
    const ret = parseNum(r.RetornoCota)
    if (Math.abs(ret) > MAX_DIARIO) { o.glitch = true; continue }
    o.fator *= (1 + ret / 100)
    o.obs++
    o.dias.push(d)
    o.pl = parseNum(r.PL)   // ultimo PL visto
  }
  const fundos = [], excluidos = { insuficiente: 0, glitch: 0 }
  for (const o of m.values()) {
    if (o.glitch) { excluidos.glitch++; continue }
    const cobertura = diasSerie > 0 ? o.obs / diasSerie : 0
    if (cobertura < minCobertura || o.obs < 2) { excluidos.insuficiente++; continue }
    const ord = o.dias.sort()
    fundos.push({
      cnpj: o.cnpj, nome: nomePorCnpj.get(o.cnpj) || o.cnpj, gestor: o.gestor,
      retorno: Math.round((o.fator - 1) * 1e6) / 1e4,   // % composto, 2 casas
      obs: o.obs, de: ord[0], ate: ord[ord.length - 1], pl: o.pl,
    })
  }
  fundos.sort((a, b) => b.retorno - a.retorno)
  return { fundos, diasUteis: diasSerie, minCobertura, excluidos }
}

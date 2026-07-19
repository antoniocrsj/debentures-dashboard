// Agregacao PURA do IDA (Indice de Debentures ANBIMA) por periodo. Da' a DIRECAO
// AGREGADA de mercado — util no relatorio quando o detalhe por ativo nao existe
// (cold-start dos snapshots ANBIMA). Sem React, sem I/O.
//
// Retorno do indice = confiavel (nivel do indice, historico desde 2009/2015).
// Variacao de spread em bps: CDI e' confiavel (IMA-S ~0 duration -> credito
// limpo); IPCA-Infra e' REGIME/aproximado (a curva de juro real nao cancela no
// nivel) -> marcado com spreadConfiavel:false.

// Segmento do app -> familia IDA/spread.
export const IDA_SEG = {
  '12431': { codigo: 'IDAIPCAINFRAESTRUTURA', nome: 'IDA-IPCA Infraestrutura', par: 'IPCAINFRA', spreadConfiavel: false },
  trad:    { codigo: 'IDADI',                 nome: 'IDA-DI',                  par: 'CDI',       spreadConfiavel: true },
}

// series ASC por data: retorna o ultimo registro com data <= alvo (ou null).
export function lastAtOrBefore(series, alvo) {
  let hit = null
  for (const r of series) { if (r.data <= alvo) hit = r; else break }
  return hit
}

// idaByCode: Map(codigo -> [{ data, numero }] ASC)
// spreadByPar: Map(par -> [{ data, spreadBps }] ASC)
// antes = ultimo pregao ANTES do periodo; fim = ultimo pregao DENTRO do periodo.
// -> { '12431': {...}|null, trad: {...}|null }
export function aggIda(idaByCode, spreadByPar, antes, fim) {
  const out = {}
  for (const [seg, cfg] of Object.entries(IDA_SEG)) {
    const idx = idaByCode.get(cfg.codigo) || []
    const iAntes = lastAtOrBefore(idx, antes), iFim = lastAtOrBefore(idx, fim)
    if (!iAntes || !iFim || iAntes.data === iFim.data || !(iAntes.numero > 0)) { out[seg] = null; continue }
    const retorno = iFim.numero / iAntes.numero - 1
    const spr = spreadByPar.get(cfg.par) || []
    const sAntes = lastAtOrBefore(spr, antes), sFim = lastAtOrBefore(spr, fim)
    const spreadIni = sAntes ? sAntes.spreadBps : null
    const spreadFim = sFim ? sFim.spreadBps : null
    out[seg] = {
      indice: cfg.nome,
      retornoPct: Math.round(retorno * 1e6) / 1e4,   // % com 2 casas
      dataIni: iAntes.data, dataFim: iFim.data,
      spreadIniBps: spreadIni != null ? Math.round(spreadIni) : null,
      spreadFimBps: spreadFim != null ? Math.round(spreadFim) : null,
      variacaoBps: (spreadIni != null && spreadFim != null) ? Math.round(spreadFim - spreadIni) : null,
      spreadConfiavel: cfg.spreadConfiavel,
    }
  }
  return out
}

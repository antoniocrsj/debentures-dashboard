// Parser da AGENDA de eventos da ANBIMA (data-api web-bff) → resumo de prazo e
// amortização. Cada evento cru tem: data_evento, evento_arc ('Juros' |
// 'Amortização'), taxa (% do evento, formato en "1.600000"), evento (texto),
// status { status }. Ver amostra em tools/_anbima_agenda_*.json.
//
// Deriva o rótulo compacto "Ny (a/b)" pedido pelo usuário:
//   N = prazo em anos (emissão → vencimento);
//   a/b = primeiro→último ano (relativo à emissão) em que há amortização;
//   amortização única de ~100% no vencimento → "Ny bullet".

const MS_ANO = 365.25 * 864e5

function parseDataFlex(s) {
  if (!s) return null
  const t = String(s).trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  return null
}

// taxa vem em formato "en" com muitos zeros ("100.000000000000000"). '' → null.
function numEn(v) {
  if (v == null || String(v).trim() === '') return null
  const n = parseFloat(String(v))
  return Number.isNaN(n) ? null : n
}

const ehAmort = e => /amortiz/i.test(String(e.evento_arc || e.evento || ''))

/**
 * @param content array de eventos (agenda.content da API)
 * @param emissao string data de emissão ('yyyy-MM-dd' ou 'dd/MM/yyyy')
 * @param vencimento string data de vencimento (idem)
 * @returns { prazoAnos, amortLabel, eventos, amortizacoes }
 */
export function parseAgenda(content, emissao, vencimento) {
  const eventos = (content || [])
    .map(e => ({
      data: parseDataFlex(e.data_evento),
      dataStr: (e.data_evento || '').slice(0, 10),
      tipo: (e.evento_arc || '').trim(),        // 'Juros' | 'Amortização'
      descricao: (e.evento || '').trim(),        // ex.: 'PAGAMENTO DE JUROS'
      pct: numEn(e.taxa),
      status: (e.status && e.status.status) || '',
      amort: ehAmort(e),
    }))
    .filter(e => e.data)
    .sort((a, b) => a.data - b.data)

  const dEmis = parseDataFlex(emissao)
  const dVenc = parseDataFlex(vencimento) || (eventos.length ? eventos[eventos.length - 1].data : null)
  const prazoAnos = dEmis && dVenc ? Math.round((dVenc - dEmis) / MS_ANO) : null

  const amortizacoes = eventos.filter(e => e.amort)
  const anos = amortizacoes
    .map(e => (dEmis ? Math.max(1, Math.round((e.data - dEmis) / MS_ANO)) : null))
    .filter(a => a != null)

  let amortLabel = null
  if (prazoAnos) {
    if (!amortizacoes.length) {
      amortLabel = `${prazoAnos}y`
    } else if (amortizacoes.length === 1 && (amortizacoes[0].pct == null || amortizacoes[0].pct >= 99.5)) {
      amortLabel = `${prazoAnos}y bullet`
    } else if (anos.length) {
      const a = Math.min(...anos), b = Math.max(...anos)
      amortLabel = `${prazoAnos}y (${a === b ? a : `${a}/${b}`})`
    } else {
      amortLabel = `${prazoAnos}y`
    }
  }

  // Cadência do cupom, pela mediana do intervalo entre pagamentos de juros.
  const jurosDatas = eventos.filter(e => !e.amort).map(e => e.data)
  let cupom = null
  if (jurosDatas.length >= 2) {
    const gaps = []
    for (let i = 1; i < jurosDatas.length; i++) gaps.push((jurosDatas[i] - jurosDatas[i - 1]) / MS_ANO * 12)
    gaps.sort((a, b) => a - b)
    const med = gaps[Math.floor(gaps.length / 2)]
    cupom = med <= 1.5 ? 'mensal' : med <= 4 ? 'trimestral' : med <= 7 ? 'semestral' : med <= 13 ? 'anual' : `${Math.round(med)} meses`
  }

  return { prazoAnos, amortLabel, cupom, eventos, amortizacoes }
}

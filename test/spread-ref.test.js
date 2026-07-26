import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classificarIndexadorSec, converterSpreadSec } from '../src/utils/spreadRef.js'

const MINUS = '−'

// Curva por data: dois dias com curvas diferentes (testa "curva por dia").
const CURVAS = {
  '2026-07-24': {
    ntnb: [{ venc: '2035-05-15', taxa: 6.50 }, { venc: '2029-05-15', taxa: 6.20 }],
    ltn: [{ venc: '2029-01-01', taxa: 12.50 }, { venc: '2033-01-01', taxa: 13.00 }],
  },
  '2026-07-17': {
    ntnb: [{ venc: '2035-05-15', taxa: 7.00 }],  // curva mais alta nesse dia
    ltn: [{ venc: '2029-01-01', taxa: 13.00 }],
  },
}

// --- classificacao ----------------------------------------------------------
test('classificarIndexadorSec: prioriza o tipo ANBIMA, com fallback pelo indexador', () => {
  assert.equal(classificarIndexadorSec('qualquer', 'IPCA_SPREAD'), 'IPCA')
  assert.equal(classificarIndexadorSec('qualquer', 'DI_SPREAD'), 'DI+')
  assert.equal(classificarIndexadorSec('qualquer', 'DI_PERCENTUAL'), '%DI')
  assert.equal(classificarIndexadorSec('qualquer', 'PREFIXADO'), 'PRE')
  // fallback pela string do cadastro
  assert.equal(classificarIndexadorSec('IPCA', ''), 'IPCA')
  assert.equal(classificarIndexadorSec('DI + spread', ''), 'DI+')
  assert.equal(classificarIndexadorSec('% do DI', ''), '%DI')
  assert.equal(classificarIndexadorSec('Pré-fixado', ''), 'PRE')
  assert.equal(classificarIndexadorSec('IGP-M', ''), 'OUTRO')
})

// --- IPCA -> B{AA} +/- N bps (usa a NTN-B de venc. proximo, na curva do dia) --
test('IPCA: spread vs NTN-B de vencimento proximo, na curva da data do trade', () => {
  const t = { taxa: '7,00', tipoTaxaAnbima: 'IPCA_SPREAD', vencimento: '15/05/2035', data: '2026-07-24' }
  const r = converterSpreadSec(t, CURVAS)
  assert.equal(r.tipo, 'IPCA')
  assert.equal(r.formatada, 'B35 +50 bps')          // (7,00 - 6,50) * 100
  assert.equal(r.spreadNum, 50)
  assert.match(r.ref, /^B35 @ 6,50%$/)
})

test('IPCA: spread negativo (papel mais tight que a NTN-B)', () => {
  const t = { taxa: '6,30', tipoTaxaAnbima: 'IPCA_SPREAD', vencimento: '2035-05-15', data: '2026-07-24' }
  const r = converterSpreadSec(t, CURVAS)
  assert.equal(r.formatada, `B35 ${MINUS}20 bps`)   // (6,30 - 6,50) * 100
  assert.equal(r.spreadNum, -20)
})

test('IPCA: usa a curva do DIA do trade (mesma NTN-B, taxa diferente por dia)', () => {
  const base = { taxa: '7,50', tipoTaxaAnbima: 'IPCA_SPREAD', vencimento: '2035-05-15' }
  assert.equal(converterSpreadSec({ ...base, data: '2026-07-24' }, CURVAS).spreadNum, 100) // vs 6,50
  assert.equal(converterSpreadSec({ ...base, data: '2026-07-17' }, CURVAS).spreadNum, 50)  // vs 7,00
})

test('IPCA: escolhe a NTN-B de vencimento MAIS PROXIMO', () => {
  const t = { taxa: '6,40', tipoTaxaAnbima: 'IPCA_SPREAD', vencimento: '2029-06-01', data: '2026-07-24' }
  const r = converterSpreadSec(t, CURVAS)
  assert.equal(r.ref, 'B29 @ 6,20%')                // pega a de 2029, nao a de 2035
  assert.equal(r.spreadNum, 20)
})

// --- DI+ -> CDI +/- X% (sem curva) ------------------------------------------
test('DI+: a taxa negociada JA e o spread; nao precisa de curva', () => {
  const r = converterSpreadSec({ taxa: '1,20', tipoTaxaAnbima: 'DI_SPREAD' }, null)
  assert.equal(r.formatada, 'CDI +1,20%')
  assert.equal(r.spreadNum, 1.2)
  const neg = converterSpreadSec({ taxa: '-0,30', tipoTaxaAnbima: 'DI_SPREAD' }, null)
  assert.equal(neg.formatada, `CDI ${MINUS}0,30%`)
})

// --- %DI -> CDI +/- X% (via LTN, aprox. linear igual ao Tx Anbima) -----------
test('%DI: converte via LTN (reproduz o exemplo 102% ~ CDI +0,25% p/ LTN 12,5%)', () => {
  const t = { taxa: '102', tipoTaxaAnbima: 'DI_PERCENTUAL', vencimento: '2029-01-01', data: '2026-07-24' }
  const r = converterSpreadSec(t, CURVAS)
  assert.equal(r.formatada, 'CDI +0,25%')           // 12,50 * (1,02 - 1)
  assert.ok(Math.abs(r.spreadNum - 0.25) < 1e-9)
})

// --- Pre -> DI +/- X% (fixo - LTN) ------------------------------------------
test('PRE: DI+ = taxa fixa - LTN de vencimento proximo', () => {
  const t = { taxa: '13,70', tipoTaxaAnbima: 'PREFIXADO', vencimento: '2029-01-01', data: '2026-07-24' }
  const r = converterSpreadSec(t, CURVAS)
  assert.equal(r.formatada, 'DI +1,20%')            // 13,70 - 12,50
  assert.ok(Math.abs(r.spreadNum - 1.2) < 1e-9)
})

// --- casos de borda ---------------------------------------------------------
test('sem curva do dia (IPCA/%DI/PRE) -> null; taxa ausente -> null; IGP-M -> null', () => {
  assert.equal(converterSpreadSec({ taxa: '7,00', tipoTaxaAnbima: 'IPCA_SPREAD', vencimento: '2035-05-15', data: '2030-01-01' }, CURVAS), null) // dia sem curva
  assert.equal(converterSpreadSec({ taxa: '-', tipoTaxaAnbima: 'DI_SPREAD' }, CURVAS), null) // sem taxa
  assert.equal(converterSpreadSec({ taxa: '5,00', indexador: 'IGP-M', data: '2026-07-24' }, CURVAS), null) // outro indexador
})

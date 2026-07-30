import test from 'node:test'
import assert from 'node:assert/strict'
import { agregaNegociosPorSemana, resumoNegociosSecundario } from '../src/utils/secondary.js'

test('resumo secundario separa volumes 12.431 e tradicional e conta trades', () => {
  const resumo = resumoNegociosSecundario([
    { volumeRs: 10_000_000, lei12431: 'Sim' },
    { volumeRs: 2_500_000, lei12431: 'sim' },
    { volumeRs: 7_000_000, lei12431: 'Não' },
    { volumeRs: null, lei12431: '' },
  ])

  assert.deepEqual(resumo, {
    volume12431: 12_500_000,
    volumeTradicional: 7_000_000,
    numeroTrades: 4,
  })
})

test('resumo secundario vazio retorna zeros', () => {
  assert.deepEqual(resumoNegociosSecundario(), {
    volume12431: 0,
    volumeTradicional: 0,
    numeroTrades: 0,
  })
})

test('agrega volume e quantidade de trades por semana ISO', () => {
  assert.deepEqual(agregaNegociosPorSemana([
    { data: '2026-07-20', volumeRs: 10_000_000 },
    { data: '2026-07-24', volumeRs: 2_500_000 },
    { data: '2026-07-27', volumeRs: 7_000_000 },
    { data: 'invalida', volumeRs: 99_000_000 },
  ]), [
    {
      semana: '2026-W30',
      inicio: '2026-07-20',
      fim: '2026-07-24',
      volume: 12_500_000,
      trades: 2,
    },
    {
      semana: '2026-W31',
      inicio: '2026-07-27',
      fim: '2026-07-31',
      volume: 7_000_000,
      trades: 1,
    },
  ])
})

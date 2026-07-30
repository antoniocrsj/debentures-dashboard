import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agregaNegociosPorSemana,
  recortaNegociosPorPeriodo,
  resumoNegociosSecundario,
} from '../src/utils/secondary.js'

test('recorta o secundario em meses a partir da data mais recente da base', () => {
  const rows = [
    { data: '2025-06-29', id: 'fora-12m' },
    { data: '2025-06-30', id: 'inicio-12m' },
    { data: '2025-12-30', id: 'inicio-6m' },
    { data: '2026-03-30', id: 'inicio-3m' },
    { data: '2026-06-30', id: 'ancora' },
  ]

  assert.deepEqual(recortaNegociosPorPeriodo(rows, 3).map(row => row.id), ['inicio-3m', 'ancora'])
  assert.deepEqual(recortaNegociosPorPeriodo(rows, 6).map(row => row.id), ['inicio-6m', 'inicio-3m', 'ancora'])
  assert.deepEqual(recortaNegociosPorPeriodo(rows, 12).map(row => row.id), ['inicio-12m', 'inicio-6m', 'inicio-3m', 'ancora'])
})

test('ajusta o inicio da janela para o ultimo dia de meses mais curtos', () => {
  const rows = [
    { data: '2026-02-27' },
    { data: '2026-02-28' },
    { data: '2026-03-31' },
  ]

  assert.deepEqual(recortaNegociosPorPeriodo(rows, 1).map(row => row.data), ['2026-02-28', '2026-03-31'])
})

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

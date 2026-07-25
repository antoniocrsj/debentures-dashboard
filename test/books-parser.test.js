import { test } from 'node:test'
import assert from 'node:assert/strict'

import { valorMM, blocosSerie, extrairSerie, herdarHeader, mensagensDeExport, parsearMensagem, chaveNatural } from '../tools/parsear-books.mjs'

const ENERGISA_RAW = `*DEB 12.431 – Energisa (EMT e EMS)*
*ICVM 160 - IP*
Coordenador: BTG (Líder)
Data do book: 15/07/2026
Rating: AAA
Volume Base: R$ 700mm (R$ 350mm em cada emissor)
Demanda: Não Informado
Emissão: R$ 700mm
*Série Única*
Prazo: 10y (8/9/10)
Taxa Fixa: NTN-B 2035 - 0,10% ou IPCA + 7,79% Des(B35 + 0,20%) (pendente fixing)
Club Deal`

const GRP_ENERGISA = { grupos: new Map([['energisa', 'Energisa']]), emissores: new Map(), gByCnpj: new Map() }

// --- volume ------------------------------------------------------------------
test('valorMM: mm, bi e ausente', () => {
  assert.equal(valorMM('R$ 700mm'), 700)
  assert.equal(valorMM('R$ 2,6 bi'), 2600)
  assert.equal(valorMM('Não Informado'), null)   // sem digito -> null
})

// --- serie unica herda campos de book do cabecalho (caso Energisa 15/07) -----
test('serie unica: herda Emissao do cabecalho, preserva taxa/prazo da serie', () => {
  const corpo = [
    '*ICVM 160 - IP*',
    'Coordenador: BTG (Líder)',
    'Data do book: 15/07/2026',
    'Rating: AAA',
    'Volume Base: R$ 700mm (R$ 350mm em cada emissor)',
    'Demanda: Não Informado',
    'Emissão: R$ 700mm',
    '*Série Única*',
    'Prazo: 10y (8/9/10)',
    'Taxa Fixa: NTN-B 2035 - 0,10% ou IPCA + 7,79% Des(B35 + 0,20%) (pendente fixing)',
    'Club Deal',
  ]
  const { header, blocos } = blocosSerie(corpo)
  assert.equal(blocos.length, 1)
  const headerFields = extrairSerie(header.join('\n'))
  const s = herdarHeader(extrairSerie(blocos[0].linhas.join('\n')), headerFields)

  // veio da serie (nao pode ser sobrescrito pelo cabecalho)
  assert.equal(s.prazo, '10y (8/9/10)')
  assert.equal(s.ipcaEquivFinal, 7.79)
  assert.equal(s.ntnbFinal, 'B35')
  assert.equal(s.indexadorFinal, 'NTN-B')
  // AGORA herdado do cabecalho (antes ficava vazio)
  assert.equal(s.emissaoMM, 700)
})

// --- multi-serie NAO herda (cada serie tem o seu volume) ---------------------
test('multi-serie: cada serie mantem o seu Emissao, sem herdar do cabecalho', () => {
  const corpo = [
    'Emissão: R$ 1000mm',       // volume total no cabecalho
    '*1ª Série*',
    'Prazo: 5y',
    'Taxa: CDI + 0,50%',
    'Emissão: R$ 600mm',
    '*2ª Série*',
    'Prazo: 7y',
    'Taxa: CDI + 0,70%',
    'Emissão: R$ 400mm',
  ]
  const { blocos } = blocosSerie(corpo)
  assert.equal(blocos.length, 2)
  const headerFields = blocos.length === 1 ? extrairSerie('') : null   // regra da main()
  assert.equal(headerFields, null)

  const s1 = herdarHeader(extrairSerie(blocos[0].linhas.join('\n')), headerFields)
  const s2 = herdarHeader(extrairSerie(blocos[1].linhas.join('\n')), headerFields)
  assert.equal(s1.emissaoMM, 600)   // a sua, nao o total (1000) do cabecalho
  assert.equal(s2.emissaoMM, 400)
})

// --- fonte Ana: export cru -> mensagens -> pipeline --------------------------
test('mensagensDeExport: raw vira mensagem (1a linha = titulo); vazios ignorados', () => {
  const msgs = mensagensDeExport([{ raw: ENERGISA_RAW }, { raw: '   ' }, {}, { raw: '*DEB - X*\nTaxa: CDI + 0,5%' }])
  assert.equal(msgs.length, 2)                                  // 2 vazios descartados
  assert.equal(msgs[0].linhas[0], '*DEB 12.431 – Energisa (EMT e EMS)*')
  assert.equal(msgs[0].autor, 'ana')
})

test('parsearMensagem: book da Ana (serie unica) -> linha com Emissao herdada', () => {
  const [msg] = mensagensDeExport([{ raw: ENERGISA_RAW }])
  const p = parsearMensagem(msg, GRP_ENERGISA, [])
  assert.equal(p.deb, true)
  assert.equal(p.grupo, 'Energisa')
  assert.equal(p.rows.length, 1)
  const r = p.rows[0]
  assert.equal(r.DataBook, '15/07/2026')
  assert.equal(r.Serie, 'unica')
  assert.equal(r.Prazo, '10y (8/9/10)')
  assert.equal(r.IpcaEquivFinalPct, 7.79)
  assert.equal(r.EmissaoMM, 700)                                // herdou do cabecalho (fix)
  assert.equal(r.EmissorRaw, '')                               // Energisa: prefixo, sem nome
})

test('parsearMensagem: nao-book retorna null', () => {
  assert.equal(parsearMensagem({ data: '', autor: 'ana', linhas: ['Bom dia a todos'] }, GRP_ENERGISA, []), null)
})

// --- upsert: re-parse casa a linha do CSV existente (nao duplica) ------------
test('chaveNatural: mesma serie do mesmo book gera a MESMA chave (upsert)', () => {
  const [msg] = mensagensDeExport([{ raw: ENERGISA_RAW }])
  const novo = parsearMensagem(msg, GRP_ENERGISA, []).rows[0]
  // linha equivalente vinda do CSV historico (EmissaoMM vazio, mesma identidade)
  const doCsv = { DataBook: '15/07/2026', Grupo: 'Energisa', EmissorRaw: '', Serie: 'unica', Prazo: '10y (8/9/10)', EmissaoMM: '' }
  assert.equal(chaveNatural(novo), chaveNatural(doCsv))          // mesma chave -> update, nao duplica
})

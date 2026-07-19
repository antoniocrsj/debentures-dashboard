import { useEffect } from 'react'
import { fmtBRL } from '../utils/format.js'

const MONEY_FIELDS = new Set(['LiquidoRecente', 'CaptacaoRecente', 'ResgateRecente', 'PLRecente', 'TotalAlocado'])
const TEXT_FIELDS = new Set(['UltimaSemana', 'MesAno', 'DataRef'])

function fmtTimestamp(iso) {
  if (!iso) return '—'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  const [, y, mo, d, h, mi] = m
  return `${d}/${mo}/${y} ${h}:${mi}`
}

function fmtDataCurta(iso) {
  if (!iso) return '—'
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : iso
}

const ORDINAL = n => (Number.isFinite(Number(n)) ? `${Number(n)}ª` : n)

function fmtCampo(campo, valor) {
  if (valor == null || valor === '') return '—'
  if (MONEY_FIELDS.has(campo)) return fmtBRL(Number(valor))
  if (TEXT_FIELDS.has(campo)) return String(valor)
  const n = Number(valor)
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : String(valor)
}

const LABELS = {
  Total: 'Fundos distintos', Gestores: 'Gestores', SemGestor: 'Fundos sem gestor',
  Semanas: 'Semanas na base', UltimaSemana: 'Semana mais recente',
  LiquidoRecente: 'Cap. líquida (semana recente)', CaptacaoRecente: 'Captação (semana recente)',
  ResgateRecente: 'Resgate (semana recente)', PLRecente: 'PL (semana recente)',
  Ativos: 'Ativos', Emissores: 'Emissores', Incentivadas: 'Deb. incentivadas', Registradas: 'Registradas',
  MesAno: 'Mês registrado', TotalAlocado: 'Alocação',
  DataRef: 'Data de referência', Tickers: 'Tickers na base', ComTaxa: 'Com Tx ANBIMA',
}

const SOURCES = [
  { key: 'debentures', title: 'Debêntures' },
  { key: 'fundos', title: 'Lista de Fundos 12.431/CDI' },
  { key: 'captacao12431', title: 'Captação — 12.431' },
  { key: 'captacaoTrad', title: 'Captação — Tradicional' },
  { key: 'blc', title: 'BLC / Alocação' },
  { key: 'anbima', title: 'ANBIMA' },
]

function ImpactoSection({ title, campos }) {
  if (!campos) return null
  const linhas = Object.entries(campos).filter(([, v]) => v && (v.antes !== v.depois))
  if (!linhas.length) return null
  return (
    <div className="modal-section">
      <h3 className="modal-section-title">{title}</h3>
      {linhas.map(([campo, { antes, depois }]) => (
        <div className="modal-row" key={campo}>
          <span className="modal-label">{LABELS[campo] || campo}</span>
          <span className="modal-value">{fmtCampo(campo, antes)} → <strong>{fmtCampo(campo, depois)}</strong></span>
        </div>
      ))}
    </div>
  )
}

const ETAPA_LABELS = { Debentures: 'Debêntures', Fundos: 'Lista de fundos', Captacao: 'Captação', BLC: 'BLC / Alocação', ANBIMA: 'ANBIMA', Ofertas: 'Ofertas CVM' }

export default function AtualizacaoResumoModal({ resumo, onClose }) {
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const semMudancas = SOURCES.every(s => {
    const campos = resumo.impacto?.[s.key]
    return !campos || Object.values(campos).every(v => !v || v.antes === v.depois)
  })

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Última atualização">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Última atualização</h2>
            <p className="modal-subtitle">{fmtTimestamp(resumo.timestamp)}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-body">
          {resumo.etapas && (
            <div className="modal-section">
              <h3 className="modal-section-title">O que rodou</h3>
              {Object.entries(resumo.etapas).map(([k, v]) => (
                <div className="modal-row" key={k}>
                  <span className="modal-label">{ETAPA_LABELS[k] || k}</span>
                  <span className="modal-value">{v || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(resumo.novasEmissoes) && resumo.novasEmissoes.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">
                🆕 Novas emissões na CVM ({resumo.novasEmissoes.length})
              </h3>
              <p className="modal-desc">
                Debêntures já registradas na CVM (Resolução 160) que ainda não
                aparecem no cadastro do Debentures.com.br.
              </p>
              {resumo.novasEmissoes.map((e, i) => (
                <div className="modal-row" key={`${e.emissor}-${e.emissao}-${i}`}>
                  <span className="modal-label">
                    {e.emissor} — {ORDINAL(e.emissao)} emissão
                    {e.incentivada ? <span className="badge-lei"> 12.431</span> : null}
                  </span>
                  <span className="modal-value">
                    {e.valor > 0 ? fmtBRL(e.valor) : '—'}
                    <small className="modal-emis-data"> · {fmtDataCurta(e.dataRegistro)}</small>
                  </span>
                </div>
              ))}
            </div>
          )}

          {semMudancas
            ? <p className="modal-desc">Nenhum número mudou nesta rodada em relação à anterior.</p>
            : SOURCES.map(s => (
                <ImpactoSection key={s.key} title={s.title} campos={resumo.impacto?.[s.key]} />
              ))}
        </div>
      </div>
    </div>
  )
}

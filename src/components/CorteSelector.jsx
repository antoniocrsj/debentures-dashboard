import { CORTES, CORTE_OFICIAL } from '../utils/corte.js'

// Seletor GLOBAL do corte de %Deb. Redefine quais fundos entram na conta em
// Captacao, Caixa e Tecnico.
//
// STEPPER (< valor >) e nao botoes lado a lado: a fileira de 5 degraus ocupava
// a largura inteira do topo e competia visualmente com os filtros de verdade
// (segmento, gestor, periodo), parecendo a coisa mais importante da tela --
// quando e' um refinamento. Assim ocupa o espaco de um filtro e senta ao lado
// dos outros. Os degraus continuam os mesmos; muda so' a forma de andar neles.
//
// Fica OCULTO onde nao tem efeito (Debentures e' visao do ATIVO, sem universo
// de fundos p/ cortar) -- filtro que nao filtra e' pior que filtro ausente.
export default function CorteSelector({ corte, onChange, disponivel = true, compact = false }) {
  if (!disponivel) return null

  const i = CORTES.indexOf(corte)
  const idx = i < 0 ? CORTES.indexOf(CORTE_OFICIAL) : i
  const podeMenos = idx > 0
  const podeMais = idx < CORTES.length - 1

  return (
    <div className={`corte-step${compact ? ' compact' : ''}`}>
      <span className="corte-step-label" title="Percentual mínimo do PL em debêntures para o fundo entrar na conta">
        %Deb
      </span>
      <div className="corte-step-box">
        <button
          type="button" className="corte-step-btn" aria-label="Reduzir o corte de %Deb"
          disabled={!podeMenos} onClick={() => podeMenos && onChange(CORTES[idx - 1])}
        >‹</button>
        <span className="corte-step-val" aria-live="polite"
          title={corte === CORTE_OFICIAL
            ? `${corte}% — régua oficial da curadoria`
            : `${corte}% — recorte hipotético: só fundos com mais de ${corte}% do PL em debêntures`}>
          {corte}%
          {corte === CORTE_OFICIAL && <span className="corte-step-oficial" title="Régua oficial da curadoria">•</span>}
        </span>
        <button
          type="button" className="corte-step-btn" aria-label="Aumentar o corte de %Deb"
          disabled={!podeMais} onClick={() => podeMais && onChange(CORTES[idx + 1])}
        >›</button>
      </div>
    </div>
  )
}

import { CORTES, CORTE_OFICIAL } from '../utils/corte.js'

// Seletor GLOBAL do corte de %Deb (topo do app). Redefine quais fundos entram
// na conta em Captacao, Caixa e no lado "carteira" do Vencimentos.
//
// Fica OCULTO nas abas onde nao tem efeito (Debentures e' visao do ativo, nao
// tem universo de fundos p/ cortar) -- filtro que nao filtra e' pior que filtro
// ausente. Tambem some se o mapa de %Deb nao carregou.
export default function CorteSelector({ corte, onChange, disponivel = true, compact = false }) {
  if (!disponivel) return null

  return (
    <div className={`corte-sel${compact ? ' compact' : ''}`}>
      <span className="corte-sel-label" title="Percentual minimo do PL em debentures para o fundo entrar na conta">
        %Deb
      </span>
      <div className="segmented corte-sel-btns" role="group" aria-label="Corte minimo de % do PL em debentures">
        {CORTES.map(c => (
          <button
            key={c}
            type="button"
            className={`segmented-btn${c === corte ? ' active' : ''}`}
            aria-pressed={c === corte}
            title={c === CORTE_OFICIAL
              ? `${c}% — regua oficial da curadoria`
              : `${c}% — recorte hipotetico: so' fundos com mais de ${c}% do PL em debentures`}
            onClick={() => onChange(c)}
          >
            {c}%{c === CORTE_OFICIAL ? '*' : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

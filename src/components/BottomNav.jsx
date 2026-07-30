// Barra de navegacao inferior FIXA (so' no modo compacto/mobile). Substitui os
// iconezinhos de secao que ficavam no topo (Header) por abas no rodape, com
// rotulo, alcancaveis com o polegar. Fundo navy (= header), aba ativa em branco
// com traco de accent no topo do icone. Respeita a safe-area do iPhone.
// Os desenhos vivem em SectionIcons.jsx (compartilhados com as abas de topo).
import {
  DebenturesIcon, SecundarioIcon, CaptacaoIcon, CaixaIcon, VencimentosIcon,
} from './SectionIcons.jsx'
import { ABAS_OCULTAS } from '../config/abas.js'

const ITEMS = [
  { id: 'debentures',  label: 'Debêntures',  Icon: DebenturesIcon },
  { id: 'secundario',  label: 'Secundário',  Icon: SecundarioIcon },
  { id: 'captacao',    label: 'Captação',    Icon: CaptacaoIcon },
  { id: 'caixa',       label: 'Caixa',       Icon: CaixaIcon },
  { id: 'vencimentos', label: 'Vencimentos', Icon: VencimentosIcon },
].filter(t => !ABAS_OCULTAS.has(t.id))

export default function BottomNav({ section, onSection }) {
  return (
    <nav className="bottom-nav" role="tablist" aria-label="Seções">
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={section === id}
          className={`bottom-nav-btn${section === id ? ' active' : ''}`}
          onClick={() => onSection(id)}
        >
          <span className="bottom-nav-ico"><Icon /></span>
          <span className="bottom-nav-lbl">{label}</span>
        </button>
      ))}
    </nav>
  )
}

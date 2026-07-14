// Barra de navegacao inferior FIXA (so' no modo compacto/mobile). Substitui os
// iconezinhos de secao que ficavam no topo (Header) por abas no rodape, com
// rotulo, alcancaveis com o polegar. Fundo navy (= header), aba ativa em branco
// com traco de accent no topo do icone. Respeita a safe-area do iPhone.
function DebenturesIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 13 H27 L33 19 V34 A1 1 0 0 1 32 35 H19 A1 1 0 0 1 18 34 V14 A1 1 0 0 1 19 13 Z" />
      <path d="M27 13 V19 H33" />
      <path d="M21 25 H30 M21 28.5 H30 M21 32 H27" />
    </svg>
  )
}
function CaptacaoIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 20 H31" /><path d="M28 17 L31 20 L28 23" />
      <path d="M32 28 H17" /><path d="M20 25 L17 28 L20 31" />
    </svg>
  )
}
function CaixaIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="14" y="18" width="20" height="14" rx="2" />
      <path d="M14 22 H34" />
      <circle cx="28" cy="27" r="1.6" />
      <path d="M17 18 V16 A2 2 0 0 1 19 14 H24" />
    </svg>
  )
}
function VencimentosIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="14" y="15" width="20" height="19" rx="2" />
      <path d="M14 20 H34 M20 13 V17 M28 13 V17" />
      <path d="M20 26 H22 M26 26 H28 M20 30 H22 M26 30 H28" />
    </svg>
  )
}

const ITEMS = [
  { id: 'debentures',  label: 'Debêntures',  Icon: DebenturesIcon },
  { id: 'captacao',    label: 'Captação',    Icon: CaptacaoIcon },
  { id: 'caixa',       label: 'Caixa',       Icon: CaixaIcon },
  { id: 'vencimentos', label: 'Vencimentos', Icon: VencimentosIcon },
]

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
          <Icon />
          <span className="bottom-nav-lbl">{label}</span>
        </button>
      ))}
    </nav>
  )
}

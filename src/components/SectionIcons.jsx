// Icones das sub-abas de Debentures (Ativos/Gestores/Grupos) e do Tecnico, no
// MESMO estilo dos icones do bottom-nav (viewBox 48, stroke currentColor 1.5,
// cantos redondos). Herdam cor e tamanho do elemento-pai. Prontos para as abas
// virarem "icone + texto" (tipo 3 do sistema de botoes).

const svgProps = {
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

// Ativos: lista de papeis (bullets + linhas).
export function AtivosIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="16" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <path d="M21 17 H33" />
      <circle cx="16" cy="24" r="1.4" fill="currentColor" stroke="none" />
      <path d="M21 24 H33" />
      <circle cx="16" cy="31" r="1.4" fill="currentColor" stroke="none" />
      <path d="M21 31 H29" />
    </svg>
  )
}

// Gestores: pessoa (gestora).
export function GestoresIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="24" cy="19" r="4.5" />
      <path d="M15.5 34 a8.5 8.5 0 0 1 17 0" />
    </svg>
  )
}

// Grupos economicos: organograma (matriz + duas controladas).
export function GruposIcon() {
  return (
    <svg {...svgProps}>
      <rect x="20" y="13" width="8" height="6" rx="1.2" />
      <rect x="13" y="29" width="8" height="6" rx="1.2" />
      <rect x="27" y="29" width="8" height="6" rx="1.2" />
      <path d="M24 19 V24 M17 29 V24 H31 V29" />
    </svg>
  )
}

// Tecnico: grafico de barras (analise).
export function TecnicoIcon() {
  return (
    <svg {...svgProps}>
      <path d="M15 33 H33" />
      <rect x="17" y="24" width="4" height="9" rx="0.6" />
      <rect x="23" y="18" width="4" height="15" rx="0.6" />
      <rect x="29" y="27" width="4" height="6" rx="0.6" />
    </svg>
  )
}

// ── Icones das SECOES (nivel de topo) ─────────────────────────────────────
// Vinham inline no BottomNav; centralizados aqui p/ o bottom-nav (compacto) e
// as abas de topo (desktop, tipo 3 icone+texto) usarem os MESMOS desenhos.

// Debentures: documento (o papel de divida).
export function DebenturesIcon() {
  return (
    <svg {...svgProps}>
      <path d="M19 13 H27 L33 19 V34 A1 1 0 0 1 32 35 H19 A1 1 0 0 1 18 34 V14 A1 1 0 0 1 19 13 Z" />
      <path d="M27 13 V19 H33" />
      <path d="M21 25 H30 M21 28.5 H30 M21 32 H27" />
    </svg>
  )
}

// Secundario: serie de TAXA no tempo (linha com ultimo ponto marcado).
export function SecundarioIcon() {
  return (
    <svg {...svgProps}>
      <path d="M15 15 V33 H34" />
      <path d="M18 30 L23 24 L27 27 L33 19" />
      <circle cx="33" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Captacao: setas trocando (fluxo de entrada/saida de cotas).
export function CaptacaoIcon() {
  return (
    <svg {...svgProps}>
      <path d="M16 20 H31" /><path d="M28 17 L31 20 L28 23" />
      <path d="M32 28 H17" /><path d="M20 25 L17 28 L20 31" />
    </svg>
  )
}

// Caixa / Nivel de Caixa: cofre/caixa registradora.
export function CaixaIcon() {
  return (
    <svg {...svgProps}>
      <rect x="14" y="18" width="20" height="14" rx="2" />
      <path d="M14 22 H34" />
      <circle cx="28" cy="27" r="1.6" />
      <path d="M17 18 V16 A2 2 0 0 1 19 14 H24" />
    </svg>
  )
}

// Vencimentos: calendario.
export function VencimentosIcon() {
  return (
    <svg {...svgProps}>
      <rect x="14" y="15" width="20" height="19" rx="2" />
      <path d="M14 20 H34 M20 13 V17 M28 13 V17" />
      <path d="M20 26 H22 M26 26 H28 M20 30 H22 M26 30 H28" />
    </svg>
  )
}

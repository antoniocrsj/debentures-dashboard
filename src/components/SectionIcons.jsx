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

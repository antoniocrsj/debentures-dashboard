import { Component } from 'react'

/**
 * Error Boundary: impede que um erro de renderização ou de import dinâmico (chunk)
 * deixe a área em branco. Mostra um estado de erro claro com "Tentar novamente"
 * e registra o erro real no console (diagnóstico). Sem isso, uma falha no
 * carregamento sob demanda (React.lazy) desmonta a subárvore silenciosamente.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] erro capturado nesta seção:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      const label = this.props.label || 'esta seção'
      return (
        <div className="state-box error">
          <span className="state-icon">⚠️</span>
          <p className="error-msg">Não foi possível carregar {label}.</p>
          <small>{this.state.error?.message || 'Erro inesperado ao montar os componentes.'}</small>
          <button className="btn-retry" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

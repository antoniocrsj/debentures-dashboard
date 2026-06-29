import { lazy } from 'react'

/**
 * React.lazy que RE-TENTA o import dinâmico em falhas transitórias.
 *
 * Por quê: numa rede instável, ou na 1ª abertura (antes do service worker do PWA
 * cachear o chunk), o import do chunk pode falhar uma vez. O React.lazy padrão
 * memoiza essa rejeição → a seção fica em branco até dar refresh. Aqui re-tentamos
 * o import algumas vezes antes de desistir. O delay só ocorre APÓS uma falha real
 * (não atrasa o caminho normal) — não é um atraso artificial para mascarar nada.
 */
export function lazyWithRetry(factory, retries = 3, delay = 500) {
  return lazy(() => new Promise((resolve, reject) => {
    const attempt = left => {
      factory().then(resolve).catch(err => {
        if (left <= 0) {
          console.error('[lazyWithRetry] import falhou após todas as tentativas:', err)
          reject(err)
        } else {
          console.warn(`[lazyWithRetry] import falhou — re-tentando em ${delay}ms (${left} restantes)`, err)
          setTimeout(() => attempt(left - 1), delay)
        }
      })
    }
    attempt(retries)
  }))
}

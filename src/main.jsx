import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Auto-recuperação de "chunk desatualizado": depois de um novo deploy, uma aba
// aberta há dias pode tentar importar um arquivo de build antigo que não existe
// mais. O Vite emite 'vite:preloadError' nesse caso — recarregamos a página uma
// vez (a nova carga já referencia os arquivos certos). Guard em sessionStorage
// evita loop se o problema persistir (ex: bloqueio de rede real).
window.addEventListener('vite:preloadError', event => {
  const key = 'chunk-reload-attempted'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

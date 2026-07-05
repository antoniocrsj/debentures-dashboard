import { useState, useEffect } from 'react'

const STATIC_RESUMO_URL = '/Atualizacao_Resumo.json'

// Resumo da última atualização de dados (gerado por tools/atualizar-tudo.ps1),
// opcional e não-bloqueante: se o arquivo não existir ainda (app recém-
// publicado, antes da primeira rodada com essa funcionalidade), o app segue
// funcionando normalmente e o ícone de resumo no header simplesmente não aparece.
export function useAtualizacaoResumo() {
  const [resumo, setResumo] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(STATIC_RESUMO_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled) setResumo(data) })
      .catch(() => { if (!cancelled) setResumo(null) })
    return () => { cancelled = true }
  }, [])

  return { resumo }
}

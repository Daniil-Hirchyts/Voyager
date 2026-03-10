import { useEffect, type ReactNode } from 'react'
import { useOutletContext } from 'react-router-dom'

export type AppShellOutletContext = {
  setHeaderActions?: (actions: ReactNode | null) => void
  setHeaderMeta?: (meta: ReactNode | null) => void
}

export function useAppShellHeaderActions(actions: ReactNode | null) {
  const setHeaderActions = useOutletContext<AppShellOutletContext | null>()?.setHeaderActions

  useEffect(() => {
    if (!setHeaderActions) {
      return
    }

    setHeaderActions(actions)

    return () => {
      setHeaderActions(null)
    }
  }, [actions, setHeaderActions])

  return Boolean(setHeaderActions)
}

export function useAppShellHeaderMeta(meta: ReactNode | null) {
  const setHeaderMeta = useOutletContext<AppShellOutletContext | null>()?.setHeaderMeta

  useEffect(() => {
    if (!setHeaderMeta) {
      return
    }

    setHeaderMeta(meta)

    return () => {
      setHeaderMeta(null)
    }
  }, [meta, setHeaderMeta])

  return Boolean(setHeaderMeta)
}

interface SessionExpiryHandlerOptions {
  getCurrentPath: () => string
  getCurrentPathname: () => string
  removeUser: () => Promise<void>
  redirectToSignin: () => void
  setIntendedPath: (path: string | null) => void
}

export function getBrowserPath(
  location: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location,
) {
  return `${location.pathname}${location.search}${location.hash}`
}

export function createSessionExpiryHandler({
  getCurrentPath,
  getCurrentPathname,
  removeUser,
  redirectToSignin,
  setIntendedPath,
}: SessionExpiryHandlerOptions) {
  let inFlight: Promise<void> | null = null

  return async () => {
    if (inFlight) {
      return inFlight
    }

    inFlight = (async () => {
      if (getCurrentPathname().startsWith('/app')) {
        setIntendedPath(getCurrentPath())
      }

      try {
        await removeUser()
      } finally {
        redirectToSignin()
      }
    })().finally(() => {
      inFlight = null
    })

    return inFlight
  }
}

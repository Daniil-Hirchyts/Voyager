interface SessionExpiryHandlerOptions {
  getCurrentPath: () => string
  getCurrentPathname: () => string
  removeUser: () => Promise<void>
  startSignin: (intendedPath?: string | null) => Promise<unknown>
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
  startSignin,
}: SessionExpiryHandlerOptions) {
  let inFlight: Promise<void> | null = null

  return async () => {
    if (inFlight) {
      return inFlight
    }

    inFlight = (async () => {
      const intendedPath = getCurrentPathname().startsWith('/app') ? getCurrentPath() : null

      try {
        await removeUser()
      } finally {
        await startSignin(intendedPath)
      }
    })().finally(() => {
      inFlight = null
    })

    return inFlight
  }
}

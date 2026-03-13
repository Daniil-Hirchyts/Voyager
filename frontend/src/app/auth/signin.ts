import type { AuthContextProps } from 'react-oidc-context'

export const DEFAULT_INTENDED_PATH = '/app/trips'

interface StartKeycloakSignInOptions {
  auth: Pick<AuthContextProps, 'signinRedirect'>
  intendedPath?: string | null
  setIntendedPath?: (path: string | null) => void
}

export function resolveIntendedPath(intendedPath?: string | null) {
  return intendedPath || DEFAULT_INTENDED_PATH
}

export async function startKeycloakSignIn({
  auth,
  intendedPath,
  setIntendedPath,
}: StartKeycloakSignInOptions) {
  const nextIntendedPath = resolveIntendedPath(intendedPath)

  setIntendedPath?.(nextIntendedPath)
  await auth.signinRedirect({
    state: { intendedPath: nextIntendedPath },
  })

  return nextIntendedPath
}

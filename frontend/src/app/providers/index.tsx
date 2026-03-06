import { AuthProvider } from './AuthProvider'
import { QueryProvider } from './QueryProvider'
import { Toaster } from 'sonner'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <QueryProvider>
        {children}
        <Toaster position="top-right" richColors />
      </QueryProvider>
    </AuthProvider>
  )
}

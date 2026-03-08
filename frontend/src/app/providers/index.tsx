import { AuthProvider } from './AuthProvider'
import { QueryProvider } from './QueryProvider'
import { Toaster } from 'sonner'
import { GoogleMapsProvider } from '@/shared/layouts/google-maps'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <QueryProvider>
        <GoogleMapsProvider>
          {children}
          <Toaster position="top-right" richColors />
        </GoogleMapsProvider>
      </QueryProvider>
    </AuthProvider>
  )
}

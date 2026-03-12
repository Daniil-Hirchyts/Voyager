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
          <Toaster 
            position="top-center"
            offset="16px"
            duration={1500}
            toastOptions={{
              unstyled: true,
              style: {
                left: 0,
                right: 0,
                width: 'fit-content',
                maxWidth: 'min(400px, calc(100vw - 32px))',
                marginInline: 'auto',
              },
              classNames: {
                toast: 'group flex items-center gap-3 px-4 py-3 rounded-full border border-white/10 backdrop-blur-xl shadow-lg transition-all',
                default: 'bg-zinc-900/90 dark:bg-black/80 text-white',
                success: 'bg-emerald-950/90 dark:bg-emerald-950/50 text-emerald-50 border-emerald-800/50 dark:border-emerald-500/20',
                error: 'bg-red-950/90 dark:bg-red-950/50 text-red-50 border-red-800/50 dark:border-red-500/20',
                warning: 'bg-amber-950/90 dark:bg-amber-950/50 text-amber-50 border-amber-800/50 dark:border-amber-500/20',
                info: 'bg-blue-950/90 dark:bg-blue-950/50 text-blue-50 border-blue-800/50 dark:border-blue-500/20',
                title: 'text-[13px] font-medium leading-snug',
                description: 'text-xs opacity-90',
                actionButton: 'bg-white text-zinc-900 font-medium rounded-full px-3 py-1 text-[11px] transition-colors hover:bg-zinc-200',
                cancelButton: 'bg-zinc-800 text-white font-medium rounded-full px-3 py-1 text-[11px] transition-colors hover:bg-zinc-700',
                icon: 'w-4 h-4 shrink-0',
                content: 'flex-1 min-w-0',
              }
            }}
          />
        </GoogleMapsProvider>
      </QueryProvider>
    </AuthProvider>
  )
}

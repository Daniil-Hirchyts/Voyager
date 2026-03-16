import { AuthProvider } from './AuthProvider';
import { QueryProvider } from './QueryProvider';
import { Toaster } from 'sonner';
import { GoogleMapsProvider } from '@/shared/layouts/google-maps';

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
                toast:
                  'group flex items-center gap-3 px-4 py-3 rounded-full border border-white/10 backdrop-blur-xl transition-all',
                default: 'bg-[#171717]/90 text-white',
                success:
                  'bg-[#00C978]/90 text-white border-[#00C978]/20',
                error:
                  'bg-[#FF510E]/90 text-white border-[#FF510E]/20',
                warning:
                  'bg-[#FFA200]/90 text-white border-[#FFA200]/20',
                info: 'bg-[#00B1FF]/90 text-white border-[#00B1FF]/20',
                title: 'text-[13px] font-medium leading-snug',
                description: 'text-xs opacity-90',
                actionButton:
                  'bg-white text-[var(--color-text)] font-medium rounded-full px-3 py-1 text-[11px] transition-colors hover:bg-[var(--color-accent)]',
                  cancelButton:
                  'bg-[var(--color-primary)] text-white font-medium rounded-full px-3 py-1 text-[11px] transition-colors hover:bg-[#2A2A2A]',                icon: 'w-4 h-4 shrink-0',
                content: 'flex-1 min-w-0',
              },
            }}
          />
        </GoogleMapsProvider>
      </QueryProvider>
    </AuthProvider>
  );
}

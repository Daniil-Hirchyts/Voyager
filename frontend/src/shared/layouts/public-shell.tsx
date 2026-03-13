import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { PUBLIC_CLOUD_PRIMARY_SRC, PUBLIC_CLOUD_SECONDARY_SRC } from '@/shared/lib/public-assets'
import { cn } from '@/shared/lib/cn'
import { VoyagerLogo } from '@/widgets/app-shell/logo'

type PublicSiteShellProps = {
  children: React.ReactNode
  className?: string
  footerNote?: string
}

const cloudAssets = [
  {
    src: PUBLIC_CLOUD_PRIMARY_SRC,
    className: 'top-[8%] right-[-10%] w-[56rem] opacity-48',
  },
  {
    src: PUBLIC_CLOUD_SECONDARY_SRC,
    className: 'top-[38%] left-[-16%] w-[56rem] opacity-38',
  },
]

export function PublicSiteShell({
  children,
  className,
  footerNote = 'Built for the deliberate traveler.',
}: PublicSiteShellProps) {
  const auth = useAuth()
  const ctaHref = auth.isAuthenticated ? '/app/trips' : '/signin'
  const ctaLabel = auth.isAuthenticated ? 'Open Planner' : 'Sign In'

  return (
    <div className={cn('relative min-h-[100dvh] overflow-x-hidden text-[var(--color-text)]', className)}>
      <div className="fixed inset-0 -z-20 bg-[linear-gradient(180deg,#d6e5f3_0%,#e4f0fb_38%,#edf5fc_100%)]" />
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {cloudAssets.map((cloud) => (
          <div key={cloud.className} className={cn('absolute mix-blend-multiply blur-[2px]', cloud.className)}>
            <img
              src={cloud.src}
              alt=""
              className="w-full object-cover"
              style={{
                WebkitMaskImage: 'radial-gradient(ellipse closest-side, black 28%, transparent 100%)',
                maskImage: 'radial-gradient(ellipse closest-side, black 28%, transparent 100%)',
              }}
            />
          </div>
        ))}
      </div>

      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4">
        <nav className="voyager-surface-strong voyager-container flex max-w-6xl items-center justify-between rounded-full px-5 py-3 md:px-6">
          <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-cta)] text-white">
              <VoyagerLogo className="size-4" />
            </span>
            <span className="text-lg">Voyager</span>
          </Link>

          <Link to={ctaHref} className="inline-flex">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2.5 text-sm font-medium text-white shadow-[0_18px_32px_-22px_rgba(26,22,21,0.8)] transition-transform duration-200 hover:scale-[0.98]">
              {ctaLabel}
              <ArrowRight className="size-4" />
            </span>
          </Link>
        </nav>
      </div>

      <main>{children}</main>

      <footer className="relative z-10 px-4 pb-8 pt-6">
        <div className="voyager-container flex flex-col items-center justify-between gap-6 rounded-[28px] border border-white/50 bg-white/34 px-6 py-5 text-sm text-[var(--color-text-muted)] backdrop-blur-xl md:flex-row">
          <div className="flex items-center gap-3 text-[var(--color-text)]">
            <VoyagerLogo className="size-5" />
            <span className="font-medium tracking-tight">Voyager</span>
          </div>
          <p>{footerNote}</p>
        </div>
      </footer>
    </div>
  )
}

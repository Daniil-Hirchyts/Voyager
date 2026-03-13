import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { VoyagerLogo } from '@/widgets/app-shell/logo'

function LegalPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
        <div className="mb-10 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 text-[var(--color-text)]">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-cta)] text-white">
              <VoyagerLogo className="size-[0.85rem] translate-y-[1px]" />
            </span>
            <span className="text-[0.95rem] font-semibold tracking-[-0.03em]">Voyager</span>
          </Link>
          <Link
            to="/app/trips"
            className="flex items-center gap-1.5 text-[0.82rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
        </div>

        <div className="mb-10 border-b border-[var(--color-border-strong)] pb-8">
          <p className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">Legal</p>
          <h1 className="text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.05em] text-[var(--color-text)] md:text-[2.8rem]">
            {title}
          </h1>
        </div>

        <div>{children}</div>

        <div className="mt-16 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-border-strong)] pt-8">
          {[
            { label: 'Privacy Policy', to: '/privacy' },
            { label: 'Terms of Service', to: '/terms' },
            { label: 'Cookie Policy', to: '/cookies' },
            { label: 'Imprint', to: '/imprint' },
          ].map(({ label, to }) => (
            <Link key={label} to={to} className="text-[0.78rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[var(--color-border-strong)] py-4 sm:grid-cols-[10rem_1fr]">
      <p className="text-[0.82rem] font-semibold text-[var(--color-text)]">{label}</p>
      <p className="text-[0.92rem] leading-6 text-[var(--color-text-muted)]">{children}</p>
    </div>
  )
}

export default function ImprintPage() {
  return (
    <LegalPage title="Imprint">
      <p className="mb-8 text-[0.92rem] leading-7 text-[var(--color-text-muted)]">
        Information in accordance with § 5 TMG and applicable EU disclosure requirements.
      </p>

      <div className="rounded-[18px] border border-[var(--color-border-strong)] bg-white/60 px-5">
        <Row label="Company">Voyager Technologies Ltd.</Row>
        <Row label="Address">
          123 Explorer Street<br />
          10115 Berlin, Germany
        </Row>
        <Row label="Register">
          Commercial Register: Amtsgericht Berlin-Charlottenburg<br />
          HRB 000000 B
        </Row>
        <Row label="Managing Director">Your Name</Row>
        <Row label="VAT ID">DE 000 000 000</Row>
        <Row label="Email">
          <span className="font-medium text-[var(--color-text)]">hello@voyager.app</span>
        </Row>
        <Row label="Legal inquiries">
          <span className="font-medium text-[var(--color-text)]">legal@voyager.app</span>
        </Row>
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr]">
          <p className="text-[0.82rem] font-semibold text-[var(--color-text)]">Dispute resolution</p>
          <p className="text-[0.92rem] leading-6 text-[var(--color-text-muted)]">
            The European Commission provides a platform for online dispute resolution (ODR):{' '}
            <span className="font-medium text-[var(--color-text)]">ec.europa.eu/consumers/odr</span>.
            We are not obliged to participate in dispute resolution proceedings before a consumer
            arbitration board.
          </p>
        </div>
      </div>

      <p className="mt-8 text-[0.82rem] leading-6 text-[var(--color-text-muted)]">
        <strong className="font-medium text-[var(--color-text)]">Liability disclaimer:</strong>{' '}
        Despite careful content control we assume no liability for the content of external links.
        The operators of the linked pages are solely responsible for their content.
      </p>
    </LegalPage>
  )
}

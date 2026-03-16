import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { VoyagerLogo } from '@/widgets/app-shell/logo';

function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
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
          <p className="mb-3 text-[0.68rem] font-semibold tracking-[0.22em] text-[#8b97a7] uppercase">
            Legal
          </p>
          <h1 className="text-[2.2rem] leading-[1.05] font-semibold tracking-[-0.05em] text-[var(--color-text)] md:text-[2.8rem]">
            {title}
          </h1>
          <p className="mt-3 text-[0.85rem] text-[var(--color-text-muted)]">
            Last updated: {lastUpdated}
          </p>
        </div>

        <div>{children}</div>

        <div className="mt-16 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-border-strong)] pt-8">
          {[
            { label: 'Privacy Policy', to: '/privacy' },
            { label: 'Terms of Service', to: '/terms' },
            { label: 'Cookie Policy', to: '/cookies' },
            { label: 'Imprint', to: '/imprint' },
          ].map(({ label, to }) => (
            <Link
              key={label}
              to={to}
              className="text-[0.78rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[1.1rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
        {title}
      </h2>
      <div className="space-y-3 text-[0.92rem] leading-7 text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function CookieTable({ rows }: { rows: { name: string; purpose: string; duration: string }[] }) {
  return (
    <div className="my-4 overflow-hidden rounded-[14px] border border-[var(--color-border-strong)] bg-white/60">
      <table className="w-full text-[0.82rem]">
        <thead>
          <tr className="border-b border-[var(--color-border-strong)] bg-white/40">
            <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text)]">Name</th>
            <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text)]">
              Purpose
            </th>
            <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text)]">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.name}
              className={i < rows.length - 1 ? 'border-b border-[var(--color-border-strong)]' : ''}
            >
              <td className="px-4 py-2.5 font-mono text-[0.78rem] text-[var(--color-text)]">
                {row.name}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{row.purpose}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{row.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CookiePolicyPage() {
  return (
    <LegalPage title="Cookie Policy" lastUpdated="March 13, 2026">
      <Section title="1. What are cookies?">
        <p>
          Cookies are small text files stored on your device when you visit a website. They allow
          the site to remember your preferences, keep you signed in, and understand how you interact
          with the service.
        </p>
      </Section>

      <Section title="2. Cookies we use">
        <p>
          <strong className="font-medium text-[var(--color-text)]">Essential cookies</strong> —
          required for the service to function. These cannot be disabled.
        </p>
        <CookieTable
          rows={[
            {
              name: 'vgr_session',
              purpose: 'Maintains your authenticated session',
              duration: 'Session',
            },
            {
              name: 'vgr_csrf',
              purpose: 'Prevents cross-site request forgery',
              duration: 'Session',
            },
          ]}
        />

        <p className="mt-4">
          <strong className="font-medium text-[var(--color-text)]">Preference cookies</strong> —
          remember your settings across visits.
        </p>
        <CookieTable
          rows={[
            {
              name: 'vgr_prefs',
              purpose: 'Stores UI preferences (sidebar state, theme)',
              duration: '1 year',
            },
          ]}
        />

        <p className="mt-4">
          <strong className="font-medium text-[var(--color-text)]">Analytics cookies</strong> — help
          us understand usage patterns. Only set with your consent.
        </p>
        <CookieTable
          rows={[
            {
              name: '_vgr_page',
              purpose: 'Aggregated page view analytics (self-hosted)',
              duration: '6 months',
            },
          ]}
        />
      </Section>

      <Section title="3. Third-party cookies">
        <p>
          If you use the map feature (powered by Google Maps), Google may set their own cookies
          governed by{' '}
          <span className="font-medium text-[var(--color-text)]">Google's Privacy Policy</span>. We
          have no control over these cookies.
        </p>
      </Section>

      <Section title="4. Managing cookies">
        <p>
          You can control cookies through your browser settings. Disabling essential cookies will
          prevent you from signing in or using the app. For analytics cookies, you can opt out at
          any time from your{' '}
          <Link
            to="/app/settings"
            className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
          >
            account settings
          </Link>
          .
        </p>
      </Section>

      <Section title="5. Contact">
        <p>
          Questions about cookies:{' '}
          <span className="font-medium text-[var(--color-text)]">privacy@voyager.app</span>
        </p>
      </Section>
    </LegalPage>
  );
}

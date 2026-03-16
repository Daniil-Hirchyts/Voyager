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
        {/* Nav */}
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

        {/* Header */}
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

        {/* Content */}
        <div className="prose-legal">{children}</div>

        {/* Footer nav */}
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

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="March 13, 2026">
      <Section title="1. Who we are">
        <p>
          Voyager ("we", "us", "our") is an AI-powered travel planning platform. This Privacy Policy
          explains how we collect, use, and protect your personal data when you use our service at
          voyager.app.
        </p>
      </Section>

      <Section title="2. Data we collect">
        <p>We collect the following categories of data:</p>
        <ul className="mt-2 list-inside list-disc space-y-1.5 pl-2">
          <li>
            <strong className="font-medium text-[var(--color-text)]">Account data</strong> — name,
            email address, and profile information provided during sign-in via your identity
            provider.
          </li>
          <li>
            <strong className="font-medium text-[var(--color-text)]">Trip data</strong> —
            destinations, dates, budgets, itineraries, and activities you create within the app.
          </li>
          <li>
            <strong className="font-medium text-[var(--color-text)]">Usage data</strong> — pages
            visited, features used, and interaction events (collected via server-side logs).
          </li>
          <li>
            <strong className="font-medium text-[var(--color-text)]">Technical data</strong> — IP
            address, browser type, device identifiers, and session tokens.
          </li>
        </ul>
      </Section>

      <Section title="3. How we use your data">
        <p>We use your data to:</p>
        <ul className="mt-2 list-inside list-disc space-y-1.5 pl-2">
          <li>Provide, maintain, and improve the Voyager service.</li>
          <li>Generate AI-powered travel itineraries based on your preferences.</li>
          <li>Send account-related notifications (no marketing without consent).</li>
          <li>Detect abuse and ensure security of the platform.</li>
        </ul>
      </Section>

      <Section title="4. Legal basis for processing">
        <p>
          We process your data on the basis of{' '}
          <strong className="font-medium text-[var(--color-text)]">contractual necessity</strong>{' '}
          (to deliver the service you signed up for),
          <strong className="font-medium text-[var(--color-text)]">
            {' '}
            legitimate interests
          </strong>{' '}
          (security, fraud prevention, product improvement), and
          <strong className="font-medium text-[var(--color-text)]"> consent</strong> where required
          (e.g. cookies).
        </p>
      </Section>

      <Section title="5. Data sharing">
        <p>
          We do not sell your personal data. We may share data with trusted sub-processors (cloud
          infrastructure, AI model providers) under strict data processing agreements. We disclose
          data to authorities only when legally required.
        </p>
      </Section>

      <Section title="6. Data retention">
        <p>
          Account and trip data is retained for as long as your account is active. You may delete
          your account at any time, after which personal data is purged within 30 days. Anonymised
          usage analytics may be retained longer for product improvement.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          Under GDPR and applicable laws you have the right to access, correct, export, or delete
          your personal data. To exercise any of these rights, contact us at{' '}
          <span className="font-medium text-[var(--color-text)]">privacy@voyager.app</span>.
        </p>
      </Section>

      <Section title="8. Contact">
        <p>
          For privacy-related questions, reach us at{' '}
          <span className="font-medium text-[var(--color-text)]">privacy@voyager.app</span>.
        </p>
      </Section>
    </LegalPage>
  );
}

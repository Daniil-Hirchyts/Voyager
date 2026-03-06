import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Sparkles, Edit3, Layers, Download } from 'lucide-react'

const steps = [
  {
    number: '01',
    icon: MapPin,
    title: 'Create your trip',
    subtitle: 'Tell Voyager where you\'re going',
    description:
      'Start by entering your destination, travel dates, and trip type. Add a budget, your travel style, and any preferences — dietary needs, pace (relaxed vs packed), interests like food, culture, or adventure. Voyager understands natural language, so describe your trip how you\'d tell a friend.',
    details: [
      'Destination and date range',
      'Trip type: leisure, adventure, cultural, family, etc.',
      'Budget and currency',
      'Travel preferences and pace',
      'Optional notes and special requirements',
    ],
  },
  {
    number: '02',
    icon: Sparkles,
    title: 'Generate an itinerary',
    subtitle: 'AI builds your day-by-day plan',
    description:
      'With one click, Voyager\'s AI generates a complete itinerary for your trip — structured as real, editable days and activities. Each activity includes a title, description, time, estimated duration, tags, and optionally a place. The generation is constraint-aware: it respects your budget, dietary preferences, and pace.',
    details: [
      'Full day-by-day itinerary generation',
      'Each activity is structured data, not text',
      'Constraint-aware: budget, pace, dietary, interests',
      'Re-generate any section independently',
      'Append new days to an existing itinerary',
    ],
  },
  {
    number: '03',
    icon: Edit3,
    title: 'Refine and customize',
    subtitle: 'Your itinerary, your way',
    description:
      'The planner board lets you take full control. Drag activities between days or reorder within a day. Edit any field inline — title, description, time, duration, notes. Add manually created activities alongside AI-generated ones. Every change saves instantly with conflict detection to keep your data safe.',
    details: [
      'Drag & drop between days and within days',
      'Inline editing of all activity fields',
      'Manual activity creation',
      'Conflict-safe saving with version control',
      'Bulk operations: move, copy, delete',
    ],
  },
  {
    number: '04',
    icon: Layers,
    title: 'Add context',
    subtitle: 'Places, offers, and events',
    description:
      'Enrich your itinerary with real-world context. Attach activities to real places and see your day laid out on a beautiful atlas-style map. Browse nearby points of interest. In future phases, Voyager will surface relevant offers and local events that fit your itinerary automatically.',
    details: [
      'Attach activities to real places',
      'Atlas-style map view of your day',
      'Nearby places discovery',
      'Offers and deals (coming in Phase 3)',
      'Local events integration (coming in Phase 3)',
    ],
  },
  {
    number: '05',
    icon: Download,
    title: 'Export and go',
    subtitle: 'Take your plan with you',
    description:
      'When your itinerary is ready, export it in the format that works for you. Generate a beautifully formatted PDF you can print or share. Export as Markdown for note-taking apps. Or use the JSON export to integrate with other tools. Share a read-only link with travel companions so everyone has the plan.',
    details: [
      'PDF export with beautiful formatting',
      'Markdown export for note apps',
      'JSON export for developers',
      'Read-only shareable links',
      'Offline-ready export',
    ],
  },
]

export default function HowItWorksPage() {
  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Navigation */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4"
        style={{
          background: 'rgba(244, 235, 221, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(205, 190, 168, 0.4)',
        }}
      >
        <Link to="/" className="font-display text-2xl text-[#2F6F73] tracking-tight">
          Voyager
        </Link>
        <div className="flex items-center gap-6">
          <Link
            to="/product"
            className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
          >
            Product
          </Link>
          <Link to="/how-it-works" className="text-sm font-medium text-[#1D2430]">
            How It Works
          </Link>
          <Link
            to="/signin"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-16 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs tracking-[0.3em] uppercase text-[#2F6F73] mb-6 font-medium">
            The Process
          </p>
          <h1
            className="font-display leading-tight mb-6"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)', color: '#1D2430' }}
          >
            From blank page to ready itinerary
          </h1>
          <p className="text-lg text-[#526072] leading-relaxed max-w-2xl mx-auto">
            Voyager combines AI generation with a structured planner. Here's exactly how it works,
            step by step.
          </p>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-8 px-6" style={{ background: 'var(--color-bg-deep)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="relative">
            {/* Vertical timeline line */}
            <div
              className="absolute left-8 top-8 bottom-8 w-px hidden md:block"
              style={{ background: 'var(--color-border)' }}
            />

            <div className="space-y-4">
              {steps.map((step, i) => (
                <div key={step.number} className="flex gap-6">
                  {/* Step number + icon */}
                  <div className="hidden md:flex flex-col items-center shrink-0 w-16">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center border-2 z-10 shrink-0"
                      style={{
                        background: i % 2 === 0 ? '#2F6F73' : 'var(--color-surface)',
                        borderColor: i % 2 === 0 ? '#2F6F73' : 'var(--color-border)',
                      }}
                    >
                      <step.icon
                        className="w-6 h-6"
                        style={{ color: i % 2 === 0 ? 'white' : '#2F6F73' }}
                      />
                    </div>
                  </div>

                  {/* Content */}
                  <div
                    className="flex-1 p-7 rounded-[24px] border mb-2"
                    style={{
                      background: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                    }}
                  >
                    <div className="flex items-start gap-4 mb-4">
                      {/* Mobile step number */}
                      <div
                        className="md:hidden w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: '#2F6F73' }}
                      >
                        <step.icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-display text-3xl text-[#2F6F73]">
                            {step.number}
                          </span>
                          <h2 className="text-xl font-semibold text-[#1D2430]">{step.title}</h2>
                        </div>
                        <p className="text-sm text-[#526072] italic">{step.subtitle}</p>
                      </div>
                    </div>

                    <p className="text-[#526072] leading-relaxed mb-5">{step.description}</p>

                    <ul className="space-y-2">
                      {step.details.map((detail) => (
                        <li key={detail} className="flex items-start gap-2 text-sm text-[#526072]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2F6F73] mt-2 shrink-0" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-6" style={{ background: 'var(--color-bg)' }}>
        <div className="max-w-3xl mx-auto">
          <h2
            className="font-display text-center mb-12"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: '#1D2430' }}
          >
            Common questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: 'Do I need an account to use Voyager?',
                a: 'Yes, Voyager requires a sign-in to keep your trips private and synced across devices. Sign in takes under a minute via Keycloak.',
              },
              {
                q: 'Can I edit an AI-generated itinerary?',
                a: "Absolutely — that's the entire point. Every activity is editable. You can drag, reorder, edit fields, delete, or add manual activities alongside generated ones.",
              },
              {
                q: 'What happens if I edit a trip from two devices simultaneously?',
                a: "Voyager uses optimistic concurrency control. If two sessions make conflicting edits, you'll see a clear notification and can refresh to get the latest state — your changes won't be silently overwritten.",
              },
              {
                q: 'Is the itinerary generation free?',
                a: 'Generation is included for all registered users. Usage limits may apply in the future, but early users will have generous allowances.',
              },
              {
                q: 'Can I share my itinerary with travel companions?',
                a: 'Read-only sharing is available via a link. Collaborative editing will come in a future phase.',
              },
            ].map((item) => (
              <div
                key={item.q}
                className="p-5 rounded-[18px] border"
                style={{
                  background: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <h3 className="font-semibold text-[#1D2430] mb-2">{item.q}</h3>
                <p className="text-sm text-[#526072] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="py-32 px-6 text-center"
        style={{ background: 'var(--color-bg-deep)' }}
      >
        <div className="max-w-2xl mx-auto">
          <h2
            className="font-display mb-6"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#1D2430' }}
          >
            Ready to try it yourself?
          </h2>
          <p className="text-[#526072] mb-10 leading-relaxed">
            Create your first trip in minutes. No credit card required.
          </p>
          <Link
            to="/signin"
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-[#2F6F73] text-white font-medium rounded-[10px] hover:bg-[#266063] transition-all hover:shadow-lg hover:shadow-[#2F6F73]/20"
          >
            Start Planning <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-8" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-display text-xl text-[#2F6F73]">Voyager</span>
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              Home
            </Link>
            <Link
              to="/product"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              Product
            </Link>
          </div>
          <p className="text-sm text-[#526072]">AI-powered travel planning</p>
        </div>
      </footer>
    </div>
  )
}

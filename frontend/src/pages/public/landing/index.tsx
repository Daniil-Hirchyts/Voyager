import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { ArrowRight, Compass, Map, Zap } from 'lucide-react'
import { config } from '@/app/config'

export default function LandingPage() {
  const auth = useAuth()
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!config.features.landingMotion) return

    import('gsap').then(({ gsap }) => {
      import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => {
        gsap.registerPlugin(ScrollTrigger)

        const ctx = gsap.context(() => {
          gsap.from('.hero-headline', {
            y: 60,
            opacity: 0,
            duration: 1.2,
            ease: 'power3.out',
            delay: 0.3,
          })
          gsap.from('.hero-sub', {
            y: 30,
            opacity: 0,
            duration: 1,
            ease: 'power3.out',
            delay: 0.6,
          })
          gsap.from('.hero-cta', {
            y: 20,
            opacity: 0,
            duration: 0.8,
            ease: 'power3.out',
            delay: 0.9,
          })

          gsap.from('.feature-card', {
            scrollTrigger: {
              trigger: '.features-section',
              start: 'top 80%',
            },
            y: 40,
            opacity: 0,
            duration: 0.8,
            stagger: 0.15,
            ease: 'power2.out',
          })
        }, heroRef)

        return () => ctx.revert()
      })
    })
  }, [])

  return (
    <div ref={heroRef} style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
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
          <Link
            to="/how-it-works"
            className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
          >
            How It Works
          </Link>
          {auth.isAuthenticated ? (
            <Link
              to="/app/trips"
              className="flex items-center gap-2 px-5 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
            >
              Open Planner <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              to="/signin"
              className="flex items-center gap-2 px-5 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
            >
              Sign In <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        {/* Background gradient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, rgba(47, 111, 115, 0.12) 0%, transparent 60%), radial-gradient(ellipse at 80% 70%, rgba(197, 106, 61, 0.08) 0%, transparent 50%), linear-gradient(180deg, #F4EBDD 0%, #E7D8C3 100%)',
          }}
        />

        {/* Decorative contour lines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 48px, #2F6F73 48px, #2F6F73 49px)`,
          }}
        />

        <div className="relative z-10 text-center px-6 max-w-5xl mx-auto">
          <p className="hero-sub text-xs tracking-[0.3em] uppercase text-[#2F6F73] mb-6 font-medium">
            AI-Powered Travel Planning
          </p>
          <h1
            className="hero-headline font-display leading-[0.95] mb-8"
            style={{ fontSize: 'clamp(3.5rem, 9vw, 7rem)', color: '#1D2430' }}
          >
            Plan Journeys
            <br />
            <span style={{ color: '#2F6F73' }}>Worth Remembering</span>
          </h1>
          <p className="hero-sub text-lg text-[#526072] max-w-xl mx-auto mb-10 leading-relaxed">
            Voyager builds rich, editable itineraries from your preferences — then lets you shape
            every day exactly as you want.
          </p>
          <div className="hero-cta flex items-center gap-4 justify-center">
            <Link
              to="/signin"
              className="inline-flex items-center gap-2.5 px-8 py-4 bg-[#2F6F73] text-white font-medium rounded-[10px] hover:bg-[#266063] transition-all hover:shadow-lg hover:shadow-[#2F6F73]/20"
              style={{ fontSize: '0.95rem' }}
            >
              Start Planning <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 px-6 py-4 text-[#526072] hover:text-[#1D2430] transition-colors text-sm font-medium"
            >
              See how it works
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50">
          <div className="w-px h-12 bg-[#2F6F73] animate-pulse" />
          <p className="text-xs text-[#526072] tracking-[0.2em] uppercase">Scroll</p>
        </div>
      </section>

      {/* Features */}
      <section className="features-section py-24 px-6" style={{ background: 'var(--color-bg-deep)' }}>
        <div className="max-w-5xl mx-auto">
          <h2
            className="font-display text-center mb-16"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#1D2430' }}
          >
            Built for the deliberate traveler
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: 'AI Itinerary Generation',
                desc: 'Describe your trip and let Voyager build a rich, day-by-day itinerary. Replace, merge, or append to any section.',
              },
              {
                icon: Compass,
                title: 'Structured Planner',
                desc: 'Every activity is editable, reorderable, and moveable. Your itinerary is durable data, not a text blob.',
              },
              {
                icon: Map,
                title: 'Places & Geospatial',
                desc: "Explore destinations on an atlas-style map. Attach real places to activities and discover what's nearby.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="feature-card p-6 rounded-[18px] border"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <div className="w-10 h-10 rounded-[10px] bg-[#2F6F73]/10 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-[#2F6F73]" />
                </div>
                <h3 className="font-semibold text-[#1D2430] mb-2">{f.title}</h3>
                <p className="text-sm text-[#526072] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works preview */}
      <section className="py-24 px-6" style={{ background: 'var(--color-bg)' }}>
        <div className="max-w-4xl mx-auto">
          <h2
            className="font-display text-center mb-4"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#1D2430' }}
          >
            From idea to itinerary in minutes
          </h2>
          <p className="text-center text-[#526072] mb-16 max-w-xl mx-auto">
            Three steps to a trip worth taking.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* connector line */}
            <div
              className="hidden md:block absolute top-8 left-1/6 right-1/6 h-px"
              style={{ background: 'var(--color-border)' }}
            />
            {[
              {
                num: '01',
                title: 'Describe your trip',
                desc: 'Enter destination, dates, interests, and any constraints. Voyager understands natural language.',
              },
              {
                num: '02',
                title: 'Generate itinerary',
                desc: 'Our AI builds a complete day-by-day itinerary structured as real, editable data.',
              },
              {
                num: '03',
                title: 'Refine and go',
                desc: 'Drag activities, edit details, add places, and export when ready.',
              },
            ].map((step) => (
              <div key={step.num} className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-2"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <span className="font-display text-2xl text-[#2F6F73]">{step.num}</span>
                </div>
                <h3 className="font-semibold text-[#1D2430] mb-2">{step.title}</h3>
                <p className="text-sm text-[#526072] leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 text-sm text-[#2F6F73] hover:underline font-medium"
            >
              See the full walkthrough <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 text-center" style={{ background: 'var(--color-bg-deep)' }}>
        <div className="max-w-2xl mx-auto">
          <h2
            className="font-display mb-6"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#1D2430' }}
          >
            Your next journey starts here
          </h2>
          <p className="text-[#526072] mb-10 leading-relaxed">
            Sign in to create your first trip and experience what AI-assisted travel planning should
            feel like.
          </p>
          <Link
            to="/signin"
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-[#2F6F73] text-white font-medium rounded-[10px] hover:bg-[#266063] transition-all hover:shadow-lg hover:shadow-[#2F6F73]/20"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-8" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-display text-xl text-[#2F6F73]">Voyager</span>
          <div className="flex items-center gap-6">
            <Link
              to="/product"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              Product
            </Link>
            <Link
              to="/how-it-works"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              How It Works
            </Link>
          </div>
          <p className="text-sm text-[#526072]">AI-powered travel planning</p>
        </div>
      </footer>
    </div>
  )
}

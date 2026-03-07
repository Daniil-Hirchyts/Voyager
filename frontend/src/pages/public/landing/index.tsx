import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { ArrowRight, Compass, Map, Zap } from 'lucide-react'
import { config } from '@/app/config'
import { VoyagerLogo } from '@/widgets/app-shell/logo'

export default function LandingPage() {
  const auth = useAuth()
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!config.features.landingMotion) return

    let ctx: any
    let isCancelled = false

    Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger')
    ]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (isCancelled) return

      gsap.registerPlugin(ScrollTrigger)

      ctx = gsap.context(() => {
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
    })

    return () => {
      isCancelled = true
      if (ctx) ctx.revert()
    }
  }, [])

  return (
    <div ref={heroRef} className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.72),transparent_34%),linear-gradient(180deg,#F3E9D8_0%,#EDE0CE_100%)] text-[#18212B]">
      {/* Navigation */}
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 w-full">
        <nav
          className="flex w-full max-w-5xl items-center justify-between px-6 py-3 rounded-full border border-white/60 bg-white/40 shadow-sm backdrop-blur-xl"
        >
          <Link to="/" className="flex items-center gap-2 font-display text-2xl font-medium text-[#20454A] tracking-tight">
            <VoyagerLogo className="size-6 text-[#214F52]" />
            Voyager
          </Link>
          <div className="flex items-center gap-6">
            <Link
              to="/product"
              className="hidden md:block text-sm font-medium text-[#5D6A7B] hover:text-[#18212B] transition-colors"
            >
              Product
            </Link>
            <Link
              to="/how-it-works"
              className="hidden md:block text-sm font-medium text-[#5D6A7B] hover:text-[#18212B] transition-colors"
            >
              How It Works
            </Link>
            {auth.isAuthenticated ? (
              <Link
                to="/app/trips"
                className="flex items-center gap-2 px-5 py-2 bg-[#214F52] text-white text-sm font-medium rounded-full hover:bg-[#173E43] transition-all hover:shadow-md"
              >
                Open Planner <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <Link
                to="/signin"
                className="flex items-center gap-2 px-5 py-2 bg-[#214F52] text-white text-sm font-medium rounded-full hover:bg-[#173E43] transition-all hover:shadow-md"
              >
                Sign In <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </nav>
      </div>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-28 pb-16 px-4">
        {/* Decorative contour lines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 48px, #214F52 48px, #214F52 49px)`,
          }}
        />

        <div className="relative z-10 w-full max-w-5xl mx-auto rounded-[2.5rem] border border-white/60 bg-white/60 backdrop-blur-2xl shadow-[0_12px_48px_-12px_rgba(33,79,82,0.15)] ring-1 ring-black/5 p-8 md:p-16 lg:p-24 text-center">
          <p className="hero-sub text-xs tracking-[0.3em] uppercase text-[#7A6A58] mb-6 font-semibold">
            AI-Powered Travel Planning
          </p>
          <h1
            className="hero-headline font-display leading-[0.95] mb-8"
            style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', color: '#20454A' }}
          >
            Plan Journeys
            <br />
            <span style={{ color: '#214F52', opacity: 0.8 }}>Worth Remembering</span>
          </h1>
          <p className="hero-sub text-lg text-[#5D6A7B] max-w-xl mx-auto mb-10 leading-relaxed">
            Voyager builds rich, editable itineraries from your preferences — then lets you shape
            every day exactly as you want in a beautiful workspace.
          </p>
          <div className="hero-cta flex flex-wrap items-center gap-4 justify-center">
            <Link
              to="/signin"
              className="inline-flex items-center gap-2.5 px-8 py-4 bg-[#214F52] text-white font-medium rounded-[18px] hover:bg-[#173E43] transition-all hover:-translate-y-0.5 shadow-[0_8px_16px_-6px_rgba(33,79,82,0.4)]"
              style={{ fontSize: '0.95rem' }}
            >
              Start Planning <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 px-6 py-4 text-[#5D6A7B] hover:text-[#18212B] hover:bg-white/50 rounded-[18px] transition-all text-sm font-medium"
            >
              See how it works
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-60">
          <div className="w-px h-12 bg-[#7A6A58] animate-pulse" />
          <p className="text-[0.65rem] text-[#7A6A58] tracking-[0.25em] uppercase font-semibold">Scroll</p>
        </div>
      </section>

      {/* Features */}
      <section className="features-section py-24 px-4 relative">
        <div className="max-w-5xl mx-auto">
          <h2
            className="font-display text-center mb-16"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#20454A' }}
          >
            Built for the deliberate traveler
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
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
                className="feature-card p-8 rounded-[2rem] border border-white/60 bg-white/50 backdrop-blur-xl shadow-sm hover:shadow-md transition-all hover:-translate-y-1"
              >
                <div className="w-12 h-12 rounded-[14px] bg-[#214F52]/10 flex items-center justify-center mb-6 border border-[#214F52]/20 shadow-inner">
                  <f.icon className="w-6 h-6 text-[#214F52]" />
                </div>
                <h3 className="font-semibold text-[#18212B] mb-3 text-lg">{f.title}</h3>
                <p className="text-sm text-[#5D6A7B] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works preview */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto rounded-[2.5rem] border border-white/60 bg-white/40 backdrop-blur-xl shadow-sm p-10 md:p-16">
          <h2
            className="font-display text-center mb-4"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#20454A' }}
          >
            From idea to itinerary in minutes
          </h2>
          <p className="text-center text-[#5D6A7B] mb-16 max-w-xl mx-auto">
            Three steps to a beautiful trip worth taking.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 relative">
            {/* connector line */}
            <div
              className="hidden md:block absolute top-[2.25rem] left-[16.6%] right-[16.6%] h-px border-t border-dashed border-[#214F52]/20"
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
                desc: 'Our AI builds a complete day-by-day itinerary structured as real, editable block data in a premium workspace.',
              },
              {
                num: '03',
                title: 'Refine and go',
                desc: 'Drag activities, edit full details, attach places, and export as a PDF when you are ready.',
              },
            ].map((step) => (
              <div key={step.num} className="text-center relative z-10">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 bg-white shadow-sm border border-white/80 ring-4 ring-[#F3E9D8]/50 text-[#214F52]"
                >
                  <span className="font-display text-2xl font-semibold tracking-tight">{step.num}</span>
                </div>
                <h3 className="font-semibold text-[#18212B] mb-2 text-lg">{step.title}</h3>
                <p className="text-sm text-[#5D6A7B] leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-16 pt-8 border-t border-[#D7CCBC]/50">
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 text-sm text-[#214F52] hover:text-[#173E43] font-medium py-2 px-4 rounded-full hover:bg-white/50 transition-colors"
            >
              See the full walkthrough <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-4 text-center">
        <div className="max-w-2xl mx-auto">
          <h2
            className="font-display mb-6"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', color: '#20454A' }}
          >
            Your next journey starts here
          </h2>
          <p className="text-[#5D6A7B] mb-10 leading-relaxed text-lg">
            Sign in to create your first trip and experience what AI-assisted travel planning should
            feel like.
          </p>
          <Link
            to="/signin"
            className="inline-flex items-center gap-2.5 px-10 py-5 bg-[#214F52] text-white font-medium rounded-[18px] hover:bg-[#173E43] transition-all hover:scale-[1.02] shadow-[0_8px_16px_-6px_rgba(33,79,82,0.4)]"
          >
            Get Started <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#D7CCBC]/70 py-10 px-6 backdrop-blur-lg bg-white/20">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
             <VoyagerLogo className="size-5 text-[#214F52]" />
             <span className="font-display text-xl font-medium text-[#20454A] tracking-tight">Voyager</span>
          </div>
          
          <div className="flex items-center gap-8">
            <Link
              to="/product"
              className="text-sm font-medium text-[#7A6A58] hover:text-[#18212B] transition-colors"
            >
              Product
            </Link>
            <Link
              to="/how-it-works"
              className="text-sm font-medium text-[#7A6A58] hover:text-[#18212B] transition-colors"
            >
              How It Works
            </Link>
          </div>
          <p className="text-[0.8rem] text-[#7A6A58] uppercase tracking-widest font-semibold">AI-powered travel planning</p>
        </div>
      </footer>
    </div>
  )
}

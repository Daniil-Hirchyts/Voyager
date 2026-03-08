import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { ArrowRight, Zap, LayoutGrid, Map, Compass, FileText, RefreshCw } from 'lucide-react'
import { PUBLIC_CLOUD_PRIMARY_SRC, PUBLIC_CLOUD_SECONDARY_SRC } from '@/shared/lib/public-assets'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const features = [
  {
    icon: Zap,
    title: 'AI Itinerary Generation',
    subtitle: 'From brief to full itinerary in seconds',
    body: 'Describe your trip in natural language. Voyager\'s engine produces a structured, day-by-day itinerary with real activities, estimated durations, and logical sequencing. Regenerate sections or refine with plain-language instructions.',
  },
  {
    icon: LayoutGrid,
    title: 'Structured Planner Board',
    subtitle: 'Your itinerary as durable, editable data',
    body: 'Unlike text-based travel planners, Voyager represents every activity as a structured record. Drag activities between days, reorder, or edit inline. The planner board is optimistic by default.',
  },
  {
    icon: Map,
    title: 'Geospatial & Places',
    subtitle: 'An atlas for your itinerary',
    body: 'Pin any activity to a real place. Browse the map to find what\'s nearby, attach places to activities, and see your full day laid out on an atlas-inspired map.',
  },
  {
    icon: FileText,
    title: 'Export & Share',
    subtitle: 'Take your plan anywhere',
    body: 'Export your itinerary as a structured PDF, Markdown, or JSON. Share a read-only link with travel companions. The export preserves all structure.',
  },
  {
    icon: RefreshCw,
    title: 'Concurrent-Safe Editing',
    subtitle: 'No accidental overwrites',
    body: 'Voyager uses optimistic concurrency control. If two sessions edit the same resource simultaneously, Voyager detects the conflict and lets you merge gracefully.',
  },
  {
    icon: Compass,
    title: 'Multi-Trip Dashboard',
    subtitle: 'All your journeys in one place',
    body: 'A bird\'s-eye view of all your travel plans. Filter by type, destination, or date. Duplicate a previous trip as a template for a new one.',
  },
]

export default function ProductPage() {
  const auth = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    let ctx = gsap.context(() => {
      // Gentle infinite float for clouds
      gsap.utils.toArray('.parallax-cloud').forEach((cloud: any, i) => {
        gsap.to(cloud, {
          y: () => (i % 2 === 0 ? -30 : 30),
          x: () => (i % 3 === 0 ? 20 : -20),
          duration: 20 + i * 5,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut'
        })
        gsap.to(cloud, {
          yPercent: i % 2 === 0 ? 40 : -30,
          ease: 'none',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1,
          },
        })
      })

      gsap.from('.stagger-fade', {
        y: 30,
        opacity: 0,
        duration: 1,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: '.stagger-fade',
          start: 'top 85%',
        }
      })
    }, containerRef)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={containerRef} className="min-h-screen text-[#1A1615] overflow-x-hidden relative selection:bg-[#72AEE6] selection:text-white font-sans">
      {/* Background & Clouds */}
      <div className="fixed inset-0 -z-20 w-full h-full bg-[#E4F0FB]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B6D6F2]/40 via-[#E4F0FB] to-[#F1F7FD] opacity-90" />
      </div>
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="parallax-cloud absolute top-[10%] -right-[10%] w-[600px] opacity-40 mix-blend-multiply">
          <img src={PUBLIC_CLOUD_PRIMARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 70%)' }} alt="cloud" />
        </div>
        <div className="parallax-cloud absolute top-[40%] -left-[10%] w-[700px] opacity-30 mix-blend-multiply">
           <img src={PUBLIC_CLOUD_SECONDARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(ellipse, black 40%, transparent 70%)' }} alt="cloud" />
        </div>
      </div>

      {/* Nav */}
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 w-full">
        <nav className="flex w-full max-w-5xl items-center justify-between px-6 py-3 rounded-full bg-white/50 backdrop-blur-2xl border border-white/60 shadow-sm">
          <Link to="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[#1A1615]">
            <VoyagerLogo className="size-5 text-[#1A1615]" />
            Voyager
          </Link>
          <div className="flex items-center gap-8">
            <Link to="/product" className="hidden md:block text-sm font-semibold text-[#1A1615]">Product</Link>
            <Link to="/how-it-works" className="hidden md:block text-sm font-medium text-[#453F3D] hover:text-[#1A1615] transition-colors">How It Works</Link>
            {auth.isAuthenticated ? (
              <Link to="/app/trips" className="flex items-center gap-2 px-5 py-2 bg-[#1A1615] text-white text-sm font-medium rounded-full hover:bg-black transition-colors">
                Open Planner <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <Link to="/signin" className="flex items-center gap-2 px-5 py-2 bg-[#1A1615] text-white text-sm font-medium rounded-full hover:bg-black transition-colors">
                Sign In <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </nav>
      </div>

      <main className="max-w-4xl mx-auto px-6 pt-48 pb-24">
        {/* Header */}
        <header className="mb-24 stagger-fade">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6 text-[#1A1615]">
            Product Capabilities
          </h1>
          <p className="text-lg md:text-xl text-[#453F3D] leading-relaxed max-w-2xl">
            Voyager is a structured workspace for travel. We prioritize editable data over static text, giving you absolute control over every detail of your journey.
          </p>
        </header>

        {/* Minimal Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16 mb-32">
          {features.map((feat) => (
            <div key={feat.title} className="stagger-fade group">
              <div className="w-10 h-10 rounded-xl bg-white/60 border border-white/80 shadow-sm flex items-center justify-center mb-5">
                <feat.icon className="w-5 h-5 text-[#1A1615]" strokeWidth={1.5} />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-[#1A1615] tracking-tight">{feat.title}</h3>
              <p className="text-[#453F3D] leading-relaxed text-[0.95rem]">{feat.body}</p>
            </div>
          ))}
        </section>

        {/* Simple CTA */}
        <section className="stagger-fade text-center py-16 bg-white/30 backdrop-blur-xl rounded-3xl border border-white/50 mt-16">
          <h2 className="text-2xl font-semibold mb-4 tracking-tight">Ready to plan?</h2>
          <p className="text-[#453F3D] mb-8">Create your first trip in seconds.</p>
          <Link to="/signin" className="inline-flex items-center gap-2 px-6 py-3 bg-[#1A1615] text-white font-medium rounded-full hover:bg-black transition-colors">
            Start Planning <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-white/40">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 opacity-80">
             <VoyagerLogo className="size-5 text-[#1A1615]" />
             <span className="text-lg font-semibold tracking-tight text-[#1A1615]">Voyager</span>
          </div>
          <p className="text-sm text-[#453F3D]">© 2026 Voyager.</p>
        </div>
      </footer>
    </div>
  )
}

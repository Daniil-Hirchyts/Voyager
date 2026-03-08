import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { ArrowRight, MessageSquareText, Blocks, SlidersHorizontal, MapPinned, FileDown } from 'lucide-react'
import { PUBLIC_CLOUD_PRIMARY_SRC, PUBLIC_CLOUD_SECONDARY_SRC } from '@/shared/lib/public-assets'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const steps = [
  {
    number: '01',
    icon: MessageSquareText,
    title: 'Describe Context',
    description: 'Enter destination, dates, and interests. Add a budget, your travel style, and dietary needs. Voyager understands natural language constraints.',
  },
  {
    number: '02',
    icon: Blocks,
    title: 'Generate Itinerary',
    description: 'Our AI builds a complete day-by-day itinerary structured as real, editable block data. The generation respects your pace and preferences.',
  },
  {
    number: '03',
    icon: SlidersHorizontal,
    title: 'Refine & Customize',
    description: 'Drag activities, edit full details, or append new days. Every change saves instantly with conflict detection to keep your data safe.',
  },
  {
    number: '04',
    icon: MapPinned,
    title: 'Geospatial Context',
    description: 'Attach activities to real places and see your day laid out on an atlas-style map. Browse nearby points of interest seamlessly.',
  },
  {
    number: '05',
    icon: FileDown,
    title: 'Export & Travel',
    description: 'Export a beautifully formatted PDF, Markdown, or JSON. Share a read-only link with travel companions so everyone has the plan.',
  },
]

export default function HowItWorksPage() {
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
      })

      gsap.from('.stagger-item', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: '.stagger-container',
          start: 'top 80%',
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
        <div className="parallax-cloud absolute top-[20%] -right-[5%] w-[800px] opacity-40 mix-blend-multiply">
          <img src={PUBLIC_CLOUD_PRIMARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 70%)' }} alt="cloud" />
        </div>
        <div className="parallax-cloud absolute top-[60%] -left-[10%] w-[900px] opacity-30 mix-blend-multiply">
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
            <Link to="/product" className="hidden md:block text-sm font-medium text-[#453F3D] hover:text-[#1A1615] transition-colors">Product</Link>
            <Link to="/how-it-works" className="hidden md:block text-sm font-semibold text-[#1A1615]">How It Works</Link>
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

      <main className="max-w-4xl mx-auto px-6 pt-48 pb-24 stagger-container">
        {/* Header */}
        <header className="mb-20 stagger-item text-center">
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tighter mb-6 text-[#1A1615] drop-shadow-sm">
            How it works
          </h1>
          <p className="text-lg md:text-xl text-[#453F3D] leading-relaxed max-w-2xl mx-auto">
            From a blank page to a fully realized, editable itinerary.
          </p>
        </header>

        {/* Modern Timeline list */}
        <section className="space-y-6 mb-32">
          {steps.map((step, i) => (
            <div key={step.number} className="stagger-item group relative">
              {/* Connector line (skip on last) */}
              {i !== steps.length - 1 && (
                 <div className="absolute left-[38px] top-[72px] bottom-[-24px] w-[2px] bg-white/40 group-hover:bg-[#1A1615]/10 transition-colors" />
              )}
              
              <div className="flex gap-6 md:gap-8 p-6 md:p-8 rounded-[2rem] bg-white/40 backdrop-blur-xl border border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_20px_-10px_rgba(0,0,0,0.05)] hover:bg-white/60 transition-colors duration-300 relative z-10">
                
                {/* Visual Node */}
                <div className="flex flex-col items-center shrink-0 w-14">
                  <div className="w-14 h-14 rounded-2xl bg-white border border-white/80 shadow-sm flex items-center justify-center relative z-10 transform group-hover:scale-110 transition-transform duration-300">
                    <step.icon className="w-6 h-6 text-[#1A1615]" strokeWidth={1.5} />
                  </div>
                </div>

                {/* Content */}
                <div className="pt-1">
                  <div className="flex items-center gap-3 mb-2">
                     <span className="text-sm font-semibold tracking-widest text-[#1A1615]/40 tabular-nums">STEP {step.number}</span>
                  </div>
                  <h3 className="text-2xl font-semibold mb-3 text-[#1A1615] tracking-tight">{step.title}</h3>
                  <p className="text-[#453F3D] leading-relaxed text-[1.05rem]">
                    {step.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Accordion FAQ */}
        <section className="stagger-item mb-32">
          <h2 className="text-3xl font-semibold tracking-tight mb-10 text-center">Common Questions</h2>
          <div className="max-w-2xl mx-auto bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_20px_-10px_rgba(0,0,0,0.05)]">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1" className="border-b-white/40 py-2">
                <AccordionTrigger className="text-lg font-medium text-[#1A1615] hover:no-underline hover:text-black">Can I edit an AI-generated itinerary?</AccordionTrigger>
                <AccordionContent className="text-[#453F3D] leading-relaxed text-base pt-2 pb-4">
                  Yes, every single activity is editable. You can drag, reorder, edit fields, delete, or add manual activities alongside generated ones. You are never locked into the AI's output.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2" className="border-b-white/40 py-2">
                <AccordionTrigger className="text-lg font-medium text-[#1A1615] hover:no-underline hover:text-black">What happens if I edit a trip from two devices?</AccordionTrigger>
                <AccordionContent className="text-[#453F3D] leading-relaxed text-base pt-2 pb-4">
                  Voyager uses optimistic concurrency control. You'll see a clear notification if there's a conflict between devices, preventing silent overwrites and data loss.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3" className="border-none py-2">
                <AccordionTrigger className="text-lg font-medium text-[#1A1615] hover:no-underline hover:text-black">Can I share my itinerary with travel companions?</AccordionTrigger>
                <AccordionContent className="text-[#453F3D] leading-relaxed text-base pt-2 pb-4">
                  Yes. You can generate a read-only share link that anyone can view, or export the entire trip to a cleanly formatted PDF or Markdown document.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* Simple CTA */}
        <section className="stagger-item text-center">
          <Link to="/signin" className="inline-flex items-center gap-2 px-8 py-4 bg-[#1A1615] text-white font-medium rounded-full hover:bg-black transition-colors shadow-lg">
            Start Planning <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-white/40 mt-12">
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

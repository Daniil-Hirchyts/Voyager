import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { ArrowRight, Compass, Map, Zap, Calendar, Sparkles } from 'lucide-react'
import {
  PUBLIC_CLOUD_COMPACT_SRC,
  PUBLIC_CLOUD_PRIMARY_SRC,
  PUBLIC_CLOUD_SECONDARY_SRC,
  PUBLIC_CLOUD_TERTIARY_SRC,
} from '@/shared/lib/public-assets'
import { MarketingImagePlaceholder } from '@/shared/layouts/marketing-image-placeholder'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export default function LandingPage() {
  const auth = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!document.getElementById('premium-font')) {
      const link = document.createElement('link')
      link.id = 'premium-font'
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap'
      document.head.appendChild(link)
    }

    gsap.registerPlugin(ScrollTrigger)
    
    let ctx = gsap.context(() => {
      // 1. Clouds Parallax & Floating
      gsap.utils.toArray('.parallax-cloud').forEach((cloud: any, i) => {
        // Continuous organic floating
        gsap.to(cloud, {
          y: () => (i % 2 === 0 ? -40 : 40),
          x: () => (i % 3 === 0 ? 30 : -30),
          rotation: () => (i % 2 === 0 ? 3 : -3),
          duration: 20 + i * 5,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut'
        })

        // Scroll Parallax (Clouds move up/down dynamically as you scroll)
        gsap.to(cloud, {
          yPercent: i % 2 === 0 ? 60 : -40,
          ease: 'none',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1,
          },
        })
      })

      // 2. Hero Text Reveal
      gsap.from('.hero-word', {
        y: 80,
        opacity: 0,
        rotation: 2,
        duration: 1.4,
        stagger: 0.1,
        ease: 'power3.out',
        delay: 0.2,
      })

      gsap.from('.hero-fade-in', {
        y: 30,
        opacity: 0,
        duration: 1.5,
        ease: 'power3.out',
        delay: 0.6,
      })

      // 3. Dashboard Image Zoom Parallax
      gsap.fromTo(
        '.dashboard-mockup',
        { scale: 0.92, opacity: 0, y: 80 },
        {
          scale: 1,
          opacity: 1,
          y: 0,
          duration: 1.5,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: '.dashboard-trigger',
            start: 'top 95%',
            end: 'top 40%',
            scrub: 2,
          },
        }
      )

      // 4. Section Fade ins (Faster)
      gsap.utils.toArray('.fade-section').forEach((section: any) => {
        gsap.from(section, {
          opacity: 0,
          y: 40,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: section,
            start: 'top 85%',
            toggleActions: "play none none reverse"
          }
        })
      })

      // 5. Smooth Asymmetric Bento Scroll Reveal
      const bentoCards = gsap.utils.toArray('.bento-card')
      bentoCards.forEach((card: any, i) => {
        gsap.from(card, {
          y: 40,
          opacity: 0,
          duration: 0.7,
          delay: i * 0.1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: '.bento-trigger-container',
            start: 'top 75%',
            toggleActions: "play none none none"
          },
        })
      })

    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <div 
      ref={containerRef} 
      className="min-h-screen text-[#1A1615] overflow-x-hidden relative selection:bg-[#72AEE6] selection:text-white"
      style={{ fontFamily: '"Outfit", sans-serif' }}
    >
      <div className="fixed inset-0 -z-20 w-full h-full bg-[#E4F0FB]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B6D6F2]/40 via-[#E4F0FB] to-[#F1F7FD] opacity-90" />
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,transparent_70%)] blur-[80px]" />
        <div className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-[#9CC1E7] blur-[150px] opacity-40 mix-blend-multiply" />
        <div className="absolute bottom-[-10%] left-[20%] w-[70vw] h-[70vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,1)_0%,transparent_60%)] blur-[100px]" />
        <div className="absolute top-[60%] right-[10%] w-[45vw] h-[45vw] rounded-full bg-[#72AEE6] blur-[160px] opacity-30 mix-blend-multiply" />
      </div>

      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="parallax-cloud absolute top-[4%] -right-[9%] w-[760px] md:w-[1120px] opacity-58 mix-blend-multiply">
          <img src={PUBLIC_CLOUD_PRIMARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)', maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)' }} alt="cloud" />
        </div>
        <div className="parallax-cloud absolute top-[17%] -left-[18%] w-[860px] md:w-[1280px] opacity-48 mix-blend-multiply">
           <img src={PUBLIC_CLOUD_SECONDARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(ellipse closest-side, black 20%, transparent 100%)', maskImage: 'radial-gradient(ellipse closest-side, black 20%, transparent 100%)' }} alt="cloud" />
        </div>
        <div className="parallax-cloud absolute top-[35%] right-[6%] w-[440px] md:w-[680px] opacity-64 mix-blend-multiply">
          <img src={PUBLIC_CLOUD_COMPACT_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)', maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)' }} alt="cloud" />
        </div>
        <div className="parallax-cloud absolute top-[56%] -left-[10%] w-[680px] md:w-[1040px] opacity-46 mix-blend-multiply">
          <img src={PUBLIC_CLOUD_TERTIARY_SRC} className="w-full h-full object-cover" style={{ WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)', maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)' }} alt="cloud" />
        </div>
      </div>

      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 w-full">
        <nav className="flex w-full max-w-5xl items-center justify-between px-6 py-3 rounded-full bg-white/50 backdrop-blur-2xl border border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_10px_30px_-10px_rgba(0,0,0,0.08)] transition-all">
          <Link to="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[#1A1615]">
            <VoyagerLogo className="size-6 text-[#1A1615]" />
            Voyager
          </Link>
          <div className="flex items-center gap-8">
            {auth.isAuthenticated ? (
              <Link to="/app/trips" className="flex items-center gap-2 px-6 py-2.5 bg-[#1A1615] text-white text-sm font-medium rounded-full hover:scale-95 transition-transform duration-300 shadow-[0_8px_16px_rgba(26,22,21,0.2)]">
                Open Planner <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <Link to="/signin" className="flex items-center gap-2 px-6 py-2.5 bg-[#1A1615] text-white text-sm font-medium rounded-full hover:scale-95 transition-transform duration-300 shadow-[0_8px_16px_rgba(26,22,21,0.2)]">
                Sign In <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </nav>
      </div>

      <section className="hero-section relative z-10 min-h-[100dvh] flex flex-col items-center justify-start pt-[20vh] px-4">
        <div className="max-w-6xl w-full text-center flex flex-col items-center">
          <div className="hero-fade-in inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-xl border border-white/80 text-[#1A1615] text-xs font-bold uppercase tracking-[0.2em] mb-8 shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
            <Sparkles className="w-4 h-4" />
            <span>Intelligent Travel</span>
          </div>

          <h1 className="leading-[1.1] tracking-tighter mb-8 font-semibold text-[#1A1615]" style={{ fontSize: 'clamp(4rem, 10vw, 8rem)' }}>
            <div className="overflow-hidden pb-4 -mb-4">
              <div className="hero-word inline-block">Plan</div>{' '}
              <div className="hero-word inline-block">Journeys</div>
            </div>
            <div className="overflow-hidden pb-4 -mb-4 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.1)] [text-shadow:_0_1px_3px_rgb(0_0_0_/_15%)]">
              <div className="hero-word inline-block">Worth</div>{' '}
              <div className="hero-word inline-block">Remembering.</div>
            </div>
          </h1>

          <p className="hero-fade-in text-xl md:text-2xl text-[#1A1615]/80 max-w-2xl font-medium leading-relaxed mb-12 drop-shadow-sm">
            Voyager builds rich, editable itineraries from your destination and trip details, then lets you shape every day exactly as you want in a beautiful workspace.
          </p>

          <div className="hero-fade-in flex flex-wrap items-center gap-4">
            <Link to="/signin" className="inline-flex items-center gap-2.5 px-10 py-5 bg-[#1A1615] text-white font-medium rounded-[2rem] hover:scale-95 transition-transform duration-300 shadow-[0_20px_40px_-15px_rgba(26,22,21,0.5)] text-lg">
              Start Planning <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div className="dashboard-trigger w-full max-w-6xl mx-auto mt-24 relative z-20">
          <div className="dashboard-mockup rounded-[2.5rem] border border-white/80 bg-white/40 backdrop-blur-3xl shadow-[inset_0_1px_0_rgba(255,255,255,1),0_40px_80px_-20px_rgba(0,0,0,0.1)] p-3 md:p-5">
            <MarketingImagePlaceholder label="Image placeholder" className="aspect-[36/25] w-full rounded-[1.5rem]" />
          </div>
        </div>
      </section>

      <section className="fade-section bento-trigger-container relative z-10 py-32 px-4 mt-10">
        <div className="max-w-7xl mx-auto">
          <div className="mb-20 md:w-1/2">
            <h2 className="text-4xl md:text-6xl tracking-tighter font-semibold leading-[1.1] mb-6 pb-2">
              Built for the <br/><span className="text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.1)] [text-shadow:_0_1px_3px_rgb(0_0_0_/_15%)]">deliberate traveler</span>
            </h2>
            <p className="text-xl text-[#1A1615]/80 max-w-md leading-relaxed font-medium">
              Smart tools that adapt to your travel style, built into a premium, frictionless workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-10">
            <div className="md:col-span-7 flex flex-col gap-8 lg:gap-10">
              <div className="bento-card relative rounded-[3rem] bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_20px_50px_-15px_rgba(0,0,0,0.05)] overflow-hidden min-h-[500px] p-12 md:p-16 group transition-all duration-500 hover:bg-white/70">
              <div className="relative z-10">
                  <div className="w-16 h-16 rounded-3xl bg-white border border-white/80 shadow-[0_8px_16px_-6px_rgba(0,0,0,0.05)] flex items-center justify-center mb-8 transform group-hover:scale-110 transition-transform duration-500">
                    <Zap className="w-7 h-7 text-[#1A1615]" />
                  </div>
                  <h3 className="text-3xl md:text-4xl font-semibold mb-4 tracking-tight leading-[1.1] pb-1">AI Itinerary Generation</h3>
                  <p className="text-[#453F3D] text-lg max-w-md leading-relaxed font-medium">
                    Describe your trip and let Voyager build a rich, day-by-day itinerary. Replace, merge, or append to any section in seconds.
                  </p>
                </div>
                <div className="absolute bottom-[-15%] right-[-10%] w-[75%] drop-shadow-2xl group-hover:-translate-y-6 group-hover:-translate-x-6 transition-transform duration-700 ease-out">
                  <MarketingImagePlaceholder label="Image placeholder" className="aspect-[1016/1230] w-full rounded-[2rem]" />
                </div>
              </div>

              <div className="bento-card relative rounded-[3rem] bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_20px_50px_-15px_rgba(0,0,0,0.05)] overflow-hidden p-12 md:p-16 group transition-all duration-500 hover:bg-white/70">
                <div className="w-16 h-16 rounded-3xl bg-white border border-white/80 shadow-[0_8px_16px_-6px_rgba(0,0,0,0.05)] flex items-center justify-center mb-8 transform group-hover:scale-110 transition-transform duration-500">
                  <Calendar className="w-7 h-7 text-[#1A1615]" />
                </div>
                <h3 className="text-3xl md:text-4xl font-semibold mb-4 tracking-tight leading-[1.1] pb-1">Day-by-Day Flow</h3>
                <p className="text-[#453F3D] text-lg leading-relaxed max-w-md font-medium">
                  Visual timelines that make sense. Understand your pace, easily spot gaps, and manage overbooked days effortlessly.
                </p>
              </div>
            </div>

            <div className="md:col-span-5 flex flex-col gap-8 lg:gap-10 md:mt-32">
              <div className="bento-card relative rounded-[3rem] bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_20px_50px_-15px_rgba(0,0,0,0.05)] overflow-hidden min-h-[600px] p-12 md:p-16 group flex flex-col transition-all duration-500 hover:bg-white/70">
                <div className="relative z-10 mb-10">
                  <div className="w-16 h-16 rounded-3xl bg-white border border-white/80 shadow-[0_8px_16px_-6px_rgba(0,0,0,0.05)] flex items-center justify-center mb-8 transform group-hover:scale-110 transition-transform duration-500">
                    <Map className="w-7 h-7 text-[#1A1615]" />
                  </div>
                  <h3 className="text-3xl md:text-4xl font-semibold mb-4 tracking-tight leading-[1.1] pb-1">Places & Geospatial</h3>
                  <p className="text-[#453F3D] text-lg leading-relaxed font-medium">
                    Explore destinations on an atlas-style map. Attach real places to activities and discover what's nearby seamlessly.
                  </p>
                </div>
                <div className="relative flex-grow w-full mt-auto">
                  <div className="absolute top-4 right-[-20%] w-[140%] group-hover:scale-105 group-hover:-translate-y-4 transition-transform duration-700 ease-out origin-top-left">
                    <MarketingImagePlaceholder label="Image placeholder" className="aspect-[1016/1228] w-full rounded-[2rem]" />
                  </div>
                </div>
              </div>

              <div className="bento-card relative rounded-[3rem] bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_20px_50px_-15px_rgba(0,0,0,0.05)] p-12 md:p-16 group transition-all duration-500 hover:bg-white/70">
                <div className="w-16 h-16 rounded-3xl bg-white border border-white/80 shadow-[0_8px_16px_-6px_rgba(0,0,0,0.05)] flex items-center justify-center mb-8 transform group-hover:scale-110 transition-transform duration-500">
                  <Compass className="w-7 h-7 text-[#1A1615]" />
                </div>
                <h3 className="text-3xl md:text-4xl font-semibold mb-3 tracking-tight leading-[1.1] pb-1">Structured Data</h3>
                <p className="text-[#453F3D] text-lg leading-relaxed font-medium">
                  Every activity is editable, reorderable, and moveable. Your itinerary is durable data, not a text blob.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="fade-section relative z-10 py-48 px-4 flex justify-center">
        <div className="relative w-full max-w-6xl rounded-[4rem] overflow-hidden bg-white/60 backdrop-blur-3xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_40px_80px_-20px_rgba(0,0,0,0.1)] p-16 md:p-32 text-center text-[#1A1615]">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-white/80 blur-[100px] rounded-full mix-blend-screen pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center">
            <h2 className="tracking-tighter font-semibold mb-8 leading-[1.1] pb-2" style={{ fontSize: 'clamp(3.5rem, 7vw, 6rem)' }}>
              Your next journey <br/> starts here.
            </h2>
            <p className="text-[#453F3D] mb-14 text-xl md:text-2xl max-w-2xl font-medium leading-relaxed">
              Sign in to create your first trip and experience what premium AI-assisted travel planning should feel like.
            </p>
            <Link to="/signin" className="inline-flex items-center gap-3 px-12 py-6 bg-[#1A1615] text-white font-semibold rounded-[2.5rem] hover:scale-95 transition-transform duration-300 shadow-[0_20px_40px_-15px_rgba(26,22,21,0.5)] text-xl">
              Get Started Now <ArrowRight className="w-6 h-6" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 py-16 px-8 mt-20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity">
             <VoyagerLogo className="size-8 text-[#1A1615]" />
             <span className="text-3xl font-semibold tracking-tight text-[#1A1615]">Voyager</span>
          </div>
          
          <p className="text-base text-[#453F3D] font-medium">
            © 2026 Voyager. Built for the deliberate traveler.
          </p>
        </div>
      </footer>
    </div>
  )
}

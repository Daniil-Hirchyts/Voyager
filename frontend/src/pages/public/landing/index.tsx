import { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { ArrowRight, Compass, Map, Zap, Calendar, Sparkles } from 'lucide-react';
import {
  PUBLIC_CLOUD_COMPACT_SRC,
  PUBLIC_CLOUD_PRIMARY_SRC,
  PUBLIC_CLOUD_SECONDARY_SRC,
  PUBLIC_CLOUD_TERTIARY_SRC,
} from '@/shared/lib/public-assets';
import { VoyagerLogo } from '@/widgets/app-shell/logo';
import { useAuthStore } from '@/shared/stores/auth.store';
import { startKeycloakSignIn } from '@/app/auth/signin';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function LandingPage() {
  const auth = useAuth();
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleSignIn = () => {
    void startKeycloakSignIn({
      auth,
      intendedPath: '/app/trips',
      setIntendedPath,
    });
  };

  useEffect(() => {
    if (!document.getElementById('premium-font')) {
      const link = document.createElement('link');
      link.id = 'premium-font';
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      // 1. Clouds Parallax & Floating
      gsap.utils.toArray<HTMLElement>('.parallax-cloud').forEach((cloud, i) => {
        gsap.to(cloud, {
          y: () => (i % 2 === 0 ? -40 : 40),
          x: () => (i % 3 === 0 ? 30 : -30),
          rotation: () => (i % 2 === 0 ? 3 : -3),
          duration: 20 + i * 5,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        });

        gsap.to(cloud, {
          yPercent: i % 2 === 0 ? 60 : -40,
          ease: 'none',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1,
          },
        });
      });

      // 2. Hero Text Reveal
      gsap.from('.hero-word', {
        y: 80,
        opacity: 0,
        rotation: 2,
        duration: 1.4,
        stagger: 0.1,
        ease: 'power3.out',
        delay: 0.2,
      });

      gsap.from('.hero-fade-in', {
        y: 30,
        opacity: 0,
        duration: 1.5,
        ease: 'power3.out',
        delay: 0.6,
      });

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
        },
      );

      // 4. Section Fade Ins
      gsap.utils.toArray<HTMLElement>('.fade-section').forEach((section) => {
        gsap.from(section, {
          opacity: 0,
          y: 40,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: section,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        });
      });

      // 5. Smooth Asymmetric Bento Scroll Reveal
      const bentoCards = gsap.utils.toArray<HTMLElement>('.bento-card');
      bentoCards.forEach((card, i) => {
        gsap.from(card, {
          y: 40,
          opacity: 0,
          duration: 0.7,
          delay: i * 0.1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: '.bento-trigger-container',
            start: 'top 75%',
            toggleActions: 'play none none none',
          },
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen overflow-x-hidden text-[#1A1615] selection:bg-[#72AEE6] selection:text-white"
      style={{ fontFamily: '"Outfit", sans-serif' }}
    >
      {/* Background */}
      <div className="fixed inset-0 -z-20 h-full w-full bg-[#E4F0FB]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B6D6F2]/40 via-[#E4F0FB] to-[#F1F7FD] opacity-90" />
        <div className="absolute top-[-10%] left-[-10%] h-[60vw] w-[60vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,transparent_70%)] blur-[80px]" />
        <div className="absolute top-[20%] right-[-10%] h-[50vw] w-[50vw] rounded-full bg-[#9CC1E7] opacity-40 mix-blend-multiply blur-[150px]" />
        <div className="absolute bottom-[-10%] left-[20%] h-[70vw] w-[70vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,1)_0%,transparent_60%)] blur-[100px]" />
        <div className="absolute top-[60%] right-[10%] h-[45vw] w-[45vw] rounded-full bg-[#72AEE6] opacity-30 mix-blend-multiply blur-[160px]" />
      </div>

      {/* Clouds */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="parallax-cloud absolute top-[4%] -right-[9%] w-[760px] opacity-58 mix-blend-multiply md:w-[1120px]">
          <img
            src={PUBLIC_CLOUD_PRIMARY_SRC}
            className="h-full w-full object-cover"
            style={{
              WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
              maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
            }}
            alt="cloud"
          />
        </div>
        <div className="parallax-cloud absolute top-[17%] -left-[18%] w-[860px] opacity-48 mix-blend-multiply md:w-[1280px]">
          <img
            src={PUBLIC_CLOUD_SECONDARY_SRC}
            className="h-full w-full object-cover"
            style={{
              WebkitMaskImage: 'radial-gradient(ellipse closest-side, black 20%, transparent 100%)',
              maskImage: 'radial-gradient(ellipse closest-side, black 20%, transparent 100%)',
            }}
            alt="cloud"
          />
        </div>
        <div className="parallax-cloud absolute top-[35%] right-[6%] w-[440px] opacity-64 mix-blend-multiply md:w-[680px]">
          <img
            src={PUBLIC_CLOUD_COMPACT_SRC}
            className="h-full w-full object-cover"
            style={{
              WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
              maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
            }}
            alt="cloud"
          />
        </div>
        <div className="parallax-cloud absolute top-[56%] -left-[10%] w-[680px] opacity-46 mix-blend-multiply md:w-[1040px]">
          <img
            src={PUBLIC_CLOUD_TERTIARY_SRC}
            className="h-full w-full object-cover"
            style={{
              WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
              maskImage: 'radial-gradient(closest-side, black 20%, transparent 100%)',
            }}
            alt="cloud"
          />
        </div>
      </div>

      {/* Nav */}
      <div className="fixed top-6 right-0 left-0 z-50 flex w-full justify-center px-4">
        <nav className="flex w-full max-w-5xl items-center justify-between rounded-full border border-white/60 bg-white/50 px-6 py-3 backdrop-blur-2xl transition-all">
          <Link
            to="/"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[#1A1615]"
          >
            <VoyagerLogo className="size-6 text-[#1A1615]" />
            Voyager
          </Link>
          <div className="flex items-center gap-8">
            {auth.isAuthenticated ? (
              <Link
                to="/app/trips"
                className="flex items-center gap-2 rounded-full bg-[#1A1615] px-6 py-2.5 text-sm font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Open Planner <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="flex items-center gap-2 rounded-full bg-[#1A1615] px-6 py-2.5 text-sm font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Sign In <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </nav>
      </div>

      {/* Hero */}
      <section className="hero-section relative z-10 flex min-h-[100dvh] flex-col items-center justify-start px-4 pt-[20vh]">
        <div className="flex w-full max-w-6xl flex-col items-center text-center">
          <div className="hero-fade-in mb-8 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/60 px-4 py-2 text-xs font-bold tracking-[0.2em] text-[#1A1615] uppercase backdrop-blur-xl">
            <Sparkles className="h-4 w-4" />
            <span>Intelligent Travel</span>
          </div>

          <h1
            className="mb-8 leading-[1.1] font-semibold tracking-tighter text-[#1A1615]"
            style={{ fontSize: 'clamp(4rem, 10vw, 8rem)' }}
          >
            <div className="-mb-4 overflow-hidden pb-4">
              <div className="hero-word inline-block">Plan Journeys</div>
            </div>
            <div className="-mb-4 overflow-hidden pb-4">
              <div
                className="hero-word inline-block"
                style={{
                  background: 'linear-gradient(135deg, #2B73B4 0%, #4A9FE0 50%, #72AEE6 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Worth Remembering.
              </div>
            </div>
          </h1>

          <p className="hero-fade-in mb-12 max-w-2xl text-xl leading-relaxed font-medium text-[#1A1615]/70 md:text-2xl">
            Voyager builds rich, editable itineraries from your destination and trip details, then
            lets you shape every day exactly as you want in a beautiful workspace.
          </p>

          <div className="hero-fade-in flex flex-wrap items-center gap-4">
            {auth.isAuthenticated ? (
              <Link
                to="/app/trips"
                className="inline-flex items-center gap-2.5 rounded-[2rem] bg-[#1A1615] px-10 py-5 text-lg font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Start Planning <ArrowRight className="h-5 w-5" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2.5 rounded-[2rem] bg-[#1A1615] px-10 py-5 text-lg font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Start Planning <ArrowRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Hero Dashboard Mockup */}
        <div className="dashboard-trigger relative z-20 mx-auto mt-24 w-full max-w-6xl">
          <div className="dashboard-mockup rounded-[2.5rem] border border-white/80 bg-white/40 p-3 shadow-2xl shadow-[#72AEE6]/10 backdrop-blur-3xl md:p-5">
            <img
              src="/images/landing/p_1.png"
              alt="Voyager trip planner dashboard showing a trip to Buenos Aires with map view and day-by-day itinerary"
              className="aspect-[36/25] w-full rounded-[1.5rem] object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* Bento Feature Cards */}
      <section className="fade-section bento-trigger-container relative z-10 mt-10 px-4 py-32">
        <div className="mx-auto max-w-7xl">
          <div className="mb-20 md:w-1/2">
            <h2 className="mb-6 pb-2 text-4xl leading-[1.1] font-semibold tracking-tighter md:text-6xl">
              Built for the <br />
              <span
                style={{
                  background: 'linear-gradient(135deg, #2B73B4 0%, #4A9FE0 60%, #72AEE6 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                deliberate traveler
              </span>
            </h2>
            <p className="max-w-md text-xl leading-relaxed font-medium text-[#1A1615]/70">
              Smart tools that adapt to your travel style, built into a premium, frictionless
              workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-12 lg:gap-10">
            {/* Left column */}
            <div className="flex flex-col gap-8 md:col-span-7 lg:gap-10">
              {/* Card 1 — AI Planner Assistant */}
              <div className="bento-card group relative min-h-[500px] overflow-hidden rounded-[3rem] border border-white/80 bg-white/50 p-12 backdrop-blur-2xl transition-all duration-500 hover:bg-white/70 md:p-16">
                <div className="relative z-10">
                  <div className="mb-8 flex h-16 w-16 transform items-center justify-center rounded-3xl border border-white/80 bg-white transition-transform duration-500 group-hover:scale-110">
                    <Zap className="h-7 w-7 text-[#1A1615]" />
                  </div>
                  <h3 className="mb-4 pb-1 text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
                    Planner Assistant
                  </h3>
                  <p className="max-w-md text-lg leading-relaxed font-medium text-[#453F3D]">
                    Chat naturally with your AI assistant to discover local gems, generate full
                    day-plans, and merge suggestions directly into your itinerary in seconds.
                  </p>
                </div>
                <div className="pointer-events-none absolute right-[-8%] bottom-[-8%] w-[72%] transition-transform duration-700 ease-out group-hover:-translate-x-4 group-hover:-translate-y-4">
                  <img
                    src="/images/landing/p_4.png"
                    alt="Planner Assistant finding cozy cafés in Cape Town"
                    className="w-full rounded-[2rem] object-cover shadow-2xl shadow-black/10"
                  />
                </div>
              </div>

              {/* Card 2 — Day-by-Day Flow */}
              <div className="bento-card group relative min-h-[420px] overflow-hidden rounded-[3rem] border border-white/80 bg-white/50 p-12 backdrop-blur-2xl transition-all duration-500 hover:bg-white/70 md:p-16">
                <div className="relative z-10">
                  <div className="mb-8 flex h-16 w-16 transform items-center justify-center rounded-3xl border border-white/80 bg-white transition-transform duration-500 group-hover:scale-110">
                    <Calendar className="h-7 w-7 text-[#1A1615]" />
                  </div>
                  <h3 className="mb-4 pb-1 text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
                    Day-by-Day Flow
                  </h3>
                  <p className="max-w-md text-lg leading-relaxed font-medium text-[#453F3D]">
                    Visual timelines that make sense. Browse curated recommendations alongside your
                    booked plans, and spot the perfect moment to add something new.
                  </p>
                </div>
                <div className="pointer-events-none absolute right-[-6%] bottom-[-6%] w-[65%] transition-transform duration-700 ease-out group-hover:-translate-x-3 group-hover:-translate-y-3">
                  <img
                    src="/images/landing/p_2.png"
                    alt="Day-by-day itinerary with place recommendations"
                    className="w-full rounded-[2rem] object-cover shadow-2xl shadow-black/10"
                  />
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-8 md:col-span-5 md:mt-32 lg:gap-10">
              {/* Card 3 — Places & Geospatial */}
              <div className="bento-card group relative flex min-h-[600px] flex-col overflow-hidden rounded-[3rem] border border-white/80 bg-white/50 p-12 backdrop-blur-2xl transition-all duration-500 hover:bg-white/70 md:p-16">
                <div className="relative z-10 mb-4">
                  <div className="mb-8 flex h-16 w-16 transform items-center justify-center rounded-3xl border border-white/80 bg-white transition-transform duration-500 group-hover:scale-110">
                    <Map className="h-7 w-7 text-[#1A1615]" />
                  </div>
                  <h3 className="mb-4 pb-1 text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
                    Live Map View
                  </h3>
                  <p className="text-lg leading-relaxed font-medium text-[#453F3D]">
                    See every activity pinned on an interactive map, complete with auto-routed paths
                    between stops. Discover what's nearby with a single tap.
                  </p>
                </div>
                <div className="relative mt-auto w-full flex-grow">
                  <div className="absolute top-4 right-[-20%] w-[140%] origin-top-left transition-transform duration-700 ease-out group-hover:-translate-y-4 group-hover:scale-105">
                    <img
                      src="/images/landing/p_3.png"
                      alt="Interactive map showing Cape Town itinerary with color-coded day routes"
                      className="w-full rounded-[2rem] object-cover shadow-2xl shadow-black/10"
                    />
                  </div>
                </div>
              </div>

              {/* Card 4 — Structured Data */}
              <div className="bento-card group relative rounded-[3rem] border border-white/80 bg-white/50 p-12 backdrop-blur-2xl transition-all duration-500 hover:bg-white/70 md:p-16">
                <div className="mb-8 flex h-16 w-16 transform items-center justify-center rounded-3xl border border-white/80 bg-white transition-transform duration-500 group-hover:scale-110">
                  <Compass className="h-7 w-7 text-[#1A1615]" />
                </div>
                <h3 className="mb-3 pb-1 text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
                  Structured Data
                </h3>
                <p className="text-lg leading-relaxed font-medium text-[#453F3D]">
                  Every activity is editable, reorderable, and moveable between days. Your
                  itinerary is durable data, not a text blob.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="fade-section relative z-10 flex justify-center px-4 py-48">
        <div className="relative w-full max-w-6xl overflow-hidden rounded-[4rem] border border-white/80 bg-white/60 p-16 text-center text-[#1A1615] backdrop-blur-3xl md:p-32">
          <div className="pointer-events-none absolute top-[-20%] left-[-10%] h-[50%] w-[50%] rounded-full bg-white/80 mix-blend-screen blur-[100px]" />
          <div className="relative z-10 flex flex-col items-center">
            <h2
              className="mb-8 pb-2 leading-[1.1] font-semibold tracking-tighter text-[#1A1615]"
              style={{ fontSize: 'clamp(3.5rem, 7vw, 6rem)' }}
            >
              Your next journey <br /> starts here.
            </h2>
            <p className="mb-14 max-w-2xl text-xl leading-relaxed font-medium text-[#453F3D] md:text-2xl">
              Sign in to create your first trip and experience what premium AI-assisted travel
              planning feels like.
            </p>
            {auth.isAuthenticated ? (
              <Link
                to="/app/trips"
                className="inline-flex items-center gap-3 rounded-[2.5rem] bg-[#1A1615] px-12 py-6 text-xl font-semibold text-white transition-transform duration-300 hover:scale-95"
              >
                Get Started Now <ArrowRight className="h-6 w-6" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-3 rounded-[2.5rem] bg-[#1A1615] px-12 py-6 text-xl font-semibold text-white transition-transform duration-300 hover:scale-95"
              >
                Get Started Now <ArrowRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mt-20 px-8 py-16">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 md:flex-row">
          <div className="flex items-center gap-3 opacity-90 transition-opacity hover:opacity-100">
            <VoyagerLogo className="size-8 text-[#1A1615]" />
            <span className="text-3xl font-semibold tracking-tight text-[#1A1615]">Voyager</span>
          </div>
          <p className="text-base font-medium text-[#453F3D]">
            © 2026 Voyager. Built for the deliberate traveler.
          </p>
        </div>
      </footer>
    </div>
  );
}

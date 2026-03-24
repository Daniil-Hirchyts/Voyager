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

const heroWhiteTextShadow = {
  textShadow:
    '0 1px 0 rgba(255,255,255,0.55), 0 4px 10px rgba(64,94,126,0.16), 0 10px 26px rgba(64,94,126,0.18)',
};

const accentWhiteTextShadow = {
  textShadow:
    '0 1px 0 rgba(255,255,255,0.48), 0 3px 8px rgba(64,94,126,0.14), 0 8px 20px rgba(64,94,126,0.16)',
};

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
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion) {
        gsap.set(
          [
            '.landing-nav',
            '.hero-badge',
            '.hero-word',
            '.hero-copy',
            '.hero-actions > *',
            '.dashboard-mockup',
            '.fade-section',
            '.bento-card',
          ],
          { clearProps: 'all' },
        );
        return;
      }

      gsap.utils.toArray<HTMLElement>('.parallax-cloud').forEach((cloud, i) => {
        gsap.to(cloud, {
          y: () => (i % 2 === 0 ? -32 : 32),
          x: () => (i % 3 === 0 ? 24 : -24),
          rotation: () => (i % 2 === 0 ? 2.5 : -2.5),
          duration: 18 + i * 4,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        });

        gsap.to(cloud, {
          yPercent: i % 2 === 0 ? 48 : -34,
          ease: 'none',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1.2,
          },
        });
      });

      const heroTimeline = gsap.timeline({
        defaults: { ease: 'power3.out' },
      });

      heroTimeline
        .from('.landing-nav', {
          y: -24,
          autoAlpha: 0,
          scale: 0.98,
          duration: 0.9,
        })
        .from(
          '.hero-badge',
          {
            y: 20,
            autoAlpha: 0,
            filter: 'blur(10px)',
            duration: 0.8,
          },
          '-=0.45',
        )
        .from(
          '.hero-word',
          {
            yPercent: 120,
            autoAlpha: 0,
            rotationX: -50,
            transformOrigin: '50% 100%',
            transformPerspective: 1200,
            duration: 1.1,
            stagger: 0.08,
          },
          '-=0.2',
        )
        .from(
          '.hero-copy',
          {
            y: 28,
            autoAlpha: 0,
            filter: 'blur(14px)',
            duration: 0.95,
          },
          '-=0.55',
        )
        .from(
          '.hero-actions > *',
          {
            y: 20,
            autoAlpha: 0,
            scale: 0.96,
            stagger: 0.08,
            duration: 0.75,
          },
          '-=0.55',
        )
        .from(
          '.dashboard-mockup',
          {
            y: 72,
            autoAlpha: 0,
            scale: 0.94,
            rotationX: 8,
            transformOrigin: '50% 100%',
            transformPerspective: 1400,
            duration: 1.2,
          },
          '-=0.35',
        );

      gsap.to('.dashboard-mockup', {
        y: -4,
        duration: 7,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      const heroScrollTimeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: 'bottom top',
          scrub: 1.2,
        },
      });

      heroScrollTimeline
        .to(
          '.hero-stack',
          {
            yPercent: -10,
            opacity: 0.92,
          },
          0,
        )
        .to(
          '.dashboard-mockup',
          {
            yPercent: -5,
            scale: 1.012,
            rotationX: -1.5,
            transformPerspective: 1400,
          },
          0,
        );

      gsap.utils.toArray<HTMLElement>('.fade-section').forEach((section) => {
        gsap.from(section, {
          autoAlpha: 0,
          y: 56,
          scale: 0.985,
          filter: 'blur(10px)',
          duration: 1.05,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: section,
            start: 'top 82%',
            once: true,
          },
        });
      });

      const bentoCards = gsap.utils.toArray<HTMLElement>('.bento-card');
      bentoCards.forEach((card, i) => {
        gsap.from(card, {
          y: 54 + i * 6,
          x: i % 2 === 0 ? -20 : 20,
          rotateZ: i % 2 === 0 ? -1.5 : 1.5,
          autoAlpha: 0,
          scale: 0.98,
          filter: 'blur(10px)',
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: card,
            start: 'top 84%',
            once: true,
          },
        });

        const cardImage = card.querySelector('img');
        if (cardImage) {
          gsap.fromTo(
            cardImage,
            { scale: 1.08 },
            {
              scale: 1,
              duration: 1.4,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: card,
                start: 'top 84%',
                once: true,
              },
            },
          );
        }
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
      <div className="fixed inset-0 -z-20 h-full w-full bg-[#E4F0FB]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B6D6F2]/40 via-[#E4F0FB] to-[#F1F7FD] opacity-90" />
        <div className="absolute top-[-10%] left-[-10%] h-[60vw] w-[60vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,transparent_70%)] blur-[80px]" />
        <div className="absolute top-[20%] right-[-10%] h-[50vw] w-[50vw] rounded-full bg-[#9CC1E7] opacity-40 mix-blend-multiply blur-[150px]" />
        <div className="absolute bottom-[-10%] left-[20%] h-[70vw] w-[70vw] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,1)_0%,transparent_60%)] blur-[100px]" />
        <div className="absolute top-[60%] right-[10%] h-[45vw] w-[45vw] rounded-full bg-[#72AEE6] opacity-30 mix-blend-multiply blur-[160px]" />
      </div>

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

      <div className="fixed top-6 right-0 left-0 z-50 flex w-full justify-center px-4">
        <nav className="landing-nav flex w-full max-w-5xl items-center justify-between rounded-full border border-white/60 bg-white/50 px-6 py-3 backdrop-blur-2xl transition-all">
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
                Open Your Trips <ArrowRight className="h-4 w-4" />
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

      <section className="hero-section relative z-10 flex min-h-[100dvh] flex-col items-center justify-start px-4 pt-[20vh]">
        <div className="hero-stack flex w-full max-w-6xl flex-col items-center text-center">
          <div className="hero-badge mb-8 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/60 px-4 py-2 text-xs font-bold tracking-[0.2em] text-[#1A1615] uppercase backdrop-blur-xl">
            <Sparkles className="h-4 w-4" />
            <span>AI Trip Planning Workspace</span>
          </div>

          <h1
            className="mb-8 leading-[1.1] font-semibold tracking-tighter text-[#1A1615]"
            style={{ fontSize: 'clamp(4rem, 10vw, 8rem)' }}
          >
            <div className="-mb-4 overflow-hidden pb-4">
              <div className="hero-word inline-block">Plan</div>{' '}
              <div className="hero-word inline-block">Trips.</div>
            </div>
            <div className="-mb-4  pb-4">
              <div className="hero-word inline-block text-white" style={heroWhiteTextShadow}>
                Keep
              </div>{' '}
              <div className="hero-word inline-block text-white" style={heroWhiteTextShadow}>
                Control.
              </div>
            </div>
          </h1>

          <p className="hero-copy mb-12 max-w-2xl text-xl leading-relaxed font-medium text-[#1A1615]/70 md:text-2xl">
            Generate a first draft, then edit each day with the itinerary and map side by side.
          </p>

          <div className="hero-actions flex flex-wrap items-center gap-4">
            {auth.isAuthenticated ? (
              <Link
                to="/app/trips"
                className="inline-flex items-center gap-2.5 rounded-[2rem] bg-[#1A1615] px-10 py-5 text-lg font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Open Your Trips <ArrowRight className="h-5 w-5" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2.5 rounded-[2rem] bg-[#1A1615] px-10 py-5 text-lg font-medium text-white transition-transform duration-300 hover:scale-95"
              >
                Create Your First Trip <ArrowRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <div className="dashboard-trigger relative z-20 mx-auto mt-24 w-full max-w-6xl">
          <div className="dashboard-mockup rounded-[2.5rem] border border-white/80 bg-white/40 p-3 shadow-2xl shadow-[#72AEE6]/10 backdrop-blur-3xl md:p-5">
            <img
              src="/images/landing/p_1.png"
              alt="Voyager trip planner dashboard showing a trip to Buenos Aires with map view and day-by-day itinerary"
              className="w-full rounded-[1.5rem] object-contain"
            />
          </div>
        </div>
      </section>

      <section className="fade-section bento-trigger-container relative z-10 mt-10 px-4 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 md:w-1/2">
            <h2 className="mb-6 pb-2 text-4xl leading-[1.1] font-semibold tracking-tighter md:text-6xl">
              From first draft <br />
              <span className="text-white" style={accentWhiteTextShadow}>
                to final itinerary
              </span>
            </h2>
            <p className="max-w-md text-xl leading-relaxed font-medium text-[#1A1615]/90">
              Voyager combines itinerary generation, day planning, map context, and trip
              organization in one workspace, so the plan stays useful after the first draft.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-12 lg:gap-8">
            <div className="flex flex-col gap-6 md:col-span-7 lg:gap-8">
              <div className="bento-card group flex flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/40 backdrop-blur-3xl transition-all duration-500 hover:bg-white/60">
                <div className="p-6 md:p-8">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1A1615] to-[#453F3D] text-white shadow-lg transition-transform duration-500 group-hover:scale-110">
                    <Zap className="h-5 w-5" />
                  </div>
                  <h3 className="mb-3 pb-1 text-2xl leading-[1.1] font-semibold tracking-tight text-[#1A1615] md:text-3xl">
                    Planner Assistant
                  </h3>
                  <p className="max-w-md text-base leading-relaxed font-medium text-[#1A1615]/80 md:text-lg">
                    Describe the trip you want and let Voyager draft a new itinerary or extend the
                    one you already have. It speeds up planning without taking control away from
                    you.
                  </p>
                </div>
                <div className="mt-auto w-full pt-6 transition-transform duration-700 ease-out group-hover:-translate-y-2">
                  <div className="overflow-hidden rounded-t-[1.5rem] border-t border-black/5 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
                    <img
                      src="/images/landing/p_4.png"
                      alt="Planner Assistant finding cozy cafés in Cape Town"
                      className="h-72 w-full object-cover object-top md:h-80 lg:h-96"
                    />
                  </div>
                </div>
              </div>

              <div className="bento-card group flex flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/40 backdrop-blur-3xl transition-all duration-500 hover:bg-white/60">
                <div className="p-6 md:p-8">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1A1615] to-[#453F3D] text-white shadow-lg transition-transform duration-500 group-hover:scale-110">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <h3 className="mb-3 pb-1 text-2xl leading-[1.1] font-semibold tracking-tight text-[#1A1615] md:text-3xl">
                    Day-by-Day Itinerary
                  </h3>
                  <p className="max-w-md text-base leading-relaxed font-medium text-[#1A1615]/80 md:text-lg">
                    Hotels, travel legs, meals, visits, and recommendations are laid out in order,
                    so you can rebalance busy days, move activities around, and see what still needs
                    work.
                  </p>
                </div>
                <div className="mt-auto w-full pt-6 transition-transform duration-700 ease-out group-hover:-translate-y-2">
                  <div className="overflow-hidden rounded-t-[1.5rem] border-t border-black/5 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
                    <img
                      src="/images/landing/p_2.png"
                      alt="Day-by-day itinerary with place recommendations"
                      className="h-72 w-full object-cover object-top md:h-80 lg:h-96"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6 md:col-span-5 md:mt-32 lg:gap-8">
              <div className="bento-card group flex flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/40 backdrop-blur-3xl transition-all duration-500 hover:bg-white/60">
                <div className="p-6 md:p-8">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1A1615] to-[#453F3D] text-white shadow-lg transition-transform duration-500 group-hover:scale-110">
                    <Map className="h-5 w-5" />
                  </div>
                  <h3 className="mb-3 pb-1 text-2xl leading-[1.1] font-semibold tracking-tight text-[#1A1615] md:text-3xl">
                    Live Map View
                  </h3>
                  <p className="text-base leading-relaxed font-medium text-[#1A1615]/80 md:text-lg">
                    See the whole trip on a map, follow routed connections between stops, and add
                    nearby places to a specific day or your planning inbox.
                  </p>
                </div>
                <div className="mt-auto w-full pt-6 transition-transform duration-700 ease-out group-hover:-translate-y-2">
                  <div className="mx-6 overflow-hidden rounded-t-[1.5rem] border border-b-0 border-black/5 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] md:mx-10">
                    <img
                      src="/images/landing/p_3.png"
                      alt="Interactive map showing Cape Town itinerary with color-coded day routes"
                      className="h-72 w-full object-cover object-top md:h-80 lg:h-[400px]"
                    />
                  </div>
                </div>
              </div>

              <div className="bento-card group relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/40 p-6 backdrop-blur-3xl transition-all duration-500 hover:bg-white/60 md:p-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1A1615] to-[#453F3D] text-white shadow-lg transition-transform duration-500 group-hover:scale-110">
                  <Compass className="h-5 w-5" />
                </div>
                <h3 className="mb-2 pb-1 text-2xl leading-[1.1] font-semibold tracking-tight text-[#1A1615] md:text-3xl">
                  Structured Trip Data
                </h3>
                <p className="text-base leading-relaxed font-medium text-[#1A1615]/80 md:text-lg">
                  Each activity lives as real trip data instead of loose notes, which makes the
                  itinerary easier to edit, reuse, and share with collaborators.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="fade-section relative z-10 flex justify-center px-4 py-48">
        <div className="cta-shell relative w-full max-w-6xl overflow-hidden rounded-[4rem] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(255,255,255,0.5))] p-8 text-[#1A1615] shadow-[0_30px_90px_rgba(84,129,176,0.16)] backdrop-blur-3xl md:p-14 lg:p-16">
          <div className="pointer-events-none absolute top-[-18%] left-[-8%] h-[48%] w-[38%] rounded-full bg-white/90 mix-blend-screen blur-[100px]" />
          <div className="pointer-events-none absolute right-[-6%] bottom-[-16%] h-[52%] w-[34%] rounded-full bg-[#9CC1E7]/45 blur-[120px]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_48%,rgba(114,174,230,0.1)_100%)]" />

          <div className="cta-content relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)] lg:items-end">
            <div className="text-left">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/85 bg-white/65 px-4 py-2 text-[0.72rem] font-bold tracking-[0.2em] uppercase backdrop-blur-xl">
                <Sparkles className="h-3.5 w-3.5" />
                Ready to plan
              </div>

              <h2
                className="max-w-[10ch] pb-2 leading-[0.98] font-semibold tracking-tighter text-[#1A1615]"
                style={{ fontSize: 'clamp(3rem, 6vw, 5.5rem)' }}
              >
                Build the trip.
                <br />
                Keep shaping it.
              </h2>

              <p className="mt-6 max-w-2xl text-lg leading-relaxed font-medium text-[#453F3D] md:text-xl">
                Voyager gives you a first draft, a day planner, and a live map so the trip stays
                editable from idea to departure.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                {auth.isAuthenticated ? (
                  <Link
                    to="/app/trips"
                    className="inline-flex items-center gap-3 rounded-[2.5rem] bg-[#1A1615] px-10 py-5 text-lg font-semibold text-white transition-transform duration-300 hover:scale-95"
                  >
                    Open Your Trips <ArrowRight className="h-5 w-5" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="inline-flex items-center gap-3 rounded-[2.5rem] bg-[#1A1615] px-10 py-5 text-lg font-semibold text-white transition-transform duration-300 hover:scale-95"
                  >
                    Create Your First Trip <ArrowRight className="h-5 w-5" />
                  </button>
                )}

                <p className="text-sm leading-relaxed font-medium text-[#453F3D]/80">
                  Start with one destination, then refine every stop.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-[2rem] border border-white/85 bg-white/62 p-5 shadow-[0_16px_32px_rgba(17,24,39,0.06)] backdrop-blur-2xl">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1A1615] text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="text-[0.72rem] font-bold tracking-[0.18em] text-[#453F3D]/70 uppercase">
                  Draft Fast
                </p>
                <p className="mt-2 text-sm leading-6 font-medium text-[#453F3D]">
                  Turn destination, dates, and trip intent into a working itinerary.
                </p>
              </div>

              <div className="rounded-[2rem] border border-white/85 bg-white/62 p-5 shadow-[0_16px_32px_rgba(17,24,39,0.06)] backdrop-blur-2xl">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1A1615] text-white">
                  <Calendar className="h-5 w-5" />
                </div>
                <p className="text-[0.72rem] font-bold tracking-[0.18em] text-[#453F3D]/70 uppercase">
                  Edit Days
                </p>
                <p className="mt-2 text-sm leading-6 font-medium text-[#453F3D]">
                  Reorder plans, move stops, and keep each day balanced.
                </p>
              </div>

              <div className="rounded-[2rem] border border-white/85 bg-white/62 p-5 shadow-[0_16px_32px_rgba(17,24,39,0.06)] backdrop-blur-2xl">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1A1615] text-white">
                  <Map className="h-5 w-5" />
                </div>
                <p className="text-[0.72rem] font-bold tracking-[0.18em] text-[#453F3D]/70 uppercase">
                  See Context
                </p>
                <p className="mt-2 text-sm leading-6 font-medium text-[#453F3D]">
                  Review routes on the map before you lock in the plan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 mt-20 px-8 py-16">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 md:flex-row">
          <div className="flex items-center gap-3 opacity-90 transition-opacity hover:opacity-100">
            <VoyagerLogo className="size-8 text-[#1A1615]" />
            <span className="text-3xl font-semibold tracking-tight text-[#1A1615]">Voyager</span>
          </div>
          <p className="text-base font-medium text-[#453F3D]">
            © 2026 Voyager
          </p>
        </div>
      </footer>
    </div>
  );
}

import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { tripKeys, useTrips } from '@/entities/trip/queries';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
import { createTrip, patchTripCoverPreference } from '@/entities/trip/api';
import { createPlace } from '@/entities/place/api';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Compass,
  Map,
  Plus,
  Route,
  Users,
  UserCheck,
} from 'lucide-react';
import { VoyagerLogo } from '@/widgets/app-shell/logo';
import { differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { config } from '@/app/config';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/ui/animated-background';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNavigation,
} from '@/components/ui/carousel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isApiError } from '@/shared/api/client';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';
import type { Trip } from '@/shared/api/types';
import { VoyagerMap, MapFitBounds, VoyagerMarker } from '@/shared/layouts/google-maps';
import { WorkspacePage } from '@/shared/layouts/workspace-shell';
import { useTripListCoverPhotos, type TripCardCover } from './useTripListCoverPhotos';
import { CURATED_DESTINATIONS, type CuratedDestination } from './curated-destinations';

function formatTripDates(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return 'Dates flexible';
  }

  if (startDate && endDate) {
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (format(start, 'yyyy') === format(end, 'yyyy')) {
      if (format(start, 'MMM') === format(end, 'MMM')) {
        return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`;
      }

      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
    }

    return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
  }

  return format(parseISO(startDate ?? endDate!), 'MMM d, yyyy');
}

function getTripLengthLabel(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) {
    return null;
  }

  const totalDays = differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
  return `${totalDays} ${totalDays === 1 ? 'day' : 'days'}`;
}

function getTripTimingLabel(startDate?: string | null, endDate?: string | null) {
  if (!startDate) {
    return 'Plan in progress';
  }

  const today = startOfDay(new Date());
  const tripStart = startOfDay(parseISO(startDate));
  const tripEnd = endDate ? startOfDay(parseISO(endDate)) : tripStart;
  const daysUntilStart = differenceInCalendarDays(tripStart, today);
  const daysUntilEnd = differenceInCalendarDays(tripEnd, today);

  if (daysUntilStart > 1) {
    return `In ${daysUntilStart} days`;
  }

  if (daysUntilStart === 1) {
    return 'Tomorrow';
  }

  if (daysUntilStart === 0) {
    return 'Today';
  }

  if (daysUntilEnd >= 0) {
    return 'Happening now';
  }

  return 'Completed';
}

function getTimingStatusColor(startDate?: string | null, endDate?: string | null) {
  if (!startDate) return 'bg-blue-400';

  const today = startOfDay(new Date());
  const tripStart = startOfDay(parseISO(startDate));
  const tripEnd = endDate ? startOfDay(parseISO(endDate)) : tripStart;
  const daysUntilStart = differenceInCalendarDays(tripStart, today);
  const daysUntilEnd = differenceInCalendarDays(tripEnd, today);

  if (daysUntilStart > 1) return 'bg-blue-400';
  if (daysUntilStart === 1 || daysUntilStart === 0) return 'bg-amber-400';
  if (daysUntilEnd >= 0) return 'bg-emerald-400';
  return 'bg-white/70';
}

function formatBudget(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTravelModeLabel(mode: CuratedDestination['routeTravelMode']) {
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

function getTripShareBadge(trip: Trip) {
  if (trip.current_user_role === 'editor') {
    return {
      label: 'Editor',
      detail: 'Shared access',
      variant: 'accent' as const,
    };
  }

  if (trip.collaborator_count > 0) {
    return {
      label: 'Shared',
      detail: `${trip.collaborator_count} ${trip.collaborator_count === 1 ? 'editor' : 'editors'}`,
      variant: 'outline' as const,
    };
  }

  return null;
}

function getDestinationPoint(destination: CuratedDestination) {
  return {
    lat: destination.lat,
    lng: destination.lon,
  };
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function SectionIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <p className="text-[0.72rem] font-semibold tracking-[0.22em] text-[var(--color-text-muted)] uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-2 text-[1.5rem] leading-none font-semibold tracking-[-0.05em] text-[var(--color-text)] md:text-[2rem]">
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-[55ch] text-sm leading-6 text-[var(--color-text-muted)] md:text-[0.98rem]">
            {description}
          </p>
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function TripCard({ trip, cover }: { trip: Trip; cover: TripCardCover }) {
  const tripLengthLabel = getTripLengthLabel(trip.start_date, trip.end_date);
  const timingLabel = getTripTimingLabel(trip.start_date, trip.end_date);
  const dateLabel = formatTripDates(trip.start_date, trip.end_date);
  const shareBadge = getTripShareBadge(trip);

  return (
    <Link to={`/app/trips/${trip.id}`} className="trip-card group block" draggable={false}>
      <article className="overflow-hidden rounded-[20px] border border-white/70 bg-[var(--color-secondary-surface)] transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:-translate-y-1 group-hover:border-white group-hover:bg-white">
        <div className="relative aspect-[16/9] overflow-hidden bg-[linear-gradient(135deg,#d4d4d4_0%,#a3a3a3_100%)]">
          {cover.url && (
            <img
              src={cover.url}
              alt={trip.destination_text}
              className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:scale-[1.08]"
              loading="lazy"
              draggable={false}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.18)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,18,0.0)_0%,rgba(7,12,18,0.12)_40%,rgba(7,12,18,0.78)_100%)]" />

          <div className="absolute top-3 left-3 z-10">
            <span className="flex items-center rounded-full border border-white/20 bg-[rgba(15,20,25,0.45)] px-2.5 py-1 shadow-sm backdrop-blur-md transition-colors hover:bg-[rgba(15,20,25,0.6)]">
              <span
                className={cn(
                  'mr-1.5 size-1.5 rounded-full',
                  getTimingStatusColor(trip.start_date, trip.end_date),
                )}
              />
              <span className="text-[0.7rem] font-medium tracking-wide text-white">
                {timingLabel}
              </span>
            </span>
          </div>

          {shareBadge ? (
            <div className="absolute top-3 right-3 z-10">
              <span className="flex items-center rounded-full border border-white/20 bg-[rgba(15,20,25,0.45)] px-2.5 py-1 shadow-sm backdrop-blur-md transition-colors hover:bg-[rgba(15,20,25,0.6)]">
                {shareBadge.label === 'Shared' ? (
                  <Users className="mr-1.5 size-[13px] text-white/80" />
                ) : (
                  <UserCheck className="mr-1.5 size-[13px] text-white/80" />
                )}
                <span className="text-[0.7rem] font-medium tracking-wide text-white">
                  {shareBadge.label}
                </span>
              </span>
            </div>
          ) : null}

          <div className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
            <h3 className="line-clamp-2 text-[1.15rem] leading-[1.1] font-semibold tracking-[-0.04em] text-white">
              {trip.title}
            </h3>
            <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/20 p-1.5 text-white backdrop-blur-sm transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
              <span className="truncate text-[0.78rem] text-[var(--color-text-muted)]">
                {dateLabel}
              </span>
            </div>
            {shareBadge ? (
              <span className="text-[0.74rem] font-medium text-[var(--color-text-muted)]">
                {shareBadge.detail}
              </span>
            ) : null}
          </div>
          {tripLengthLabel && (
            <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[0.7rem] font-medium text-[var(--color-text-muted)]">
              {tripLengthLabel}
            </span>
          )}
        </div>
      </article>
    </Link>
  );
}

function WorldExplorerMap({
  destinations,
  activeDestinationId,
  onSelect,
}: {
  destinations: CuratedDestination[];
  activeDestinationId: string;
  onSelect: (destinationId: string) => void;
}) {
  const activeDestination =
    destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0];
  const destinationPoints = destinations.map(getDestinationPoint);

  if (!config.map.apiKey) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#e5e5e5_0%,#f5f5f5_100%)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.84),transparent_22%),radial-gradient(circle_at_78%_28%,rgba(23,23,23,0.02),transparent_24%)]" />
        <div className="relative flex h-full flex-col justify-between p-5">
          <div className="max-w-sm rounded-[20px] border border-white/70 bg-white/74 px-4 py-3 text-[var(--color-text)] backdrop-blur-md">
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
              Live explorer
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              A Google Maps API key is required to render the live explorer map on this page.
            </p>
          </div>
          {activeDestination ? (
            <div className="max-w-md rounded-[20px] border border-white/70 bg-white/74 px-4 py-4 text-[var(--color-text)] backdrop-blur-md">
              <p className="text-[0.68rem] tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
                Selected destination
              </p>
              <h3 className="mt-2 text-[1.25rem] font-semibold tracking-[-0.04em]">
                {activeDestination.destinationText}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                Add `VITE_GOOGLE_MAPS_API_KEY` to switch this panel to a live map.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#e5e5e5]">
      <VoyagerMap
        defaultCenter={{ lat: 24, lng: 10 }}
        defaultZoom={2}
        minZoom={2}
        maxZoom={6}
        restriction={{
          latLngBounds: { north: 85, south: -85, west: -179.99, east: 179.99 },
          strictBounds: true,
        }}
        disableDefaultUI
        zoomControl
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        clickableIcons={false}
        gestureHandling="cooperative"
        style={{ width: '100%', height: '100%' }}
      >
        <MapFitBounds
          points={destinationPoints}
          padding={{ top: 96, right: 88, bottom: 88, left: 88 }}
          maxZoom={3}
          singlePointZoom={4}
        />
        {destinations.map((destination) => {
          const isActive = destination.id === activeDestinationId;

          return (
            <VoyagerMarker
              key={destination.id}
              position={getDestinationPoint(destination)}
              title={destination.destinationText}
              selected={isActive}
              zIndex={isActive ? 3 : 2}
              onClick={() => onSelect(destination.id)}
            >
              <div className="flex flex-col items-center gap-2 pb-1">
                {isActive ? (
                  <span className="rounded-full border border-white/22 bg-[rgba(15,26,39,0.78)] px-3 py-1 text-[0.7rem] font-medium text-white backdrop-blur-md">
                    {destination.name}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'relative flex items-center justify-center rounded-full border-2 border-white transition-all duration-200',
                    isActive ? 'size-5' : 'size-4',
                  )}
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${destination.accentFrom} 0%, ${destination.accentTo} 100%)`,
                  }}
                >
                  <span className="size-1.5 rounded-full bg-white/90" />
                </span>
              </div>
            </VoyagerMarker>
          );
        })}
      </VoyagerMap>

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.02)_24%,rgba(23,23,23,0.08)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-[linear-gradient(180deg,rgba(229,229,229,0.0),rgba(229,229,229,0.82))]" />

      <div className="absolute top-4 right-4 z-20 rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-[0.72rem] font-medium text-[var(--color-text-muted)] backdrop-blur-md">
        {destinations.length} live markers
      </div>
    </div>
  );
}

function WorldExplorerMapPreview({ destination }: { destination: CuratedDestination | undefined }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#ecf1f5_0%,#dbe5ec_100%)]">
      {destination ? (
        <img
          src={destination.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="lazy"
        />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.9),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(15,23,42,0.18)_100%)]" />
      <div className="absolute top-4 right-4 rounded-full border border-white/70 bg-white/82 px-3 py-1.5 text-[0.72rem] font-medium text-[var(--color-text-muted)] backdrop-blur-md">
        Preparing map
      </div>
      {destination ? (
        <div className="absolute inset-x-4 bottom-4 rounded-[20px] border border-white/70 bg-white/82 px-4 py-4 text-[var(--color-text)] shadow-sm backdrop-blur-md">
          <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
            Selected destination
          </p>
          <h3 className="mt-2 text-[1.1rem] font-semibold tracking-[-0.04em]">
            {destination.destinationText}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            The live explorer loads when this section reaches the viewport.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DestinationListCard({
  destination,
  selected,
  onSelect,
  onAdd,
  isAdding,
}: {
  destination: CuratedDestination;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  isAdding: boolean;
}) {
  return (
    <div
      className={cn(
        'destination-card group flex w-full items-center gap-3 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition-colors lg:rounded-[14px] lg:px-3 lg:py-2.5',
        selected
          ? 'bg-[var(--color-secondary-surface)] lg:border-[var(--color-border)] lg:bg-white'
          : 'border-transparent bg-white hover:bg-[var(--color-secondary-surface)] lg:border-transparent lg:bg-transparent lg:hover:border-[var(--color-border)] lg:hover:bg-white',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="relative size-10 shrink-0 overflow-hidden rounded-[10px]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(135deg, ${destination.accentFrom} 0%, ${destination.accentTo} 100%)`,
            }}
          />
          <img
            src={destination.imageUrl}
            alt={destination.name}
            className="h-full w-full object-cover opacity-90 mix-blend-luminosity"
            loading="lazy"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.82rem] font-medium text-[var(--color-text)]">
            {destination.name}
          </p>
          <p className="truncate text-[0.72rem] text-[var(--color-text-muted)]">
            {destination.country}
          </p>
        </div>
      </button>
      {selected && (
        <Button
          type="button"
          className="h-7 shrink-0 rounded-full px-3 text-[0.72rem]"
          onClick={onAdd}
          disabled={isAdding}
        >
          <Plus className="size-3" />
          {isAdding ? 'Adding…' : 'Add'}
        </Button>
      )}
    </div>
  );
}

export default function TripsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error } = useTrips({ limit: 100, offset: 0 });
  const trips = data?.items ?? [];
  const tripCovers = useTripListCoverPhotos(trips);
  const [activeDestinationId, setActiveDestinationId] = useState(CURATED_DESTINATIONS[0]?.id ?? '');
  const [addingDestinationId, setAddingDestinationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'info'>('map');
  const [shouldRenderDestinationMap, setShouldRenderDestinationMap] = useState(false);

  const activeDestination =
    CURATED_DESTINATIONS.find((destination) => destination.id === activeDestinationId) ??
    CURATED_DESTINATIONS[0];

  const heroRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const destinationsRef = useRef<HTMLElement>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    if (activeTab === 'info' && detailsPanelRef.current) {
      const ctx = gsap.context(() => {
        gsap.set('.destination-meta > *', { y: 12, autoAlpha: 0 });
        gsap.set('.destination-title', { y: 18, autoAlpha: 0 });
        gsap.set('.destination-teaser', { y: 18, autoAlpha: 0 });
        gsap.set('.destination-stat', { y: 16, autoAlpha: 0 });
        gsap.set('.destination-highlights-heading', { y: 14, autoAlpha: 0 });
        gsap.set('.destination-highlight', { y: 10, autoAlpha: 0 });
        gsap.set('.destination-summary', { y: 18, autoAlpha: 0 });

        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

        tl.to('.destination-meta > *', { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.05 })
          .to('.destination-title', { y: 0, autoAlpha: 1, duration: 0.45 }, '-=0.12')
          .to('.destination-teaser', { y: 0, autoAlpha: 1, duration: 0.42 }, '-=0.24')
          .to(
            '.destination-stat',
            { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.06 },
            '-=0.18',
          )
          .to(
            '.destination-highlights-heading',
            { y: 0, autoAlpha: 1, duration: 0.34 },
            '-=0.16',
          )
          .to(
            '.destination-highlight',
            { y: 0, autoAlpha: 1, duration: 0.28, stagger: 0.035 },
            '-=0.18',
          )
          .to('.destination-summary', { y: 0, autoAlpha: 1, duration: 0.42 }, '-=0.12');
      }, detailsPanelRef);
      return () => ctx.revert();
    }
    return undefined;
  }, [activeDestinationId, activeTab]);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.set('.hero-bg', { scale: 1.08, autoAlpha: 0 });
      gsap.set('.hero-shell', { y: 20, autoAlpha: 0 });
      gsap.set('.hero-title', { y: 22, autoAlpha: 0 });
      gsap.set('.hero-desc', { y: 18, autoAlpha: 0 });
      gsap.set('.hero-actions > *', { y: 16, autoAlpha: 0 });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to('.hero-bg', { scale: 1, autoAlpha: 0.75, duration: 1.3, ease: 'power2.out' })
        .to('.hero-shell', { y: 0, autoAlpha: 1, duration: 0.65 }, '-=0.92')
        .to('.hero-title', { y: 0, autoAlpha: 1, duration: 0.58 }, '-=0.34')
        .to('.hero-desc', { y: 0, autoAlpha: 1, duration: 0.54 }, '-=0.28')
        .to('.hero-actions > *', { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.08 }, '-=0.16');
    }, heroRef);

    return () => ctx.revert();
  }, []);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    if (isLoading || !boardRef.current) return;

    const setup = gsap.context(() => {
      const tripCards = gsap.utils.toArray<HTMLElement>('.board-card');
      gsap.set('.board-intro', { y: 18, autoAlpha: 0 });

      if (error) {
        gsap.set('.board-alert', { y: 16, autoAlpha: 0 });
      }

      if (tripCards.length > 0) {
        gsap.set(tripCards, { y: 28, autoAlpha: 0 });
      }
    }, boardRef);

    let ctx: gsap.Context | undefined;
    const frame = requestAnimationFrame(() => {
      ScrollTrigger.refresh();
      ctx = gsap.context(() => {
        const tripCards = gsap.utils.toArray<HTMLElement>('.board-card');
        const hasCards = tripCards.length > 0;
        const hasAlert = Boolean(error);

        if (!hasCards && !hasAlert) {
          return;
        }

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          scrollTrigger: {
            trigger: boardRef.current,
            start: 'top 82%',
            once: true,
          },
        });

        tl.to('.board-intro', { y: 0, autoAlpha: 1, duration: 0.48 });

        if (hasAlert) {
          tl.to('.board-alert', { y: 0, autoAlpha: 1, duration: 0.42 }, '-=0.18');
        }

        if (hasCards) {
          tl.to(
            tripCards,
            { y: 0, autoAlpha: 1, duration: 0.56, stagger: 0.08 },
            hasAlert ? '-=0.14' : '-=0.16',
          );
        }
      }, boardRef);
    });

    return () => {
      cancelAnimationFrame(frame);
      ctx?.revert();
      setup.revert();
    };
  }, [error, isLoading, trips.length]);

  useEffect(() => {
    const section = destinationsRef.current;
    if (!section || shouldRenderDestinationMap) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShouldRenderDestinationMap(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) {
          return;
        }

        if (entry.isIntersecting) {
          setShouldRenderDestinationMap(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '320px 0px',
        threshold: 0.01,
      },
    );

    observer.observe(section);

    return () => observer.disconnect();
  }, [shouldRenderDestinationMap]);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    const section = destinationsRef.current;
    if (!section) return;
    let ctx: gsap.Context | undefined;
    let setup: gsap.Context | undefined;
    let observer: IntersectionObserver | undefined;

    const revealDestinations = () => {
      if (ctx) {
        return;
      }

      ctx = gsap.context(() => {
        const viewer = gsap.utils
          .toArray<HTMLElement>('.destinations-viewer')
          .filter((element) => element.offsetParent !== null);
        const sidebarHeader = gsap.utils
          .toArray<HTMLElement>('.destinations-sidebar-header')
          .filter((element) => element.offsetParent !== null);
        const destinationCards = gsap.utils
          .toArray<HTMLElement>('.destination-card')
          .filter((element) => element.offsetParent !== null);

        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        tl.to('.destinations-header', { y: 0, autoAlpha: 1, duration: 0.52 });

        if (viewer.length > 0) {
          tl.to(viewer, { y: 0, autoAlpha: 1, scale: 1, duration: 0.62 }, '-=0.18');
        }

        if (sidebarHeader.length > 0) {
          tl.to(
            sidebarHeader,
            { y: 0, autoAlpha: 1, duration: 0.38 },
            viewer.length > 0 ? '-=0.4' : '-=0.14',
          );
        }

        if (destinationCards.length > 0) {
          tl.to(
            destinationCards,
            { y: 0, autoAlpha: 1, duration: 0.36, stagger: 0.045 },
            '-=0.14',
          );
        }
      }, destinationsRef);
    };

    const isAlreadyVisible = section.getBoundingClientRect().top <= window.innerHeight * 0.88;
    if (isAlreadyVisible) {
      return;
    }

    setup = gsap.context(() => {
      const viewer = gsap.utils
        .toArray<HTMLElement>('.destinations-viewer')
        .filter((element) => element.offsetParent !== null);
      const sidebarHeader = gsap.utils
        .toArray<HTMLElement>('.destinations-sidebar-header')
        .filter((element) => element.offsetParent !== null);
      const destinationCards = gsap.utils
        .toArray<HTMLElement>('.destination-card')
        .filter((element) => element.offsetParent !== null);

      gsap.set('.destinations-header', { y: 22, autoAlpha: 0 });

      if (viewer.length > 0) {
        gsap.set(viewer, { y: 24, autoAlpha: 0, scale: 0.985 });
      }

      if (sidebarHeader.length > 0) {
        gsap.set(sidebarHeader, { y: 16, autoAlpha: 0 });
      }

      if (destinationCards.length > 0) {
        gsap.set(destinationCards, { y: 14, autoAlpha: 0 });
      }
    }, destinationsRef);

    if (typeof IntersectionObserver === 'undefined') {
      revealDestinations();
      return () => {
        ctx?.revert();
        setup?.revert();
      };
    }

    observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }

        revealDestinations();
        observer?.disconnect();
        observer = undefined;
      },
      {
        threshold: 0.01,
        rootMargin: '0px 0px -12% 0px',
      },
    );

    observer.observe(section);

    return () => {
      observer?.disconnect();
      ctx?.revert();
      setup?.revert();
    };
  }, []);

  async function handleAddDestination(destination: CuratedDestination) {
    if (addingDestinationId) {
      return;
    }

    setAddingDestinationId(destination.id);
    setActiveDestinationId(destination.id);

    try {
      const trip = await createTrip(
        {
          destination_text: destination.destinationText,
          start_date: destination.startDate,
          end_date: destination.endDate,
          budget_amount: destination.budgetAmount,
          budget_currency: destination.budgetCurrency,
          trip_type: destination.tripType,
          route_travel_mode: destination.routeTravelMode,
          editorial_route_id: destination.id,
        },
        crypto.randomUUID(),
      );

      let placeId: string | null = null;

      try {
        const place = await createPlace(
          {
            source: 'curated_destination',
            external_id: `${destination.id}-${trip.id}`,
            name: destination.name,
            category: 'destination',
            address_text: destination.destinationText,
            lat: destination.lat,
            lon: destination.lon,
            metadata: {
              country: destination.country,
              region: destination.region,
              summary: destination.summary,
              highlights: destination.highlights,
              seeded_image_url: destination.imageUrl,
            },
          },
          crypto.randomUUID(),
        );
        placeId = place.id;
      } catch {
        placeId = null;
      }

      await patchTripCoverPreference(trip.id, {
        placeId,
        placeLabel: destination.destinationText,
        placeLat: destination.lat,
        placeLng: destination.lon,
        photoId: null,
        fallbackImageUrl: destination.imageUrl,
      });

      const next = new URLSearchParams(searchParams);
      next.delete('page');
      setSearchParams(next, { replace: true });
      await queryClient.invalidateQueries({ queryKey: tripKeys.all });
      toast.success(`${destination.name} added to your trips`);
    } catch (mutationError) {
      if (isApiError(mutationError) && mutationError.status === 429) {
        toast.error('Too many requests. Wait a moment and try again.');
      } else if (isApiError(mutationError) && mutationError.status === 409) {
        toast.info('That trip draft already exists.');
      } else {
        toast.error('Could not add the destination right now.');
      }
    } finally {
      setAddingDestinationId(null);
    }
  }

  return (
    <WorkspacePage className="gap-2 !p-0 pb-10 md:pb-14 lg:!p-6">
      <header
        ref={heroRef}
        className="relative overflow-hidden px-4 py-12 md:px-8 md:py-16 lg:rounded-2xl lg:border lg:border-white/40 lg:bg-[linear-gradient(135deg,rgba(255,255,255,0.95)_0%,rgba(235,242,248,0.98)_100%)] lg:px-12 lg:py-16 lg:shadow-[0_20px_50px_rgba(30,41,59,0.04)]"
      >
        <img
          src="/images/trips/trips-hero.jpg"
          alt=""
          aria-hidden="true"
          loading="eager"
          className="hero-bg absolute inset-0 h-full w-full object-cover object-center opacity-0"
        />
        <div className="relative z-10 mx-auto max-w-4xl px-4 md:px-0">
          <div className="hero-shell flex flex-col items-center justify-center rounded-3xl border border-white/60 bg-white/40 px-6 py-10 text-center shadow-sm backdrop-blur-md md:px-12 md:py-14">
            <h1 className="hero-title max-w-[22ch] text-[2.2rem] leading-[1.05] font-bold tracking-tight text-[var(--color-text)] drop-shadow-sm sm:text-[2.6rem] md:text-[3.6rem]">
              Your next journey starts here.
            </h1>
            <p className="hero-desc mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-relaxed font-medium text-[var(--color-text)] drop-shadow-sm md:text-[1.15rem]">
              Organize your travel plans, draw inspiration from hand-picked global routes, and map
              out unforgettable itineraries with ease.
            </p>
            <div className="hero-actions mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                className="h-12 rounded-full px-7 text-[0.95rem] font-medium shadow-md transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98]"
              >
                <Link to="/app/trips/new">
                  <Plus className="mr-1.5 size-4" />
                  New trip
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="hidden h-12 rounded-full bg-white/50 px-7 text-[0.95rem] font-medium backdrop-blur-md transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98] sm:inline-flex"
              >
                <a href="#destinations">
                  Browse destinations
                  <ChevronRight className="ml-1 size-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {(isLoading || error || trips.length > 0) && (
        <section ref={boardRef} id="board" className="mt-12 scroll-mt-8 px-0 md:mt-16">
          <Carousel className="group/board">
            <div className="board-intro max-md:px-4">
              <SectionIntro
                eyebrow="Recently planned and upcoming"
                title="Trips worth opening again"
                action={
                  <div className="hidden md:flex">
                    <CarouselNavigation
                      alwaysShow={true}
                      className="relative top-auto left-auto inline-flex w-fit translate-y-0 justify-start gap-2 px-0"
                      classNameButton="h-9 w-9 p-0 flex items-center justify-center bg-white border border-[var(--color-border)]"
                    />
                  </div>
                }
              />
            </div>

            {error && (
              <Alert variant="destructive" className="board-alert mt-6">
                <AlertDescription>Failed to load trips. Please refresh the page.</AlertDescription>
              </Alert>
            )}

            {isLoading && (
              <CarouselContent className="mt-4 ml-0 py-2 sm:mt-6 sm:-ml-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <CarouselItem
                    key={i}
                    className="basis-[84%] pl-3 sm:basis-1/2 sm:pl-4 lg:basis-1/3 xl:basis-1/4"
                  >
                    <div className="overflow-hidden rounded-[20px] border border-white/70 bg-white">
                      <Skeleton className="aspect-[16/9] w-full rounded-none" />
                      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <Skeleton className="h-3.5 w-28 rounded-full" />
                        <Skeleton className="h-5 w-12 rounded-full" />
                      </div>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
            )}

            {!isLoading && trips.length > 0 && (
              <CarouselContent className="mt-4 ml-0 py-2 sm:mt-6 sm:-ml-4">
                {trips.map((trip) => (
                  <CarouselItem
                    key={trip.id}
                    className="board-card basis-[84%] pl-3 sm:basis-1/2 sm:pl-4 lg:basis-1/3 xl:basis-1/4"
                  >
                    <TripCard
                      trip={trip}
                      cover={tripCovers.get(trip.id) ?? { url: null, isFallback: true }}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
            )}
          </Carousel>
        </section>
      )}

      <section ref={destinationsRef} id="destinations" className="mt-12 scroll-mt-8 md:mt-16">
        <div className="destinations-header flex flex-col gap-5 px-4 md:flex-row md:items-end md:justify-between lg:px-0">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[0.75rem] font-bold tracking-[0.2em] text-[var(--color-primary)] uppercase opacity-80">
                Curated destinations
              </p>
            </div>
            <h2 className="mt-1.5 text-[1.8rem] leading-[1.1] font-bold tracking-tight text-[var(--color-text)] md:text-[2.2rem]">
              Explore the world map
            </h2>
          </div>

          <div className="hidden w-full rounded-full border border-[var(--color-border)] bg-[var(--color-secondary-surface)] p-1.5 md:w-auto lg:flex">
            <AnimatedBackground
              defaultValue={activeTab}
              className="rounded-[40px] bg-black"
              transition={{
                type: 'spring',
                bounce: 0.2,
                duration: 0.5,
              }}
              onValueChange={(id) => setActiveTab(id as 'map' | 'info')}
            >
              {[
                { id: 'map', label: 'Map view', icon: Map },
                { id: 'info', label: 'Trip info', icon: Compass },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  data-id={id}
                  type="button"
                  className={cn(
                    'flex flex-1 items-center justify-center rounded-[40px] px-4 py-2 transition-colors md:flex-none md:py-1.5',
                    activeTab === id
                      ? 'text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                  )}
                  aria-pressed={activeTab === id}
                >
                  <div className="flex flex-row items-center justify-center gap-1.5">
                    <Icon className="size-4" strokeWidth={activeTab === id ? 2.5 : 2} />
                    <span className="text-[0.75rem] font-semibold tracking-[-0.01em]">{label}</span>
                  </div>
                </button>
              ))}
            </AnimatedBackground>
          </div>
        </div>

        <div className="mt-4 border-y-0 border-[var(--color-border)] bg-transparent md:mt-8 lg:overflow-hidden lg:rounded-xl lg:border lg:border-[var(--color-border-strong)] lg:bg-white">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="destinations-viewer relative hidden h-[17rem] overflow-hidden bg-white md:h-[30rem] lg:block lg:h-[34rem]">
              {activeTab === 'map' ? (
                <div className="h-full w-full">
                  {shouldRenderDestinationMap ? (
                    <WorldExplorerMap
                      destinations={CURATED_DESTINATIONS}
                      activeDestinationId={
                        activeDestination?.id ?? CURATED_DESTINATIONS[0]?.id ?? ''
                      }
                      onSelect={setActiveDestinationId}
                    />
                  ) : (
                    <WorldExplorerMapPreview destination={activeDestination} />
                  )}
                </div>
              ) : activeDestination ? (
                <div
                  ref={detailsPanelRef}
                  className="h-full overflow-y-auto overscroll-y-contain p-3.5 pt-4 lg:p-10 lg:pt-20"
                >
                  <div className="destination-meta mb-2.5 flex flex-wrap items-center gap-1.5 md:mb-3 md:gap-2">
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-2.5 py-0.5 text-[0.6rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)] uppercase md:px-3 md:py-1 md:text-[0.65rem]">
                      {activeDestination.region}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-2.5 py-0.5 text-[0.6rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)] uppercase md:px-3 md:py-1 md:text-[0.65rem]">
                      {activeDestination.bestFor}
                    </span>
                  </div>
                  <h3 className="destination-title text-[1.28rem] leading-[1.08] font-semibold tracking-[-0.04em] text-[var(--color-text)] md:text-[2.2rem]">
                    {activeDestination.name}
                  </h3>
                  <p className="destination-teaser mt-1.5 text-[0.82rem] leading-5 text-[var(--color-text-muted)] md:mt-2 md:text-[1rem] md:leading-7">
                    {activeDestination.teaser}
                  </p>

                  <div className="destination-stats mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:mt-8 md:gap-3">
                    <div className="destination-stat rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] p-2.5 md:rounded-[16px] md:p-4">
                      <CalendarDays className="mb-1 size-3.5 text-[var(--color-text-muted)] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)] uppercase">
                        Dates
                      </p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">
                        {formatTripDates(activeDestination.startDate, activeDestination.endDate)}
                      </p>
                    </div>
                    <div className="destination-stat rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] p-2.5 md:rounded-[16px] md:p-4">
                      <Compass className="mb-1 size-3.5 text-[var(--color-text-muted)] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)] uppercase">
                        Budget
                      </p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">
                        {formatBudget(
                          activeDestination.budgetAmount,
                          activeDestination.budgetCurrency,
                        )}
                      </p>
                    </div>
                    <div className="destination-stat col-span-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] p-2.5 sm:col-span-1 md:rounded-[16px] md:p-4">
                      <Route className="mb-1 size-3.5 text-[var(--color-text-muted)] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)] uppercase">
                        Travel
                      </p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">
                        {formatTravelModeLabel(activeDestination.routeTravelMode)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 md:mt-8">
                    <p className="destination-highlights-heading mb-2 text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase md:mb-3">
                      Highlights
                    </p>
                    <ul className="flex flex-wrap gap-1.5 md:gap-2">
                      {activeDestination.highlights.map((highlight) => (
                        <li
                          key={highlight}
                          className="destination-highlight rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[0.72rem] text-[var(--color-text-muted)] md:px-3 md:py-1.5 md:text-[0.78rem]"
                        >
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="destination-summary mt-4 border-t border-[var(--color-border)] pt-4 md:mt-8 md:pt-8">
                    <p className="[display:-webkit-box] overflow-hidden pb-2 text-[0.8rem] leading-5 text-[var(--color-text-muted)] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] md:[display:block] md:pb-10 md:text-[0.92rem] md:leading-7 md:[-webkit-line-clamp:unset]">
                      {activeDestination.summary}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 pt-4 lg:p-10 lg:pt-20">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    No destination details are available right now.
                  </p>
                </div>
              )}
            </div>

            <aside className="flex flex-col lg:h-[34rem] lg:border-t-0 lg:border-l lg:border-[var(--color-border-strong)] lg:bg-[var(--color-secondary-surface)]">
              <div className="destinations-sidebar-header flex shrink-0 items-center justify-between border-b-0 border-[var(--color-border)] bg-transparent px-4 py-3 lg:border-b lg:bg-[var(--color-secondary-surface)]">
                <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
                  {CURATED_DESTINATIONS.length} editorial routes
                </p>
              </div>

              <div className="relative flex-1 overflow-y-visible bg-transparent lg:bg-[var(--color-secondary-surface)]">
                <div className="flex flex-col gap-2 px-4 py-3 lg:gap-2 lg:p-3">
                  {CURATED_DESTINATIONS.map((destination) => (
                    <DestinationListCard
                      key={destination.id}
                      destination={destination}
                      selected={destination.id === activeDestinationId}
                      onSelect={() => setActiveDestinationId(destination.id)}
                      onAdd={() => {
                        void handleAddDestination(destination);
                      }}
                      isAdding={addingDestinationId === destination.id}
                    />
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <footer className="mt-8 overflow-hidden border-t border-[var(--color-border)] bg-white px-6 py-10 md:mt-12 lg:rounded-[24px] lg:border lg:border-white/75 lg:bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(242,247,251,0.92))] lg:px-8 lg:py-10">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2.7fr)] lg:gap-16">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-cta)] text-white">
                <VoyagerLogo className="size-[1rem] translate-y-[1px]" />
              </span>
              <span className="text-[1.05rem] font-semibold tracking-[-0.04em] text-[var(--color-text)]">
                Voyager
              </span>
            </div>
            <p className="mt-4 max-w-[28ch] text-[0.86rem] leading-6 text-[var(--color-text-muted)]">
              AI-powered travel planning. Build itineraries, scout destinations, manage every trip
              in one place.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild className="h-9 rounded-full px-4 text-[0.82rem]">
                <Link to="/app/trips/new">
                  <Plus className="size-3.5" />
                  New trip
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-9 rounded-full px-4 text-[0.82rem]">
                <Link to="/app/settings">
                  Settings
                  <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {[
              {
                label: 'Hotels',
                links: [
                  { label: 'Booking.com', href: 'https://booking.com' },
                  { label: 'Airbnb', href: 'https://airbnb.com' },
                  { label: 'Hostelworld', href: 'https://hostelworld.com' },
                ],
              },
              {
                label: 'Flights',
                links: [
                  { label: 'Skyscanner', href: 'https://skyscanner.com' },
                  { label: 'Google Flights', href: 'https://flights.google.com' },
                  { label: 'Kayak', href: 'https://kayak.com' },
                ],
              },
              {
                label: 'Trains & Buses',
                links: [
                  { label: 'Rome2Rio', href: 'https://rome2rio.com' },
                  { label: 'Trainline', href: 'https://thetrainline.com' },
                  { label: 'Omio', href: 'https://omio.com' },
                ],
              },
              {
                label: 'Weather & Tools',
                links: [
                  { label: 'Windy', href: 'https://windy.com' },
                  { label: 'XE Currency', href: 'https://xe.com' },
                  { label: 'Numbeo', href: 'https://numbeo.com' },
                ],
              },
            ].map(({ label, links }) => (
              <div key={label}>
                <p className="mb-4 text-[0.64rem] font-semibold tracking-[0.22em] text-[var(--color-text-muted)] uppercase">
                  {label}
                </p>
                <ul className="flex flex-col gap-2.5">
                  {links.map(({ label: linkLabel, href }) => (
                    <li key={linkLabel}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/link flex items-center gap-1 text-[0.82rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                      >
                        {linkLabel}
                        <ArrowUpRight className="size-2.5 opacity-0 transition-opacity group-hover/link:opacity-60" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 h-px w-full bg-[var(--color-border-strong)]" />

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
            &copy; {new Date().getFullYear()} Voyager. All rights reserved.
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link
              to="/privacy"
              className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              Terms of Service
            </Link>
            <Link
              to="/cookies"
              className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              Cookie Policy
            </Link>
          </nav>
        </div>
      </footer>
    </WorkspacePage>
  );
}

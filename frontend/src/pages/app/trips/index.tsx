import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { tripKeys, useTrips } from '@/entities/trip/queries'
import { createTrip } from '@/entities/trip/api'
import { createPlace } from '@/entities/place/api'
import { mergeTripCoverPhotoPreference } from '@/entities/trip/cover-photo'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Compass,
  Map,
  Plus,
  Route,
  Sparkles,
} from 'lucide-react'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import { differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AnimatedBackground } from '@/components/ui/animated-background'
import { Carousel, CarouselContent, CarouselItem, CarouselNavigation } from '@/components/ui/carousel'
import { ProgressiveBlur } from '@/components/ui/progressive-blur'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { isApiError } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import type { Trip } from '@/shared/api/types'
import { GoogleMapCanvas, MapFitBounds, VoyagerMarker } from '@/shared/layouts/google-maps'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useTripListCoverPhotos, type TripCardCover } from './useTripListCoverPhotos'
import {
  CURATED_DESTINATIONS,
  type CuratedDestination,
} from './curated-destinations'

function formatTripDates(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return 'Dates flexible'
  }

  if (startDate && endDate) {
    const start = parseISO(startDate)
    const end = parseISO(endDate)

    if (format(start, 'yyyy') === format(end, 'yyyy')) {
      if (format(start, 'MMM') === format(end, 'MMM')) {
        return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`
      }

      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`
    }

    return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`
  }

  return format(parseISO(startDate ?? endDate!), 'MMM d, yyyy')
}

function getTripLengthLabel(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) {
    return null
  }

  const totalDays = differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1
  return (
    <>
      <AnimatedNumber value={totalDays} />
      {' '}
      {totalDays === 1 ? 'day' : 'days'}
    </>
  )
}

function getTripTimingLabel(startDate?: string | null, endDate?: string | null) {
  if (!startDate) {
    return 'Plan in progress'
  }

  const today = startOfDay(new Date())
  const tripStart = startOfDay(parseISO(startDate))
  const tripEnd = endDate ? startOfDay(parseISO(endDate)) : tripStart
  const daysUntilStart = differenceInCalendarDays(tripStart, today)
  const daysUntilEnd = differenceInCalendarDays(tripEnd, today)

  if (daysUntilStart > 1) {
    return (
      <>
        In <AnimatedNumber value={daysUntilStart} /> days
      </>
    )
  }

  if (daysUntilStart === 1) {
    return 'Tomorrow'
  }

  if (daysUntilStart === 0) {
    return 'Today'
  }

  if (daysUntilEnd >= 0) {
    return 'Happening now'
  }

  return 'Completed'
}

function formatBudget(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatTravelModeLabel(mode: CuratedDestination['routeTravelMode']) {
  return mode.charAt(0) + mode.slice(1).toLowerCase()
}

function getTripShareBadge(trip: Trip) {
  if (trip.current_user_role === 'editor') {
    return {
      label: 'Editor',
      detail: 'Shared access',
      variant: 'accent' as const,
    }
  }

  if (trip.collaborator_count > 0) {
    return {
      label: 'Shared',
      detail: `${trip.collaborator_count} ${trip.collaborator_count === 1 ? 'editor' : 'editors'}`,
      variant: 'outline' as const,
    }
  }

  return null
}

function getDestinationPoint(destination: CuratedDestination) {
  return {
    lat: destination.lat,
    lng: destination.lon,
  }
}

function SectionIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-2 text-[1.5rem] font-semibold leading-none tracking-[-0.05em] text-[var(--color-text)] md:text-[2rem]">
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
  )
}

function TripCard({
  trip,
  cover,
}: {
  trip: Trip
  cover: TripCardCover
}) {
  const tripLengthLabel = getTripLengthLabel(trip.start_date, trip.end_date)
  const timingLabel = getTripTimingLabel(trip.start_date, trip.end_date)
  const dateLabel = formatTripDates(trip.start_date, trip.end_date)
  const shareBadge = getTripShareBadge(trip)

  return (
    <Link to={`/app/trips/${trip.id}`} className="block group" draggable={false}>
      <article className="overflow-hidden rounded-[20px] border border-white/70 bg-white transition-all duration-300 group-hover:-translate-y-0.5 ">
        <div className="relative aspect-[16/9] overflow-hidden bg-[linear-gradient(135deg,#b8cfe8_0%,#8aafc9_100%)]">
          {cover.url && (
            <img
              src={cover.url}
              alt={trip.destination_text}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              loading="lazy"
              draggable={false}
            />
          )}
          {cover.url ? (
            <ProgressiveBlur
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%]"
              blurIntensity={0.9}
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,18,0.0)_0%,rgba(7,12,18,0.12)_40%,rgba(7,12,18,0.78)_100%)]" />

          <div className="absolute left-3 top-3">
            <span className="rounded-full border border-white/50 bg-[rgba(255,244,236,0.9)] px-2.5 py-[3px] text-[0.65rem] font-semibold tracking-[0.02em] text-[#c96541] shadow-sm">
              {timingLabel}
            </span>
          </div>

          {shareBadge ? (
            <div className="absolute right-3 top-3">
              <Badge variant={shareBadge.variant}>{shareBadge.label}</Badge>
            </div>
          ) : null}

          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
            <h3 className="line-clamp-2 text-[1.15rem] font-semibold leading-[1.1] tracking-[-0.04em] text-white drop-shadow-sm">
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
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
              <span className="truncate text-[0.78rem] text-[#64748b]">{dateLabel}</span>
            </div>
            {shareBadge ? (
              <span className="text-[0.74rem] font-medium text-[#7a8796]">
                {shareBadge.detail}
              </span>
            ) : null}
          </div>
          {tripLengthLabel && (
            <span className="shrink-0 rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[0.7rem] font-medium text-[#64748b]">
              {tripLengthLabel}
            </span>
          )}
        </div>
      </article>
    </Link>
  )
}

function WorldExplorerMap({
  destinations,
  activeDestinationId,
  onSelect,
}: {
  destinations: CuratedDestination[]
  activeDestinationId: string
  onSelect: (destinationId: string) => void
}) {
  const activeDestination =
    destinations.find((destination) => destination.id === activeDestinationId) ?? destinations[0]
  const destinationPoints = destinations.map(getDestinationPoint)

  if (!config.map.apiKey) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#d7e8f3_0%,#edf5fa_100%)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.84),transparent_22%),radial-gradient(circle_at_78%_28%,rgba(114,174,230,0.18),transparent_24%)]" />
        <div className="relative flex h-full flex-col justify-between p-5">
          <div className="max-w-sm rounded-[20px] border border-white/70 bg-white/74 px-4 py-3 text-[#17344c] shadow-[0_16px_34px_-24px_rgba(24,42,62,0.32)] backdrop-blur-md">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7a8a9b]">
              Live explorer
            </p>
            <p className="mt-2 text-sm leading-6 text-[#4d5c6c]">
              A Google Maps API key is required to render the live explorer map on this page.
            </p>
          </div>
          {activeDestination ? (
            <div className="max-w-md rounded-[20px] border border-white/70 bg-white/74 px-4 py-4 text-[#17344c] shadow-[0_16px_34px_-24px_rgba(24,42,62,0.32)] backdrop-blur-md">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[#7a8a9b]">
                Selected destination
              </p>
              <h3 className="mt-2 text-[1.25rem] font-semibold tracking-[-0.04em]">
                {activeDestination.destinationText}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#4d5c6c]">
                Add `VITE_GOOGLE_MAPS_API_KEY` to switch this panel to a live map.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#dceaf2]">
      <GoogleMapCanvas
        defaultCenter={{ lat: 24, lng: 10 }}
        defaultZoom={2}
        minZoom={2}
        maxZoom={6}
        restriction={{
          latLngBounds: { north: 85, south: -85, west: -179.99, east: 179.99 },
          strictBounds: true,
        }}
        reuseMaps={false}
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
          const isActive = destination.id === activeDestinationId

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
                  <span className="rounded-full border border-white/22 bg-[rgba(15,26,39,0.78)] px-3 py-1 text-[0.7rem] font-medium text-white shadow-[0_10px_24px_rgba(8,18,32,0.28)] backdrop-blur-md">
                    {destination.name}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'relative flex items-center justify-center rounded-full border-2 border-white shadow-[0_10px_24px_rgba(8,18,32,0.22)] transition-all duration-200',
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
          )
        })}
      </GoogleMapCanvas>

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.02)_24%,rgba(14,29,44,0.08)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-[linear-gradient(180deg,rgba(220,234,242,0.0),rgba(220,234,242,0.82))]" />

      <div className="absolute right-4 top-4 z-20 rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-[0.72rem] font-medium text-[#4d5c6c] shadow-[0_16px_34px_-26px_rgba(24,42,62,0.3)] backdrop-blur-md">
        {destinations.length}
        {' '}
        live markers
      </div>
    </div>
  )
}

function DestinationListCard({
  destination,
  selected,
  onSelect,
  onAdd,
  isAdding,
}: {
  destination: CuratedDestination
  selected: boolean
  onSelect: () => void
  onAdd: () => void
  isAdding: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition-colors lg:rounded-[14px] lg:px-3 lg:py-2.5',
        selected
          ? 'bg-[#f8fafc] shadow-[0_8px_24px_-16px_rgba(24,42,62,0.22)] lg:border-[#cfdbe6] lg:bg-white'
          : 'border-transparent bg-white hover:bg-[#f9fbfd] lg:border-transparent lg:bg-transparent lg:hover:border-[#dbe4ec] lg:hover:bg-white',
      )}
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
          className="h-full w-full object-cover mix-blend-luminosity opacity-90"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.82rem] font-medium text-[var(--color-text)]">
          {destination.name}
        </p>
        <p className="truncate text-[0.72rem] text-[#7a8796]">{destination.country}</p>
      </div>
      {selected && (
        <Button
          type="button"
          className="h-7 shrink-0 rounded-full px-3 text-[0.72rem]"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          disabled={isAdding}
        >
          <Plus className="size-3" />
          {isAdding ? 'Adding…' : 'Add'}
        </Button>
      )}
    </button>
  )
}

export default function TripsPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, error } = useTrips({ limit: 100, offset: 0 })
  const trips = data?.items ?? []
  const tripCovers = useTripListCoverPhotos(trips)
  const [activeDestinationId, setActiveDestinationId] = useState(
    CURATED_DESTINATIONS[0]?.id ?? '',
  )
  const [addingDestinationId, setAddingDestinationId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'map' | 'info'>('map')

  const activeDestination =
    CURATED_DESTINATIONS.find((destination) => destination.id === activeDestinationId) ??
    CURATED_DESTINATIONS[0]

  async function handleAddDestination(destination: CuratedDestination) {
    if (addingDestinationId) {
      return
    }

    setAddingDestinationId(destination.id)
    setActiveDestinationId(destination.id)

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
      )

      let placeId: string | null = null

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
        )
        placeId = place.id
      } catch {
        placeId = null
      }

      mergeTripCoverPhotoPreference(trip.id, {
        placeId,
        placeLabel: destination.destinationText,
        placeLat: destination.lat,
        placeLng: destination.lon,
        photoId: null,
        googlePhotoUrl: destination.imageUrl,
      })

      const next = new URLSearchParams(searchParams)
      next.delete('page')
      setSearchParams(next, { replace: true })
      await queryClient.invalidateQueries({ queryKey: tripKeys.all })
      toast.success(`${destination.name} added to your trips`)
    } catch (mutationError) {
      if (isApiError(mutationError) && mutationError.status === 429) {
        toast.error('Too many requests. Wait a moment and try again.')
      } else if (isApiError(mutationError) && mutationError.status === 409) {
        toast.info('That trip draft already exists.')
      } else {
        toast.error('Could not add the destination right now.')
      }
    } finally {
      setAddingDestinationId(null)
    }
  }

  return (
    <WorkspacePage className="!p-0 lg:!p-6 gap-6 md:gap-8 pb-10 md:pb-14 lg:gap-10">
      <header className="relative overflow-hidden lg:rounded-2xl lg:border border-white/75 px-4 py-8 md:px-6 md:py-6">
        <img
          src="/images/trips/trips-hero.jpg"
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-50 mix-blend-luminosity"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.65)_0%,rgba(243,247,251,0.95)_100%)]" />
        <div className="relative">
          <div className="flex flex-col items-center justify-center text-center py-6 md:py-10">
            <h1 className="text-[2rem] sm:text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.06em] text-[var(--color-text)] md:text-[3.2rem] max-w-[25ch]">
              Your trips, curated routes, and the world map.
            </h1>
            <p className="mt-4 max-w-[55ch] text-[0.95rem] md:text-[1rem] leading-7 text-[var(--color-text-muted)] mx-auto">
              Keep recent trips close, instantly drop proposed destinations into your collection, and explore the map to find your next great itinerary.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="h-11 rounded-full px-6 text-[0.95rem]">
                <Link to="/app/trips/new">
                  <Plus className="mr-1.5 size-4" />
                  New trip
                </Link>
              </Button>
              <Button asChild variant="outline" className="hidden h-11 rounded-full px-6 text-[0.95rem] sm:inline-flex">
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
      <section id="board" className="mt-8 scroll-mt-6 md:mt-10 px-0">
        <Carousel className="animate-in fade-in slide-in-from-bottom-4 duration-300 group/board">
          <div className="px-4">
            <SectionIntro
              eyebrow="Recently planned and upcoming"
              title="Trips worth opening again"
            />

            <div className="mt-3 hidden md:flex md:justify-center lg:justify-end">
              <CarouselNavigation
                alwaysShow={true}
                className="relative left-auto top-auto inline-flex w-fit translate-y-0 justify-start gap-2 px-0"
                classNameButton="h-9 w-9 p-0 flex items-center justify-center bg-white shadow-sm border border-[#dce6ef]"
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>Failed to load trips. Please refresh the page.</AlertDescription>
            </Alert>
          )}

          {!isLoading && trips.length > 0 && (
            <CarouselContent className="mt-4 ml-0 py-2 sm:mt-6 sm:-ml-4">
              {trips.map((trip) => (
                <CarouselItem key={trip.id} className="pl-3 basis-[84%] sm:pl-4 sm:basis-1/2 lg:basis-1/3 xl:basis-1/4">
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

      {/* ─── Unified Destinations Section ─────────────────────────────────── */}
      <section
        id="destinations"
        className="mt-8 md:mt-10 scroll-mt-6 lg:overflow-hidden lg:rounded-xl lg:border border-white/75 lg:bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(242,247,251,0.92))] px-0 lg:px-6 lg:py-6 lg:shadow-sm"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-4 lg:px-0">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">
                Curated destinations
              </p>
            </div>
            <h2 className="mt-1 text-[1.5rem] font-semibold leading-none tracking-[-0.05em] text-[var(--color-text)] md:text-[2rem]">
              Explore the world map
            </h2>
          </div>

          <div className="hidden w-full rounded-[14px] border border-black/5 bg-black/5 p-1 md:w-auto lg:flex">
            <AnimatedBackground
              defaultValue={activeTab}
              className="rounded-[10px] bg-black shadow-sm"
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
                    'flex flex-1 items-center justify-center rounded-[10px] px-4 py-2 transition-colors md:flex-none md:py-1.5',
                    activeTab === id ? 'text-white' : 'text-[#6f7d8d] hover:text-black',
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

        <div className="mt-4 border-y-0 border-[#dce5ed] bg-transparent md:mt-8 lg:overflow-hidden lg:rounded-xl lg:border lg:border-[#d8e0e8] lg:bg-white lg:shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Map or Info Area */}
            <div className="relative hidden h-[17rem] overflow-y-auto bg-white md:h-[30rem] lg:block lg:h-[34rem]">

              {activeTab === 'map' ? (
                <div className="h-full w-full">
                  <WorldExplorerMap
                    destinations={CURATED_DESTINATIONS}
                    activeDestinationId={activeDestination?.id ?? CURATED_DESTINATIONS[0]?.id ?? ''}
                    onSelect={setActiveDestinationId}
                  />
                </div>
              ) : (
                <div className="p-3.5 pt-4 lg:p-10 lg:pt-20">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5 md:mb-3 md:gap-2">
                    <span className="rounded-full border border-[#dce5ed] bg-[#f8fafc] px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-[#6f7d8d] md:px-3 md:py-1 md:text-[0.65rem]">
                      {activeDestination.region}
                    </span>
                    <span className="rounded-full border border-[#dce5ed] bg-[#f8fafc] px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-[#6f7d8d] md:px-3 md:py-1 md:text-[0.65rem]">
                      {activeDestination.bestFor}
                    </span>
                  </div>
                  <h3 className="text-[1.28rem] font-semibold leading-[1.08] tracking-[-0.04em] text-[var(--color-text)] md:text-[2.2rem]">
                    {activeDestination.name}
                  </h3>
                  <p className="mt-1.5 text-[0.82rem] leading-5 text-[#556171] md:mt-2 md:text-[1rem] md:leading-7">
                    {activeDestination.teaser}
                  </p>
                  
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:mt-8 md:gap-3">
                    <div className="rounded-[12px] bg-[#f8fafc] border border-[#e8eef4] p-2.5 md:rounded-[16px] md:p-4">
                      <CalendarDays className="mb-1 size-3.5 text-[#8b97a7] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[#8b97a7]">Dates</p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">{formatTripDates(activeDestination.startDate, activeDestination.endDate)}</p>
                    </div>
                    <div className="rounded-[12px] bg-[#f8fafc] border border-[#e8eef4] p-2.5 md:rounded-[16px] md:p-4">
                      <Compass className="mb-1 size-3.5 text-[#8b97a7] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[#8b97a7]">Budget</p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">{formatBudget(activeDestination.budgetAmount, activeDestination.budgetCurrency)}</p>
                    </div>
                    <div className="col-span-2 rounded-[12px] bg-[#f8fafc] border border-[#e8eef4] p-2.5 sm:col-span-1 md:rounded-[16px] md:p-4">
                      <Route className="mb-1 size-3.5 text-[#8b97a7] md:mb-2 md:size-4" />
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[#8b97a7]">Travel</p>
                      <p className="mt-0.5 text-[0.78rem] font-medium text-[var(--color-text)] md:mt-1 md:text-[0.85rem]">{formatTravelModeLabel(activeDestination.routeTravelMode)}</p>
                    </div>
                  </div>

                  <div className="mt-5 md:mt-8">
                    <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#8b97a7] md:mb-3">Highlights</p>
                    <ul className="flex flex-wrap gap-1.5 md:gap-2">
                      {activeDestination.highlights.map((highlight) => (
                        <li key={highlight} className="rounded-full border border-[#dce5ed] bg-white px-2.5 py-1 text-[0.72rem] text-[#4d5c6c] shadow-sm md:px-3 md:py-1.5 md:text-[0.78rem]">
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="mt-4 border-t border-[#e8eef4] pt-4 md:mt-8 md:pt-8">
                    <p className="pb-2 text-[0.8rem] leading-5 text-[#556171] overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] md:pb-10 md:text-[0.92rem] md:leading-7 md:[display:block] md:[-webkit-line-clamp:unset]">
                      {activeDestination.summary}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Destination list sidebar */}
            <aside className="flex flex-col lg:h-[34rem] lg:border-l lg:border-t-0 lg:border-[#d8e0e8] lg:bg-[#f8fafc]">
              {/* Sidebar header */}
              <div className="flex shrink-0 items-center justify-between border-b-0 border-[#e8eef4] bg-transparent px-4 py-3 lg:border-b lg:bg-[#f8fafc]">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#8b97a7]">
                  {CURATED_DESTINATIONS.length} editorial routes
                </p>
              </div>

              {/* Scrollable card list */}
              <div className="relative flex-1 overflow-y-visible bg-transparent lg:overflow-y-auto lg:bg-[#f8fafc]">
                <div className="flex flex-col gap-2 px-4 py-3 lg:gap-2 lg:p-3">
                  {CURATED_DESTINATIONS.map((destination) => (
                    <DestinationListCard
                      key={destination.id}
                      destination={destination}
                      selected={destination.id === activeDestinationId}
                      onSelect={() => setActiveDestinationId(destination.id)}
                      onAdd={() => {
                        void handleAddDestination(destination)
                      }}
                      isAdding={addingDestinationId === destination.id}
                    />
                  ))}
                </div>

                {/* Bottom fade */}
                <div className="pointer-events-none sticky bottom-0 hidden h-6 bg-[linear-gradient(to_top,#f8fafc,transparent)] lg:block" />
              </div>
            </aside>
          </div>
        </div>
      </section>

      <footer className="mt-8 md:mt-12 overflow-hidden lg:rounded-[24px] border-t lg:border border-[#e2e8f0] lg:border-white/75 bg-white lg:bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(242,247,251,0.92))] px-6 py-10 lg:px-8 lg:py-10 lg:shadow-[0_16px_40px_-24px_rgba(24,42,62,0.2)]">
        {/* Brand + link columns */}
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2.7fr)] lg:gap-16">
          {/* Brand column */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-cta)] text-white shadow-sm">
                <VoyagerLogo className="size-[1rem] translate-y-[1px]" />
              </span>
              <span className="text-[1.05rem] font-semibold tracking-[-0.04em] text-[var(--color-text)]">Voyager</span>
            </div>
            <p className="mt-4 max-w-[28ch] text-[0.86rem] leading-6 text-[var(--color-text-muted)]">
              AI-powered travel planning. Build itineraries, scout destinations, manage every trip in one place.
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

          {/* Link columns */}
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
                <p className="mb-4 text-[0.64rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">
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

        {/* Divider */}
        <div className="mt-10 h-px w-full bg-[var(--color-border-strong)]" />

        {/* Bottom bar */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
            &copy; {new Date().getFullYear()} Voyager. All rights reserved.
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">Privacy Policy</Link>
            <Link to="/terms" className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">Terms of Service</Link>
            <Link to="/cookies" className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">Cookie Policy</Link>
            <Link to="/imprint" className="text-[0.75rem] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">Imprint</Link>
          </nav>
        </div>
      </footer>
    </WorkspacePage>
  )
}

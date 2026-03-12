import { Link, useSearchParams } from 'react-router-dom'
import { useTrips } from '@/entities/trip/queries'
import { TRIP_LIST_PAGE_SIZE } from '@/entities/trip/constants'
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { Trip } from '@/shared/api/types'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useTripListCoverPhotos, type TripCardCover } from './useTripListCoverPhotos'

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
  return `${totalDays} ${totalDays === 1 ? 'day' : 'days'}`
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
    return `In ${daysUntilStart} days`
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

  return (
    <Link to={`/app/trips/${trip.id}`} className="block group">
      <article className="overflow-hidden rounded-[20px] border border-white/70 bg-white shadow-[0_16px_40px_-28px_rgba(24,42,62,0.26)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_22px_50px_-28px_rgba(24,42,62,0.34)]">
        <div className="relative aspect-[16/9] overflow-hidden bg-[linear-gradient(135deg,#b8cfe8_0%,#8aafc9_100%)]">
          {cover.url && (
            <img
              src={cover.url}
              alt={trip.destination_text}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,18,0.0)_0%,rgba(7,12,18,0.12)_40%,rgba(7,12,18,0.78)_100%)]" />

          <div className="absolute left-3 top-3">
            <span className="rounded-full border border-white/50 bg-[rgba(255,244,236,0.9)] px-2.5 py-[3px] text-[0.65rem] font-semibold tracking-[0.02em] text-[#c96541] shadow-sm">
              {timingLabel}
            </span>
          </div>

          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
            <h2 className="line-clamp-2 text-[1.15rem] font-semibold leading-[1.1] tracking-[-0.04em] text-white drop-shadow-sm">
              {trip.title}
            </h2>
            <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/20 p-1.5 text-white backdrop-blur-sm transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
            <span className="truncate text-[0.78rem] text-[#64748b]">{dateLabel}</span>
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

function TripSkeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] border border-white/70 bg-white shadow-[0_16px_40px_-28px_rgba(24,42,62,0.22)]">
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <Skeleton className="h-4 w-28 rounded-full" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
    </div>
  )
}

export default function TripsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const offset = (currentPage - 1) * TRIP_LIST_PAGE_SIZE
  const { data, isLoading, isFetching, error } = useTrips({ limit: TRIP_LIST_PAGE_SIZE, offset })
  const trips = data?.items ?? []
  const showSkeleton = useDelayedLoading(isLoading, 250)
  const tripCovers = useTripListCoverPhotos(trips)
  const totalItems = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / TRIP_LIST_PAGE_SIZE))

  function updatePage(page: number) {
    const next = new URLSearchParams(searchParams)
    if (page <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(page))
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <WorkspacePage className="gap-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">
            Recently planned and upcoming
          </p>
          <h1 className="mt-3 text-[2.2rem] font-semibold leading-none tracking-[-0.06em] text-[var(--color-text)] md:text-[2.8rem]">
            Trips worth opening again
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)] md:text-[0.98rem]">
            A visual board for current itineraries, budgets, and destinations.
          </p>
        </div>

        <Button
          asChild
          className="h-11 rounded-full px-5 text-[0.95rem] font-medium shadow-[0_16px_36px_-24px_rgba(26,22,21,0.45)] hover:shadow-[0_20px_42px_-24px_rgba(26,22,21,0.5)]"
        >
          <Link to="/app/trips/new">
            <Plus data-icon="inline-start" />
            New trip
          </Link>
        </Button>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load trips. Please refresh the page.</AlertDescription>
        </Alert>
      )}

      {showSkeleton && (
        <div className="grid animate-in gap-4 fade-in duration-300 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">  
          {Array.from({ length: 6 }).map((_, i) => (
            <TripSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && trips.length === 0 && !error && (
        <section className="animate-in overflow-hidden rounded-[30px] border border-[#dce6ef] bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(246,250,253,0.92))] px-6 py-8 shadow-[0_28px_76px_-40px_rgba(24,42,62,0.26)] fade-in slide-in-from-bottom-4 duration-300 md:px-8 md:py-10">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8b97a7]">
            Your archive starts here
          </p>
          <h2 className="mt-3 text-[1.8rem] font-semibold tracking-[-0.05em] text-[var(--color-text)]">
            No trips yet
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-muted)] md:text-[0.98rem]">
            Create a trip to start building destination cards with dates, budgets, and city imagery.
          </p>
          <Button asChild className="mt-6 h-11 rounded-full px-5 text-[0.95rem] font-medium shadow-[0_16px_36px_-24px_rgba(26,22,21,0.45)] hover:shadow-[0_20px_42px_-24px_rgba(26,22,21,0.5)]">
            <Link to="/app/trips/new">
              <Plus data-icon="inline-start" />
              New trip
            </Link>
          </Button>
        </section>
      )}

      {!isLoading && trips.length > 0 && (
        <div className="grid animate-in gap-4 fade-in slide-in-from-bottom-4 duration-300 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              cover={tripCovers.get(trip.id) ?? { url: null, isFallback: true }}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pb-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[8px] border-black/8 bg-transparent px-2.5 shadow-none"
            onClick={() => updatePage(currentPage - 1)}
            disabled={currentPage <= 1 || isFetching}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="min-w-[3.5rem] text-center text-[0.78rem] font-medium text-[#5f6b7a]">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[8px] border-black/8 bg-transparent px-2.5 shadow-none"
            onClick={() => updatePage(currentPage + 1)}
            disabled={currentPage >= totalPages || isFetching}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </WorkspacePage>
  )
}

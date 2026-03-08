import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTrips } from '@/entities/trip/queries'
import { TRIP_LIST_PAGE_SIZE } from '@/entities/trip/constants'
import { Plus, Calendar, MapPin } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { Trip } from '@/shared/api/types'
import { formatMoney } from '@/shared/lib/format'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useAppShellHeaderActions } from '@/widgets/app-shell'

function formatTripTypeLabel(value?: string | null) {
  if (!value) {
    return 'Trip'
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function TripCard({ trip }: { trip: Trip }) {
  return (
    <Link to={`/app/trips/${trip.id}`} className="block h-full group">
      <Card
        variant="solid"
        className="flex h-full min-h-[11.25rem] cursor-pointer flex-col rounded-[12px] border-black/8 bg-white p-4 shadow-none transition-colors duration-150 hover:border-black/12 hover:bg-white"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="line-clamp-2 text-[1rem] font-medium leading-snug text-[var(--color-text)]">
              {trip.title}
            </h2>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{trip.destination_text}</span>
            </div>
          </div>
          <Badge
            variant="neutral"
            className="shrink-0 rounded-full border-black/8 bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.72rem] font-medium normal-case tracking-normal text-[var(--color-text-muted)]"
          >
            {formatTripTypeLabel(trip.trip_type)}
          </Badge>
        </div>

        <div className="mt-4 space-y-2 text-sm text-[var(--color-text-muted)]">
          {(trip.start_date || trip.end_date) ? (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>
                {trip.start_date && format(new Date(trip.start_date), 'MMM d, yyyy')}
                {trip.start_date && trip.end_date && ' – '}
                {trip.end_date && format(new Date(trip.end_date), 'MMM d, yyyy')}
              </span>
            </div>
          ) : null}

          {trip.budget_amount ? (
            <div className="text-sm text-[var(--color-text-muted)]">
              Budget: {formatMoney(trip.budget_amount, trip.budget_currency)}
            </div>
          ) : null}
        </div>

        <div className="mt-auto pt-4 text-sm font-medium text-[var(--color-text)]">
          Open trip
        </div>
      </Card>
    </Link>
  )
}

function TripSkeleton() {
  return (
    <Card className="rounded-[12px] border-black/8 bg-white p-4 shadow-none">
      <Skeleton className="mb-3 h-5 w-2/3" />
      <Skeleton className="mb-2 h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </Card>
  )
}

export default function TripsPage() {
  const [searchParams] = useSearchParams()
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const offset = (currentPage - 1) * TRIP_LIST_PAGE_SIZE
  const { data, isLoading, error } = useTrips({ limit: TRIP_LIST_PAGE_SIZE, offset })
  const trips = data?.items ?? []
  const showSkeleton = useDelayedLoading(isLoading, 250)
  const headerActions = useMemo(
    () => (
      <Button asChild className="h-8 rounded-[8px] px-3.5 text-[0.84rem] font-medium shadow-none hover:shadow-none">
        <Link to="/app/trips/new">
          <Plus data-icon="inline-start" />
          New trip
        </Link>
      </Button>
    ),
    [],
  )

  useAppShellHeaderActions(headerActions)

  return (
    <WorkspacePage className="gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load trips. Please refresh the page.</AlertDescription>
        </Alert>
      )}

      {showSkeleton && (
        <section className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
          <div className="grid animate-in gap-3 fade-in duration-300 [grid-template-columns:repeat(auto-fit,minmax(17.5rem,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <TripSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {!isLoading && trips.length === 0 && !error && (
        <section className="animate-in rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] px-6 py-8 fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-base font-medium text-[var(--color-text)]">No trips yet</h2>
          <p className="mt-1 max-w-md text-sm text-[var(--color-text-muted)]">
            Create a trip to start planning destinations, dates, and budgets.
          </p>
          <Button asChild className="mt-4 h-9 rounded-[8px] px-3.5 text-sm font-medium shadow-none hover:shadow-none">
            <Link to="/app/trips/new">
              <Plus data-icon="inline-start" />
              New trip
            </Link>
          </Button>
        </section>
      )}

      {!isLoading && trips.length > 0 && (
        <section className="animate-in rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4 fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(17.5rem,1fr))]">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}
    </WorkspacePage>
  )
}

import { Link } from 'react-router-dom'
import { useTrips } from '@/entities/trip/queries'
import { Plus, Calendar, MapPin, Globe } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { Trip } from '@/shared/api/types'
import { formatMoney } from '@/shared/lib/format'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'
import { WorkspaceHeader, WorkspacePage, WorkspaceStatCard, WorkspaceStatGrid } from '@/shared/layouts/workspace-shell'

function TripCard({ trip }: { trip: Trip }) {
  return (
    <Link to={`/app/trips/${trip.id}`} className="block group">
      <Card
        variant="solid"
        className="cursor-pointer p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_26px_60px_-32px_rgba(32,56,83,0.26)]"
      >
        <div className="mb-3 flex items-start justify-between">
          <h2 className="leading-snug font-semibold text-[var(--color-text)] transition-colors group-hover:text-[var(--color-primary-foreground)]">
            {trip.title}
          </h2>
          <Badge variant="accent" className="ml-2 shrink-0 capitalize">
            {trip.trip_type}
          </Badge>
        </div>
        <div className="mb-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary-foreground)]" />
          <span className="truncate">{trip.destination_text}</span>
        </div>
        {(trip.start_date || trip.end_date) && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>
              {trip.start_date && format(new Date(trip.start_date), 'MMM d, yyyy')}
              {trip.start_date && trip.end_date && ' – '}
              {trip.end_date && format(new Date(trip.end_date), 'MMM d, yyyy')}
            </span>
          </div>
        )}
        {trip.budget_amount && (
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border-strong)] pt-3">
            <span className="text-xs text-[var(--color-text-muted)]">
              Budget: {formatMoney(trip.budget_amount, trip.budget_currency)}
            </span>
            <span className="text-xs font-medium text-[var(--color-primary-foreground)] group-hover:underline">
              View trip →
            </span>
          </div>
        )}
      </Card>
    </Link>
  )
}

function TripSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-5 w-2/3 mb-3" />
      <Skeleton className="h-4 w-1/2 mb-2" />
      <Skeleton className="h-3.5 w-1/3" />
    </Card>
  )
}

export default function TripsPage() {
  const { data, isLoading, error } = useTrips()
  const trips = data?.items ?? []
  const showSkeleton = useDelayedLoading(isLoading, 250)
  const totalTrips = data?.total ?? trips.length

  return (
    <WorkspacePage className="gap-6">
      <WorkspaceHeader
        eyebrow="Trip index"
        title="Keep every itinerary in one place."
        description="Your saved trips, dates, budgets, and destinations now use the same landing-derived workspace language as the rest of Voyager."
        actions={(
          <Button asChild>
            <Link to="/app/trips/new">
              <Plus data-icon="inline-start" />
              New Trip
            </Link>
          </Button>
        )}
      />

      <WorkspaceStatGrid className="md:grid-cols-3">
        <WorkspaceStatCard label="Trips" value={totalTrips} detail="Active plans in your workspace" icon={Globe} />
        <WorkspaceStatCard label="Next step" value={trips[0]?.destination_text ?? 'Create a trip'} detail={trips[0] ? 'Most recent destination in view' : 'Start with title, dates, and preferences'} icon={MapPin} />
        <WorkspaceStatCard label="Coverage" value={trips.some((trip) => trip.budget_amount) ? 'Budgeted' : 'Flexible'} detail={trips.some((trip) => trip.budget_amount) ? 'At least one trip has a budget guardrail' : 'No trip budgets added yet'} icon={Calendar} />
      </WorkspaceStatGrid>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>Failed to load trips. Please refresh the page.</AlertDescription>
        </Alert>
      )}

      {showSkeleton && (
        <div className="grid animate-in grid-cols-1 gap-4 fade-in duration-300 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <TripSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && trips.length === 0 && !error && (
        <div className="voyager-panel-strong voyager-noise animate-in px-6 py-18 text-center fade-in slide-in-from-bottom-4 duration-500">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(114,174,230,0.16)] text-[var(--color-primary-foreground)]">
            <Globe className="h-8 w-8" />
          </div>
          <h2 className="mb-2 text-lg font-medium text-[var(--color-text)]">No trips yet</h2>
          <p className="mx-auto mb-6 max-w-sm text-sm text-[var(--color-text-muted)]">
            Create your first trip and let Voyager help you plan the perfect itinerary.
          </p>
          <Button asChild>
            <Link to="/app/trips/new">
              <Plus data-icon="inline-start" />
              Create Your First Trip
            </Link>
          </Button>
        </div>
      )}

      {!isLoading && trips.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <p className="mb-4 text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            {totalTrips} trip{totalTrips !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </div>
      )}
    </WorkspacePage>
  )
}

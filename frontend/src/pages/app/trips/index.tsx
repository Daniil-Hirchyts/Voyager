import { Link } from 'react-router-dom'
import { useTrips } from '@/entities/trip/queries'
import { Plus, Calendar, MapPin, Globe } from 'lucide-react'
import { format } from 'date-fns'
import type { Trip } from '@/shared/api/types'
import { formatMoney } from '@/shared/lib/format'

function TripCard({ trip }: { trip: Trip }) {
  return (
    <Link
      to={`/app/trips/${trip.id}`}
      className="block group p-5 rounded-[18px] border hover:shadow-md transition-all"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <h2 className="font-semibold text-[#1D2430] group-hover:text-[#2F6F73] transition-colors leading-snug">
          {trip.title}
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2F6F73]/10 text-[#2F6F73] capitalize shrink-0 ml-2">
          {trip.trip_type}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-sm text-[#526072] mb-2">
        <MapPin className="w-3.5 h-3.5 shrink-0 text-[#2F6F73]" />
        <span className="truncate">{trip.destination_text}</span>
      </div>
      {(trip.start_date || trip.end_date) && (
        <div className="flex items-center gap-1.5 text-xs text-[#526072]">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>
            {trip.start_date && format(new Date(trip.start_date), 'MMM d, yyyy')}
            {trip.start_date && trip.end_date && ' – '}
            {trip.end_date && format(new Date(trip.end_date), 'MMM d, yyyy')}
          </span>
        </div>
      )}
      {trip.budget_amount && (
        <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs text-[#526072]">
            Budget: {formatMoney(trip.budget_amount, trip.budget_currency)}
          </span>
          <span className="text-xs text-[#2F6F73] font-medium group-hover:underline">
            View trip →
          </span>
        </div>
      )}
    </Link>
  )
}

function TripSkeleton() {
  return (
    <div
      className="p-5 rounded-[18px] border animate-pulse"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="h-5 bg-[#CDBEA8]/50 rounded-md w-2/3 mb-3" />
      <div className="h-4 bg-[#CDBEA8]/40 rounded-md w-1/2 mb-2" />
      <div className="h-3.5 bg-[#CDBEA8]/30 rounded-md w-1/3" />
    </div>
  )
}

export default function TripsPage() {
  const { data, isLoading, error } = useTrips()
  const trips = data?.items ?? []

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#1D2430]">My Trips</h1>
          <p className="text-sm text-[#526072] mt-0.5">Your travel plans and itineraries</p>
        </div>
        <Link
          to="/app/trips/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Trip
        </Link>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="p-4 rounded-[10px] border text-sm text-[#C56A3D] mb-6"
          style={{
            background: 'rgba(197, 106, 61, 0.08)',
            borderColor: 'rgba(197, 106, 61, 0.2)',
          }}
        >
          Failed to load trips. Please refresh the page.
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <TripSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && trips.length === 0 && !error && (
        <div className="text-center py-20">
          <div
            className="w-16 h-16 rounded-full bg-[#2F6F73]/10 flex items-center justify-center mx-auto mb-4"
          >
            <Globe className="w-8 h-8 text-[#CDBEA8]" />
          </div>
          <h2 className="text-lg font-medium text-[#1D2430] mb-2">No trips yet</h2>
          <p className="text-sm text-[#526072] mb-6 max-w-sm mx-auto">
            Create your first trip and let Voyager help you plan the perfect itinerary.
          </p>
          <Link
            to="/app/trips/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Your First Trip
          </Link>
        </div>
      )}

      {/* Trip grid */}
      {!isLoading && trips.length > 0 && (
        <>
          <p className="text-xs text-[#526072] mb-4">
            {data?.total ?? trips.length} trip{(data?.total ?? trips.length) !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

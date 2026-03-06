import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowRight,
  Calendar,
  ChevronRight,
  Copy,
  DollarSign,
  FileText,
  Hotel,
  Loader2,
  Map as MapIcon,
  MapPin,
  Ticket,
  Trash2,
} from 'lucide-react'
import { useTrip, useDeleteTrip, useDuplicateTrip } from '@/entities/trip/queries'
import { useDays, usePatchDay } from '@/entities/day/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { config } from '@/app/config'
import { formatMoney } from '@/shared/lib/format'
import { isApiError } from '@/shared/api/client'
import type { Offer } from '@/shared/api/types'

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId!)
  const { data: daysData, isLoading: daysLoading } = useDays(tripId!)
  const { data: offersData } = useTripOffers(tripId!, {
    current_only: true,
    limit: 200,
    offset: 0,
  })

  const deleteTrip = useDeleteTrip()
  const duplicateTrip = useDuplicateTrip()
  const patchDay = usePatchDay(tripId!)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingDayId, setEditingDayId] = useState<string | null>(null)
  const [dayNotesValue, setDayNotesValue] = useState('')
  const dupKeyRef = useRef(crypto.randomUUID())

  const days = daysData?.items ?? []
  const offersByDay = useMemo(() => {
    const grouped = new globalThis.Map<string, Offer[]>()

    for (const offer of offersData?.items ?? []) {
      if (!offer.trip_day_id) continue
      grouped.set(offer.trip_day_id, [...(grouped.get(offer.trip_day_id) ?? []), offer])
    }

    return grouped
  }, [offersData?.items])

  if (tripLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <div className="h-8 bg-[#CDBEA8]/40 rounded-md w-1/2 animate-pulse" />
        <div
          className="p-5 rounded-[18px] border animate-pulse"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="h-6 bg-[#CDBEA8]/40 rounded w-1/3 mb-3" />
          <div className="h-4 bg-[#CDBEA8]/30 rounded w-1/2 mb-2" />
          <div className="h-4 bg-[#CDBEA8]/30 rounded w-1/4" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-[18px] border animate-pulse"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (tripError || !trip) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div
          className="p-6 rounded-[18px] border text-center"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <p className="text-[#526072]">
            {isApiError(tripError) && tripError.status === 404
              ? 'Trip not found.'
              : 'Failed to load trip.'}
          </p>
          <Link
            to="/app/trips"
            className="mt-4 inline-block text-sm text-[#2F6F73] underline"
          >
            Back to trips
          </Link>
        </div>
      </div>
    )
  }

  const handleDelete = async () => {
    try {
      await deleteTrip.mutateAsync(tripId!)
      navigate('/app/trips')
      toast.success('Trip deleted')
    } catch {
      toast.error('Failed to delete trip')
      setShowDeleteConfirm(false)
    }
  }

  const handleDuplicate = async () => {
    try {
      const newTrip = await duplicateTrip.mutateAsync({
        tripId: tripId!,
        idempotencyKey: dupKeyRef.current,
      })
      toast.success('Trip duplicated')
      navigate(`/app/trips/${newTrip.id}`)
    } catch {
      toast.error('Failed to duplicate trip')
    }
  }

  const handleDayNotesSave = async (dayId: string) => {
    try {
      await patchDay.mutateAsync({ dayId, data: { notes: dayNotesValue } })
      setEditingDayId(null)
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div className="min-w-0 flex-1 mr-4">
          <Link
            to="/app/trips"
            className="text-xs text-[#526072] hover:text-[#1D2430] transition-colors mb-2 block"
          >
            ← All trips
          </Link>
          <h1 className="text-2xl font-semibold text-[#1D2430] break-words">{trip.title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDuplicate}
            disabled={duplicateTrip.isPending}
            className="p-2 rounded-[10px] border hover:bg-[#F4EBDD] transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)' }}
            title="Duplicate trip"
          >
            {duplicateTrip.isPending ? (
              <Loader2 className="w-4 h-4 text-[#526072] animate-spin" />
            ) : (
              <Copy className="w-4 h-4 text-[#526072]" />
            )}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 rounded-[10px] border hover:bg-[#C56A3D]/10 hover:border-[#C56A3D]/30 transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
            title="Delete trip"
          >
            <Trash2 className="w-4 h-4 text-[#526072]" />
          </button>
          <Link
            to={`/app/trips/${tripId}/plan`}
            className="flex items-center gap-2 px-4 py-2 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
          >
            Open Planner <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div
        className="p-5 rounded-[18px] border mb-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-medium text-[#1D2430]">Trip Overview</h2>
          {trip.trip_type && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#2F6F73]/10 text-[#2F6F73] capitalize">
              {trip.trip_type}
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm text-[#526072]">
            <MapPin className="w-4 h-4 shrink-0 text-[#2F6F73]" />
            <span>{trip.destination_text}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#526072]">
            <Calendar className="w-4 h-4 shrink-0 text-[#2F6F73]" />
            <span>
              {format(new Date(trip.start_date), 'MMM d, yyyy')} –{' '}
              {format(new Date(trip.end_date), 'MMM d, yyyy')}
            </span>
          </div>
          {trip.budget_amount && (
            <div className="flex items-center gap-2 text-sm text-[#526072]">
              <DollarSign className="w-4 h-4 shrink-0 text-[#2F6F73]" />
              <span>{formatMoney(trip.budget_amount, trip.budget_currency)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-medium text-[#526072] uppercase tracking-wider mb-2">
            Preferences
          </p>
          {trip.preferences.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {trip.preferences.map((preference) => (
                <span
                  key={preference}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border"
                  style={{
                    background: 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {preference}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#526072] italic">No trip preferences set.</p>
          )}
        </div>

        {(config.features.mapUI || config.features.offersUI) && (
          <div
            className="mt-4 pt-4 border-t flex flex-wrap gap-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {config.features.mapUI && (
              <Link
                to={`/app/trips/${tripId}/map`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-[10px] border text-sm text-[#526072] hover:bg-[#F4EBDD] transition-colors"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <MapIcon className="w-4 h-4 text-[#2F6F73]" />
                Open Map
              </Link>
            )}
            {config.features.offersUI && (
              <Link
                to={`/app/trips/${tripId}/offers`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-[10px] border text-sm text-[#526072] hover:bg-[#F4EBDD] transition-colors"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <Ticket className="w-4 h-4 text-[#2F6F73]" />
                Browse Offers
              </Link>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-[#1D2430]">
            Itinerary Days
            {daysLoading && (
              <span className="text-xs text-[#526072] font-normal ml-1">(loading…)</span>
            )}
          </h2>
          {days.length > 0 && (
            <span className="text-xs text-[#526072]">
              {days.length} day{days.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {days.length === 0 && !daysLoading && (
          <div
            className="text-center py-8 border rounded-[18px]"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <FileText className="w-8 h-8 text-[#CDBEA8] mx-auto mb-3" />
            <p className="text-sm text-[#526072] mb-3">
              No days yet. Open the planner to generate an itinerary.
            </p>
            <Link
              to={`/app/trips/${tripId}/plan`}
              className="inline-flex items-center gap-1.5 text-sm text-[#2F6F73] font-medium hover:underline"
            >
              Open Planner <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {days.map((day, index) => {
            const dayOffers = offersByDay.get(day.id) ?? []

            return (
              <div
                key={day.id}
                className="p-4 rounded-[18px] border"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-[#1D2430] text-sm">Day {index + 1}</p>
                    <p className="text-xs text-[#526072]">
                      {format(new Date(day.date), 'EEEE, MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {editingDayId !== day.id && (
                      <button
                        onClick={() => {
                          setEditingDayId(day.id)
                          setDayNotesValue(day.notes || '')
                        }}
                        className="text-xs text-[#2F6F73] hover:underline"
                      >
                        Edit notes
                      </button>
                    )}
                    <Link
                      to={`/app/trips/${tripId}/plan`}
                      className="flex items-center gap-0.5 text-xs text-[#526072] hover:text-[#1D2430] transition-colors"
                    >
                      Plan <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>

                {config.features.offersUI && dayOffers.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {dayOffers.map((offer) => (
                      <Link
                        key={offer.id}
                        to={`/app/trips/${tripId}/offers?dayId=${day.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border hover:bg-[#F4EBDD] transition-colors"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {offer.kind === 'lodging' ? (
                          <Hotel className="w-3 h-3 text-[#2F6F73]" />
                        ) : (
                          <Ticket className="w-3 h-3 text-[#2F6F73]" />
                        )}
                        {offer.title}
                      </Link>
                    ))}
                  </div>
                )}

                {editingDayId === day.id ? (
                  <div>
                    <textarea
                      value={dayNotesValue}
                      onChange={(event) => setDayNotesValue(event.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded-[10px] border text-sm resize-none outline-none focus:border-[#2F6F73] focus:ring-2 focus:ring-[#2F6F73]/10"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                      placeholder="Notes for this day..."
                      autoFocus
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={() => handleDayNotesSave(day.id)}
                        disabled={patchDay.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#2F6F73] text-white text-xs font-medium rounded-lg hover:bg-[#266063] transition-colors disabled:opacity-50"
                      >
                        {patchDay.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : null}
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDayId(null)}
                        className="px-3 py-1.5 text-xs text-[#526072] hover:text-[#1D2430] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#526072]">
                    {day.notes ? (
                      day.notes
                    ) : (
                      <span className="italic text-[#CDBEA8] text-xs">No notes for this day</span>
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(29, 36, 48, 0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm p-6 rounded-[18px]"
            style={{
              background: 'var(--color-surface)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <h3 className="font-semibold text-[#1D2430] mb-2">Delete this trip?</h3>
            <p className="text-sm text-[#526072] mb-5">
              This action is irreversible. All days, activities, and data for "{trip.title}" will
              be permanently deleted.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 border text-sm font-medium text-[#526072] rounded-[10px] hover:bg-[#F4EBDD] transition-colors"
                style={{ borderColor: 'var(--color-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteTrip.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#C56A3D] text-white text-sm font-medium rounded-[10px] hover:bg-[#b05e35] transition-colors disabled:opacity-50"
              >
                {deleteTrip.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Delete Trip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

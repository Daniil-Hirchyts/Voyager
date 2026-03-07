import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Search,
  Loader2,
  ExternalLink,
  Calendar,
  MapPin,
  Tag,
  AlertCircle,
  CheckCircle2,
  Ticket,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useTrip, tripKeys } from '@/entities/trip/queries'
import { useDays } from '@/entities/day/queries'
import { useJob } from '@/entities/job/queries'
import { useTripEvents, useSearchEvents, useAttachEventToDay } from '@/entities/event/queries'
import { isConflict, isRateLimit, isIntegrationNotConfigured } from '@/shared/api/client'
import { isJobRunning, isJobSuccessful } from '@/shared/lib/jobs'
import { useEventsStore } from '@/shared/stores/events.store'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EventResponse, Day } from '@/shared/api/types'

// Timezone-aware event date formatter
function formatEventDate(startAt: string | null, timezone: string | null): string {
  if (!startAt) return 'Date TBD'
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone ?? undefined,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startAt))
  } catch {
    return new Date(startAt).toLocaleString()
  }
}

const searchSchema = z
  .object({
    start_date: z.string().min(1, 'Start date required'),
    end_date: z.string().min(1, 'End date required'),
    location_text: z.string().optional(),
    keyword: z.string().optional(),
    segment: z.string().optional(),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: 'End date must be on or after start date',
    path: ['end_date'],
  })

type SearchFormValues = z.infer<typeof searchSchema>

function EventCard({
  event,
  selected,
  onClick,
}: {
  event: EventResponse
  selected: boolean
  onClick: () => void
}) {
  const dateLabel = formatEventDate(event.start_at, event.timezone)
  const priceLabel =
    event.min_price && event.max_price
      ? `${formatMoney(event.min_price, event.currency)} – ${formatMoney(event.max_price, event.currency)}`
      : event.min_price
        ? `From ${formatMoney(event.min_price, event.currency)}`
        : null

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex gap-3 p-3 rounded-[10px] border text-left transition-colors',
        selected
          ? 'border-[#2F6F73] bg-[#2F6F73]/5'
          : 'border-[var(--color-border)] hover:border-[#2F6F73]/40 hover:bg-[#F4EBDD]',
      )}
      style={{ background: selected ? undefined : 'var(--color-surface)' }}
      aria-pressed={selected}
    >
      {event.image_url && (
        <img
          src={event.image_url}
          alt=""
          aria-hidden="true"
          className="w-16 h-16 rounded-[8px] object-cover shrink-0"
        />
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-[#1D2430] line-clamp-2">{event.title}</p>
        <div className="flex items-center gap-1.5 text-xs text-[#526072]">
          <Calendar className="w-3 h-3 shrink-0" />
          <span>{dateLabel}</span>
        </div>
        {event.venue_name && (
          <div className="flex items-center gap-1.5 text-xs text-[#526072]">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{event.venue_name}</span>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {event.segment && (
            <Badge variant="entity" className="gap-1">
              <Tag className="w-3 h-3" />
              {event.segment}
            </Badge>
          )}
          {priceLabel && (
            <span className="text-xs text-[#526072]">{priceLabel}</span>
          )}
          {event.trip_day_id && (
            <Badge variant="secondary" className="text-emerald-700 bg-emerald-50">Attached</Badge>
          )}
        </div>
      </div>
    </button>
  )
}

function AttachModal({
  event,
  days,
  tripVersion,
  tripId,
  onClose,
}: {
  event: EventResponse
  days: Day[]
  tripVersion: number
  tripId: string
  onClose: () => void
}) {
  const [selectedDayId, setSelectedDayId] = useState(days[0]?.id ?? '')
  const qc = useQueryClient()
  const { mutateAsync: attach, isPending } = useAttachEventToDay(tripId)

  const handleAttach = async () => {
    if (!selectedDayId) return
    const idempotencyKey = `attach-event-${event.id}-${selectedDayId}-${Date.now()}`
    try {
      await attach({ eventId: event.id, data: { trip_day_id: selectedDayId }, tripVersion, idempotencyKey })
      toast.success('Event attached', { description: `${event.title} added to your trip.` })
      onClose()
    } catch (err) {
      if (isConflict(err)) {
        await qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
        toast.error('Version conflict', { description: 'Trip updated. Please retry.' })
        onClose()
      } else {
        toast.error('Failed to attach event')
      }
    }
  }

  const dayLabel = (day: Day) =>
    `Day ${day.day_index + 1} — ${new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach event to day</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#526072] line-clamp-2">{event.title}</p>
        <div className="space-y-1">
          <Label htmlFor="attach-day-select">Select day</Label>
          <Select value={selectedDayId} onValueChange={setSelectedDayId}>
            <SelectTrigger id="attach-day-select">
              <SelectValue placeholder="Choose a day" />
            </SelectTrigger>
            <SelectContent>
              {days.map((d) => (
                <SelectItem key={d.id} value={d.id}>{dayLabel(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAttach} disabled={isPending || !selectedDayId}>
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Props {
  tripId: string
}

export default function EventsWorkspace({ tripId }: Props) {
  const { data: trip } = useTrip(tripId)
  const { data: daysData } = useDays(tripId)
  const days = daysData?.items ?? []

  const { data: eventsData, isLoading: eventsLoading } = useTripEvents(tripId)
  const events = eventsData?.items ?? []

  const { mutateAsync: submitSearch, isPending: searching } = useSearchEvents(tripId)
  const { selectedEventId, setSelectedEventId, searchJobId, setSearchJobId, attachModalOpen, setAttachModalOpen } = useEventsStore()

  const { data: searchJob } = useJob(searchJobId)
  const searchRunning = isJobRunning(searchJob?.status)
  const searchSucceeded = isJobSuccessful(searchJob?.status)
  const searchFailed = searchJob?.status === 'FAILED'

  const [providerUnavailable, setProviderUnavailable] = useState(false)
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null)
  const isRateLimited = rateLimitedUntil != null && Date.now() < rateLimitedUntil

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<SearchFormValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      start_date: '',
      end_date: '',
    },
  })

  // Sync form dates from trip once loaded
  useEffect(() => {
    if (trip?.start_date && trip?.end_date) {
      reset({ start_date: trip.start_date, end_date: trip.end_date }, { keepDirtyValues: true })
    }
  }, [trip?.start_date, trip?.end_date, reset])

  const onSubmit = async (values: SearchFormValues) => {
    if (!trip || isRateLimited) return
    setProviderUnavailable(false)
    const idempotencyKey = `event-search-${tripId}-${Date.now()}`
    try {
      const accepted = await submitSearch({
        data: {
          trip_id: tripId,
          start_date: values.start_date,
          end_date: values.end_date,
          location_text: values.location_text || null,
          keyword: values.keyword || null,
          segment: values.segment || null,
          size: 20,
        },
        idempotencyKey,
      })
      setSearchJobId(accepted.job_id)
      toast.success('Event search submitted', { description: 'Searching for live events…' })
    } catch (err) {
      if (isIntegrationNotConfigured(err)) {
        setProviderUnavailable(true)
      } else if (isRateLimit(err)) {
        setRateLimitedUntil(Date.now() + 30_000)
        toast.error('Too many requests', { description: 'Please wait before searching again.' })
      } else {
        toast.error('Search failed', { description: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
  }

  // When job succeeds, refresh event list
  useEffect(() => {
    if (searchSucceeded && searchJobId) {
      setSearchJobId(null)
    }
  }, [searchSucceeded, searchJobId, setSearchJobId])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h1 className="font-display text-xl text-[#1D2430]">Live Events</h1>
        <p className="text-sm text-[#526072] mt-0.5">Search and attach live events to your trip days.</p>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left: search + list */}
        <div className="flex flex-col w-full lg:w-1/2 border-r" style={{ borderColor: 'var(--color-border)' }}>
          {/* Search form */}
          <form onSubmit={handleSubmit(onSubmit)} className="px-4 py-4 border-b space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="start_date">Start date *</Label>
                <Controller
                  control={control}
                  name="start_date"
                  render={({ field }) => (
                    <DatePicker
                      id="start_date"
                      value={field.value}
                      onChange={field.onChange}
                      className={errors.start_date ? 'border-red-500' : ''}
                    />
                  )}
                />
                {errors.start_date && <p className="text-xs text-red-600">{errors.start_date.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="end_date">End date *</Label>
                <Controller
                  control={control}
                  name="end_date"
                  render={({ field }) => (
                    <DatePicker
                      id="end_date"
                      value={field.value}
                      onChange={field.onChange}
                      className={errors.end_date ? 'border-red-500' : ''}
                    />
                  )}
                />
                {errors.end_date && <p className="text-xs text-red-600">{errors.end_date.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="location_text">Location</Label>
              <Input
                id="location_text"
                placeholder={trip?.destination_text ?? 'e.g. Paris, France'}
                {...register('location_text')}
                style={{ background: 'var(--color-bg)' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="keyword">Keyword</Label>
                <Input
                  id="keyword"
                  placeholder="e.g. jazz, theatre"
                  {...register('keyword')}
                  style={{ background: 'var(--color-bg)' }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="segment">Segment</Label>
                <Input
                  id="segment"
                  placeholder="e.g. Music, Arts"
                  {...register('segment')}
                  style={{ background: 'var(--color-bg)' }}
                />
              </div>
            </div>

            {/* Provider unavailable */}
            {providerUnavailable && (
              <Alert variant="warning">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  Live event search is unavailable. Provider integrations are not configured for this environment.
                </AlertDescription>
              </Alert>
            )}

            {/* Rate limit */}
            {isRateLimited && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  Search requests are being paced. Please wait before retrying.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={searching || searchRunning || isRateLimited}
              >
                {(searching || searchRunning) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search Events
              </Button>
              {searchRunning && (
                <span aria-live="polite" className="text-xs text-[#526072]">Searching…</span>
              )}
              {searchSucceeded && (
                <span className="flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Results updated
                </span>
              )}
              {searchFailed && (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Search failed
                </span>
              )}
            </div>
          </form>

          {/* Event list */}
          <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
            {eventsLoading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded-[10px] border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <Skeleton className="w-16 h-16 rounded-[8px] shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </>
            )}

            {!eventsLoading && events.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Ticket className="w-8 h-8 text-[#526072]/40" />
                <p className="text-sm font-medium text-[#526072]">No events found</p>
                <p className="text-xs text-[#526072]/70 max-w-xs">
                  Use the search form to find live events. Try adjusting dates, location, or keyword.
                </p>
              </div>
            )}

            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                selected={selectedEventId === event.id}
                onClick={() => setSelectedEventId(selectedEventId === event.id ? null : event.id)}
              />
            ))}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 overflow-auto">
          {!selectedEvent && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
              <Ticket className="w-10 h-10 text-[#526072]/30" />
              <p className="text-sm text-[#526072]">Select an event to view details</p>
            </div>
          )}

          {selectedEvent && (
            <div className="p-5 space-y-4">
              {selectedEvent.image_url && (
                <img
                  src={selectedEvent.image_url}
                  alt={selectedEvent.title}
                  className="w-full h-44 object-cover rounded-[10px]"
                />
              )}

              <div className="space-y-1">
                <h2 className="font-display text-lg text-[#1D2430]">{selectedEvent.title}</h2>
                {selectedEvent.summary && (
                  <p className="text-sm text-[#526072]">{selectedEvent.summary}</p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-[#526072]">Date &amp; time</dt>
                <dd className="text-[#1D2430]">{formatEventDate(selectedEvent.start_at, selectedEvent.timezone)}</dd>

                {selectedEvent.venue_name && (
                  <>
                    <dt className="text-[#526072]">Venue</dt>
                    <dd className="text-[#1D2430]">{selectedEvent.venue_name}</dd>
                  </>
                )}
                {selectedEvent.venue_address && (
                  <>
                    <dt className="text-[#526072]">Address</dt>
                    <dd className="text-[#1D2430] text-xs">{selectedEvent.venue_address}</dd>
                  </>
                )}
                {selectedEvent.segment && (
                  <>
                    <dt className="text-[#526072]">Category</dt>
                    <dd className="text-[#1D2430]">{[selectedEvent.segment, selectedEvent.genre].filter(Boolean).join(' / ')}</dd>
                  </>
                )}
                {selectedEvent.min_price && (
                  <>
                    <dt className="text-[#526072]">Price</dt>
                    <dd className="text-[#1D2430]">
                      {formatMoney(selectedEvent.min_price, selectedEvent.currency)}
                      {selectedEvent.max_price && selectedEvent.max_price !== selectedEvent.min_price
                        ? ` – ${formatMoney(selectedEvent.max_price, selectedEvent.currency)}`
                        : ''}
                    </dd>
                  </>
                )}
                {selectedEvent.sales_status && (
                  <>
                    <dt className="text-[#526072]">Sales status</dt>
                    <dd className="text-[#1D2430]">{selectedEvent.sales_status}</dd>
                  </>
                )}
              </dl>

              <div className="flex items-center gap-3 pt-2">
                {!selectedEvent.trip_day_id && trip && days.length > 0 && (
                  <Button onClick={() => setAttachModalOpen(true)}>
                    <Calendar className="w-4 h-4" />
                    Attach to day
                  </Button>
                )}
                {selectedEvent.trip_day_id && (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-[10px]">
                    <CheckCircle2 className="w-4 h-4" />
                    Attached to trip
                  </span>
                )}
                {selectedEvent.deep_link && (
                  <Button variant="outline" asChild>
                    <a
                      href={selectedEvent.deep_link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Book tickets
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attach modal */}
      {attachModalOpen && selectedEvent && trip && (
        <AttachModal
          event={selectedEvent}
          days={days}
          tripVersion={trip.version}
          tripId={tripId}
          onClose={() => setAttachModalOpen(false)}
        />
      )}
    </div>
  )
}

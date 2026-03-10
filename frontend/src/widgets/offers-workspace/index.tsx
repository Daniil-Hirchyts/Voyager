import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDays, format } from 'date-fns'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRightLeft,
  Calendar,
  CircleAlert,
  Clock3,
  ExternalLink,
  Hotel,
  Loader2,
  MapPin,
  Plane,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Ticket,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { useDays } from '@/entities/day/queries'
import { useJob } from '@/entities/job/queries'
import {
  useAttachOfferToDay,
  useRefreshOffer,
  useRefreshTripOffers,
  useSubmitLodgingOfferSearch,
  useSubmitTransportOfferSearch,
  useTripOffers,
} from '@/entities/offer/queries'
import { useTrip } from '@/entities/trip/queries'
import { useTripMapLayers } from '@/entities/trip-map-layer/queries'
import { isIntegrationNotConfigured, isRateLimit } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import { getJobResultErrors, isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { resolvePhotoUrl } from '@/shared/lib/media'
import {
  GoogleMapCanvas,
  GooglePolyline,
  MapFitBounds,
  TripMapLayerRenderer,
  VoyagerMarker,
  VoyagerMarkerClusterLayer,
} from '@/shared/layouts/google-maps'
import type {
  Day,
  LodgingOfferDetails,
  LodgingOfferSearchInput,
  Offer,
  OfferKind,
  Trip,
  TripMapLayer,
  TripOffersRefreshInput,
  TransportOfferDetails,
  TransportOfferSearchInput,
} from '@/shared/api/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useAppShellHeaderActions, useAppShellHeaderMeta } from '@/widgets/app-shell'
import PlacePhotos from '@/widgets/place-photos'

const DEFAULT_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY']
const ADULT_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8']
const GUEST_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8']

const transportSchema = z
  .object({
    trip_type: z.enum(['round_trip', 'one_way']),
    origin_text: z.string().trim().min(1, 'Origin is required'),
    destination_text: z.string().trim().min(1, 'Destination is required'),
    depart_date: z.string().min(1, 'Departure date is required'),
    return_date: z.string().nullable().optional(),
    adults: z.coerce.number().int().min(1).max(9),
    currency: z.string().min(3).max(3),
  })
  .superRefine((value, ctx) => {
    if (value.trip_type === 'round_trip' && !value.return_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['return_date'],
        message: 'Return date is required for round trips',
      })
    }
    if (
      value.return_date &&
      value.depart_date &&
      new Date(value.return_date).getTime() < new Date(value.depart_date).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['return_date'],
        message: 'Return date must be after departure',
      })
    }
  })

const lodgingSchema = z.object({
  location_text: z.string().trim().min(1, 'Location is required'),
  checkin_date: z.string().min(1, 'Check-in date is required'),
  checkout_date: z.string().min(1, 'Check-out date is required'),
  guests: z.coerce.number().int().min(1).max(16),
  currency: z.string().min(3).max(3),
}).superRefine((value, ctx) => {
  if (new Date(value.checkout_date).getTime() <= new Date(value.checkin_date).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkout_date'],
      message: 'Checkout must be after check-in',
    })
  }
})

type TransportFormValues = z.infer<typeof transportSchema>
type LodgingFormValues = z.infer<typeof lodgingSchema>

type OfferMode = 'transport' | 'lodging'
type FlightSort = 'best' | 'cheapest' | 'fastest' | 'earliest'
type HotelSort = 'recommended' | 'price' | 'rating'
type StopsFilter = 'all' | 'nonstop' | '1' | '2+'
type PriceBucket = 'all' | 'under-150' | '150-300' | '300-500' | '500+'
type FlightDepartureBucket = 'all' | 'morning' | 'afternoon' | 'evening' | 'overnight'
type FlightDurationBucket = 'all' | 'under-180' | '180-360' | '360+'
type HotelStarBucket = 'all' | '3+' | '4+' | '5'

interface Props {
  tripId: string
}

interface ModeIssue {
  title: string
  description: string
  variant?: 'default' | 'warning' | 'destructive'
}

function toDateString(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function plusOneDay(value: string | Date | null | undefined) {
  if (!value) return toDateString(addDays(new Date(), 1))
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return toDateString(addDays(new Date(), 1))
  return toDateString(addDays(date, 1))
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateLabel(value: string | null | undefined, pattern = 'MMM d') {
  const date = parseDate(value)
  return date ? format(date, pattern) : 'Flexible'
}

function formatDateTimeLabel(value: string | null | undefined) {
  const date = parseDate(value)
  return date ? format(date, 'MMM d, HH:mm') : 'Flexible'
}

function formatTimeLabel(value: string | null | undefined) {
  const date = parseDate(value)
  return date ? format(date, 'HH:mm') : 'TBD'
}

function formatDurationMinutes(value: number | null | undefined) {
  if (value == null) return 'Unknown'
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} hr`
  return `${hours} hr ${minutes} min`
}

function numericPrice(value: string | number | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined) {
  const startDate = parseDate(start)
  const endDate = parseDate(end)
  if (!startDate || !endDate) return null
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60_000))
}

function titleizeToken(value: string | null | undefined) {
  if (!value) return 'Unknown'
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  )
}

function compareDatesDesc(left: string | null | undefined, right: string | null | undefined) {
  return (parseDate(right)?.getTime() ?? 0) - (parseDate(left)?.getTime() ?? 0)
}

function getSortedDays(days: Day[]) {
  return [...days].sort((left, right) => left.day_index - right.day_index)
}

function getFocusedDay(days: Day[], focusedDayId: string | null) {
  return days.find((day) => day.id === focusedDayId) ?? null
}

function getNextDay(days: Day[], focusedDayId: string | null) {
  if (!focusedDayId) return null
  const index = days.findIndex((day) => day.id === focusedDayId)
  return index >= 0 ? days[index + 1] ?? null : null
}

function getOfferPriority(offer: Offer, focusedDayId: string | null) {
  if (!focusedDayId) return offer.trip_day_id ? 1 : 0
  if (offer.trip_day_id === focusedDayId) return 0
  if (!offer.trip_day_id) return 1
  return 2
}

function getLatestOffer(offers: Offer[], kind: OfferKind, focusedDayId: string | null) {
  return [...offers]
    .filter((offer) => offer.kind === kind)
    .sort((left, right) => {
      const priority = getOfferPriority(left, focusedDayId) - getOfferPriority(right, focusedDayId)
      if (priority !== 0) return priority
      return compareDatesDesc(left.created_at, right.created_at)
    })[0] ?? null
}

function buildTransportDefaults({
  trip,
  days,
  focusedDayId,
  latestTransportOffer,
}: {
  trip: Trip | undefined
  days: Day[]
  focusedDayId: string | null
  latestTransportOffer: Offer | null
}): TransportFormValues {
  const focusedDay = getFocusedDay(days, focusedDayId)
  const nextDay = getNextDay(days, focusedDayId)
  const tripStart = toDateString(trip?.start_date)
  const tripEnd = toDateString(trip?.end_date)
  const departDate = focusedDay?.date ?? latestTransportOffer?.depart_at ?? tripStart ?? toDateString(new Date())
  const hasLaterDay = focusedDay ? Boolean(nextDay) : Boolean(tripStart && tripEnd && tripEnd > tripStart)
  let returnDate = hasLaterDay
    ? nextDay?.date ?? tripEnd ?? plusOneDay(departDate)
    : null

  if (returnDate && new Date(returnDate).getTime() <= new Date(departDate).getTime()) {
    returnDate = plusOneDay(departDate)
  }

  return {
    trip_type: hasLaterDay ? 'round_trip' : 'one_way',
    origin_text: latestTransportOffer?.origin_text ?? '',
    destination_text: latestTransportOffer?.destination_text ?? trip?.destination_text ?? '',
    depart_date: toDateString(departDate),
    return_date: hasLaterDay ? returnDate : null,
    adults: 1,
    currency: latestTransportOffer?.currency ?? trip?.budget_currency ?? 'EUR',
  }
}

function buildLodgingDefaults({
  trip,
  days,
  focusedDayId,
  latestLodgingOffer,
  latestTransportOffer,
}: {
  trip: Trip | undefined
  days: Day[]
  focusedDayId: string | null
  latestLodgingOffer: Offer | null
  latestTransportOffer: Offer | null
}): LodgingFormValues {
  const focusedDay = getFocusedDay(days, focusedDayId)
  const nextDay = getNextDay(days, focusedDayId)
  const tripStart = toDateString(trip?.start_date)
  const tripEnd = toDateString(trip?.end_date)
  const checkinDate = focusedDay?.date ?? latestLodgingOffer?.checkin_date ?? tripStart ?? toDateString(new Date())
  let checkoutDate =
    nextDay?.date ??
    latestLodgingOffer?.checkout_date ??
    tripEnd ??
    plusOneDay(checkinDate)

  if (new Date(checkoutDate).getTime() <= new Date(checkinDate).getTime()) {
    checkoutDate = plusOneDay(checkinDate)
  }

  return {
    location_text:
      latestLodgingOffer?.location_text ??
      latestTransportOffer?.destination_text ??
      trip?.destination_text ??
      '',
    checkin_date: toDateString(checkinDate),
    checkout_date: toDateString(checkoutDate),
    guests: 2,
    currency:
      latestLodgingOffer?.currency ??
      latestTransportOffer?.currency ??
      trip?.budget_currency ??
      'EUR',
  }
}

function firstOutboundSegments(details: TransportOfferDetails | null | undefined) {
  return (details?.segments ?? []).filter((segment) => (segment.itinerary_index ?? 0) === 0)
}

function getFlightStopsCount(offer: Offer) {
  if (offer.transport_details?.stops_count != null) return offer.transport_details.stops_count
  return Math.max(firstOutboundSegments(offer.transport_details).length - 1, 0)
}

function getFlightDuration(offer: Offer) {
  return offer.transport_details?.total_duration_min ?? minutesBetween(offer.depart_at, offer.arrive_at)
}

function getFlightPrimaryAirline(offer: Offer) {
  const firstSegment = firstOutboundSegments(offer.transport_details)[0]
  return firstSegment?.airline_name ?? firstSegment?.airline_code ?? titleizeToken(offer.provider)
}

function getFlightDepartureTime(offer: Offer) {
  return firstOutboundSegments(offer.transport_details)[0]?.departure_at ?? offer.depart_at ?? null
}

function getFlightArrivalTime(offer: Offer) {
  const outboundSegments = firstOutboundSegments(offer.transport_details)
  return outboundSegments[outboundSegments.length - 1]?.arrival_at ?? offer.arrive_at ?? null
}

function getFlightDepartureHour(offer: Offer) {
  return parseDate(getFlightDepartureTime(offer))?.getHours() ?? null
}

function normalizeValue(value: number, min: number, max: number) {
  if (max === min) return 0
  return (value - min) / (max - min)
}

function getFlightBestScore(
  offer: Offer,
  priceRange: { min: number; max: number },
  durationRange: { min: number; max: number },
  stopRange: { min: number; max: number },
) {
  const price = numericPrice(offer.price_amount)
  const duration = getFlightDuration(offer) ?? durationRange.max
  const stops = getFlightStopsCount(offer)
  return (
    normalizeValue(price, priceRange.min, priceRange.max) * 0.45 +
    normalizeValue(duration, durationRange.min, durationRange.max) * 0.35 +
    normalizeValue(stops, stopRange.min, stopRange.max) * 0.2
  )
}

function getHotelDetails(offer: Offer): LodgingOfferDetails | null {
  return offer.lodging_details ?? null
}

function getHotelCoordinates(offer: Offer) {
  const details = getHotelDetails(offer)
  if (details?.latitude == null || details.longitude == null) return null
  return { latitude: details.latitude, longitude: details.longitude }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getHotelNightlyPrice(offer: Offer) {
  return numericPrice(getHotelDetails(offer)?.nightly_rate_amount)
}

function getHotelSentiment(offer: Offer) {
  return getHotelDetails(offer)?.sentiment_rating ?? null
}

function getHotelStarRating(offer: Offer) {
  return getHotelDetails(offer)?.star_rating ?? null
}

function matchesPriceBucket(price: number, bucket: PriceBucket) {
  if (bucket === 'all') return true
  if (bucket === 'under-150') return price < 150
  if (bucket === '150-300') return price >= 150 && price < 300
  if (bucket === '300-500') return price >= 300 && price < 500
  return price >= 500
}

function matchesStopsFilter(stops: number, filter: StopsFilter) {
  if (filter === 'all') return true
  if (filter === 'nonstop') return stops === 0
  if (filter === '1') return stops === 1
  return stops >= 2
}

function matchesDepartureBucket(hour: number | null, bucket: FlightDepartureBucket) {
  if (bucket === 'all' || hour == null) return true
  if (bucket === 'morning') return hour >= 5 && hour < 12
  if (bucket === 'afternoon') return hour >= 12 && hour < 17
  if (bucket === 'evening') return hour >= 17 && hour < 22
  return hour >= 22 || hour < 5
}

function matchesDurationBucket(durationMin: number | null, bucket: FlightDurationBucket) {
  if (bucket === 'all' || durationMin == null) return true
  if (bucket === 'under-180') return durationMin < 180
  if (bucket === '180-360') return durationMin >= 180 && durationMin < 360
  return durationMin >= 360
}

function matchesStarBucket(rating: number | null, bucket: HotelStarBucket) {
  if (bucket === 'all') return true
  if (rating == null) return false
  if (bucket === '3+') return rating >= 3
  if (bucket === '4+') return rating >= 4
  return rating >= 5
}

function getJobErrorMessage(job: { result?: Record<string, unknown> | null; error?: unknown } | undefined) {
  const firstError = getJobResultErrors(job as never)[0]
  if (typeof firstError === 'string') return firstError
  if (firstError && typeof firstError === 'object' && 'message' in firstError) {
    return String(firstError.message)
  }
  if (job?.error && typeof job.error === 'object' && job.error && 'message' in job.error) {
    return String(job.error.message)
  }
  return 'The provider returned an error while refreshing offers.'
}

function dayBadgeLabel(day: Day | null) {
  if (!day) return 'Trip-wide'
  return `Day ${day.day_index + 1} · ${format(new Date(day.date), 'MMM d')}`
}

function compareFlightOffers(
  left: Offer,
  right: Offer,
  sort: FlightSort,
  focusedDayId: string | null,
  ranges: {
    price: { min: number; max: number }
    duration: { min: number; max: number }
    stops: { min: number; max: number }
  },
) {
  const priority = getOfferPriority(left, focusedDayId) - getOfferPriority(right, focusedDayId)
  if (priority !== 0) return priority

  if (sort === 'best') {
    const score =
      getFlightBestScore(left, ranges.price, ranges.duration, ranges.stops) -
      getFlightBestScore(right, ranges.price, ranges.duration, ranges.stops)
    if (score !== 0) return score
  }

  if (sort === 'cheapest') {
    const price = numericPrice(left.price_amount) - numericPrice(right.price_amount)
    if (price !== 0) return price
  }

  if (sort === 'fastest') {
    const duration = (getFlightDuration(left) ?? Number.MAX_SAFE_INTEGER) - (getFlightDuration(right) ?? Number.MAX_SAFE_INTEGER)
    if (duration !== 0) return duration
  }

  if (sort === 'earliest') {
    const depart = (parseDate(getFlightDepartureTime(left))?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (parseDate(getFlightDepartureTime(right))?.getTime() ?? Number.MAX_SAFE_INTEGER)
    if (depart !== 0) return depart
  }

  const earliestTieBreak =
    (parseDate(getFlightDepartureTime(left))?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (parseDate(getFlightDepartureTime(right))?.getTime() ?? Number.MAX_SAFE_INTEGER)
  if (earliestTieBreak !== 0) return earliestTieBreak

  return numericPrice(left.price_amount) - numericPrice(right.price_amount)
}

function compareHotelOffers(left: Offer, right: Offer, sort: HotelSort, focusedDayId: string | null) {
  const priority = getOfferPriority(left, focusedDayId) - getOfferPriority(right, focusedDayId)
  if (priority !== 0) return priority

  if (sort === 'rating') {
    const ratingDelta = (getHotelStarRating(right) ?? -1) - (getHotelStarRating(left) ?? -1)
    if (ratingDelta !== 0) return ratingDelta
  }

  if (sort === 'recommended') {
    const sentimentDelta = (getHotelSentiment(right) ?? -1) - (getHotelSentiment(left) ?? -1)
    if (sentimentDelta !== 0) return sentimentDelta

    const priceDelta = numericPrice(left.price_amount) - numericPrice(right.price_amount)
    if (priceDelta !== 0) return priceDelta

    const distanceDelta =
      (getHotelDetails(left)?.distance_km ?? Number.MAX_SAFE_INTEGER) -
      (getHotelDetails(right)?.distance_km ?? Number.MAX_SAFE_INTEGER)
    if (distanceDelta !== 0) return distanceDelta
  }

  return numericPrice(left.price_amount) - numericPrice(right.price_amount)
}

function InlineModeIssue({ issue }: { issue: ModeIssue | null }) {
  if (!issue) return null

  return (
    <Alert
      variant={issue.variant === 'warning' ? 'warning' : issue.variant === 'destructive' ? 'destructive' : 'default'}
      className="rounded-[10px] border-black/8 bg-white p-3.5 shadow-none"
    >
      <CircleAlert className="h-4 w-4" />
      <div>
        <AlertTitle>{issue.title}</AlertTitle>
        <AlertDescription>{issue.description}</AlertDescription>
      </div>
    </Alert>
  )
}

function ValuePill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3
  label: string
  value: string
}) {
  return (
    <div className="rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-sm font-medium text-[var(--color-text)]">{value}</p>
    </div>
  )
}

function MapUnavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-6 text-center">
      <MapPin className="h-7 w-7 text-[var(--color-primary-foreground)]" />
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">Map unavailable</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{message}</p>
      </div>
    </div>
  )
}

function OfferMapCanvas({
  mode,
  selectedFlight,
  hotelOffers,
  selectedHotelId,
  onSelectHotel,
  tripLayers,
}: {
  mode: OfferMode
  selectedFlight: Offer | null
  hotelOffers: Offer[]
  selectedHotelId: string | null
  onSelectHotel: (offerId: string) => void
  tripLayers: TripMapLayer[]
}) {
  const hotelMarkers = useMemo(
    () =>
      hotelOffers
        .map((offer) => {
          const coords = getHotelCoordinates(offer)
          if (!coords) return null
          return { offer, ...coords }
        })
        .filter((item): item is { offer: Offer; latitude: number; longitude: number } => item != null),
    [hotelOffers],
  )

  const selectedFlightRoute = useMemo(() => {
    const details = selectedFlight?.transport_details
    if (!details?.origin_geo || !details.destination_geo) return null

    return [
      { lat: details.origin_geo.latitude, lng: details.origin_geo.longitude },
      { lat: details.destination_geo.latitude, lng: details.destination_geo.longitude },
    ]
  }, [selectedFlight])
  const selectedHotelMarker = hotelMarkers.find((item) => item.offer.id === selectedHotelId) ?? null
  const clusteredHotelMarkers = hotelMarkers
    .filter((item) => item.offer.id !== selectedHotelId)
    .map((item) => ({
      id: item.offer.id,
      position: { lat: item.latitude, lng: item.longitude },
      title: item.offer.title,
      label: formatMoney(item.offer.price_amount, item.offer.currency) || 'Offer',
      color: '#17344C',
    }))

  if (!config.map.apiKey) {
    return (
      <MapUnavailable
        message="Set `VITE_GOOGLE_MAPS_API_KEY` to enable the interactive map canvas."
      />
    )
  }

  const lodgingBoundsPoints = hotelMarkers.map((item) => ({
    lat: item.latitude,
    lng: item.longitude,
  }))

  return (
    <div className="overflow-hidden rounded-[12px] border border-black/8">
      <GoogleMapCanvas
        defaultCenter={{ lat: 48.8566, lng: 2.3522 }}
        defaultZoom={4.1}
        style={{ minHeight: 240 }}
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
      >
        <TripMapLayerRenderer layers={tripLayers} />
        {mode === 'transport' && selectedFlightRoute ? (
          <>
            <MapFitBounds points={selectedFlightRoute} />
            <GooglePolyline
              path={selectedFlightRoute}
              strokeColor="#17344C"
              strokeOpacity={0.8}
              strokeWeight={3}
            />
            {selectedFlight?.transport_details?.origin_geo ? (
              <VoyagerMarker
                position={{
                  lat: selectedFlight.transport_details.origin_geo.latitude,
                  lng: selectedFlight.transport_details.origin_geo.longitude,
                }}
                label="Origin"
                color="#17344C"
              />
            ) : null}
            {selectedFlight?.transport_details?.destination_geo ? (
              <VoyagerMarker
                position={{
                  lat: selectedFlight.transport_details.destination_geo.latitude,
                  lng: selectedFlight.transport_details.destination_geo.longitude,
                }}
                label="Destination"
                selected
              />
            ) : null}
          </>
        ) : null}
        {mode === 'lodging' && lodgingBoundsPoints.length > 0 ? (
          <MapFitBounds points={lodgingBoundsPoints} />
        ) : null}
        {mode === 'lodging' ? (
          <>
            <VoyagerMarkerClusterLayer
              items={clusteredHotelMarkers}
              onMarkerClick={(item) => onSelectHotel(item.id)}
            />
            {selectedHotelMarker ? (
              <VoyagerMarker
                position={{ lat: selectedHotelMarker.latitude, lng: selectedHotelMarker.longitude }}
                title={selectedHotelMarker.offer.title}
                label={formatMoney(selectedHotelMarker.offer.price_amount, selectedHotelMarker.offer.currency) || 'Offer'}
                selected
                onClick={() => onSelectHotel(selectedHotelMarker.offer.id)}
                zIndex={3}
              />
            ) : null}
          </>
        ) : null}
      </GoogleMapCanvas>
    </div>
  )
}

function FlightTimeline({
  details,
  compact = false,
}: {
  details: TransportOfferDetails | null | undefined
  compact?: boolean
}) {
  const segments = details?.segments ?? []
  const layovers = details?.layovers ?? []

  if (segments.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Voyager does not have segment-level flight detail for this snapshot yet.
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', compact ? 'gap-2' : 'gap-4')}>
      {segments.map((segment, index) => {
        const layover = layovers.find(
          (item) =>
            item.itinerary_index === segment.itinerary_index &&
            item.airport_code === segment.arrival_iata,
        )

        return (
          <div key={`${segment.itinerary_index}-${segment.sequence}`} className="flex flex-col gap-3">
            <div className="grid gap-3 rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] px-3.5 py-3 md:grid-cols-[1fr_auto]">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Plane className="h-4 w-4 text-[var(--color-primary-foreground)]" />
                  {segment.airline_name ?? segment.airline_code ?? 'Carrier'} {segment.flight_number ?? ''}
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {formatTimeLabel(segment.departure_at)} {segment.departure_iata ?? '---'}
                  {segment.departure_terminal ? ` · T${segment.departure_terminal}` : ''}
                  {'  '}→{'  '}
                  {formatTimeLabel(segment.arrival_at)} {segment.arrival_iata ?? '---'}
                  {segment.arrival_terminal ? ` · T${segment.arrival_terminal}` : ''}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {formatDurationMinutes(segment.duration_min)} · {titleizeToken(segment.cabin)}
                  {segment.baggage_summary ? ` · ${segment.baggage_summary}` : ''}
                </p>
              </div>
              {!compact ? (
                <div className="text-right text-xs text-[var(--color-text-muted)]">
                  {segment.operating_airline_name && segment.operating_airline_name !== segment.airline_name ? (
                    <p>Operated by {segment.operating_airline_name}</p>
                  ) : null}
                  {segment.branded_fare ? <p>{titleizeToken(segment.branded_fare)}</p> : null}
                  {segment.fare_basis ? <p>Fare basis {segment.fare_basis}</p> : null}
                </div>
              ) : null}
            </div>
            {layover?.duration_min ? (
              <p className="px-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                Layover · {layover.airport_code ?? 'Airport'} · {formatDurationMinutes(layover.duration_min)}
              </p>
            ) : null}
            {index < segments.length - 1 ? <Separator /> : null}
          </div>
        )
      })}
    </div>
  )
}

function HotelHero({ offer }: { offer: Offer }) {
  const photo = getHotelDetails(offer)?.primary_photo

  if (resolvePhotoUrl(photo, 'full')) {
    return (
      <div className="overflow-hidden rounded-[12px] border border-black/8">
        <img
          src={resolvePhotoUrl(photo, 'full') || ''}
          alt={offer.title}
          className="h-44 w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className="flex h-44 items-center justify-center rounded-[12px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)]">
      <div className="text-center">
        <Hotel className="mx-auto h-8 w-8 text-[var(--color-primary-foreground)]" />
        <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{offer.title}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Photos will appear once the linked place has imagery.</p>
      </div>
    </div>
  )
}

function OffersLoadingState({ mode }: { mode: OfferMode }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: mode === 'transport' ? 3 : 2 }).map((_, index) => (
        <Card key={index} className="rounded-[12px] border-black/8 bg-white shadow-none">
          <CardContent className="flex flex-col gap-4 p-5">
            <Skeleton className="h-5 w-32 rounded-[8px]" />
            <Skeleton className="h-16 w-full rounded-[10px]" />
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-10 rounded-[8px]" />
              <Skeleton className="h-10 rounded-[8px]" />
              <Skeleton className="h-10 rounded-[8px]" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function OffersWorkspace({ tripId }: Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusedDayId = searchParams.get('dayId')
  const plannerReturnTo = searchParams.get('plannerReturnTo')
  const plannerDayId = searchParams.get('plannerDayId') ?? focusedDayId
  const plannerImportMode = Boolean(plannerReturnTo)

  const { data: trip, isLoading: tripLoading } = useTrip(tripId)
  const { data: daysData, isLoading: daysLoading } = useDays(tripId)
  const { data: tripLayersData } = useTripMapLayers(tripId)
  const {
    data: offersData,
    isLoading: offersLoading,
    isFetching: offersFetching,
  } = useTripOffers(tripId, {
    current_only: false,
    limit: 400,
    offset: 0,
  })

  const days = useMemo(() => getSortedDays(daysData?.items ?? []), [daysData?.items])
  const offers = offersData?.items ?? []
  const focusedDay = getFocusedDay(days, focusedDayId)
  const latestTransportOffer = useMemo(
    () => getLatestOffer(offers, 'transport', focusedDayId),
    [focusedDayId, offers],
  )
  const latestLodgingOffer = useMemo(
    () => getLatestOffer(offers, 'lodging', focusedDayId),
    [focusedDayId, offers],
  )

  const transportDefaults = useMemo(
    () =>
      buildTransportDefaults({
        trip,
        days,
        focusedDayId,
        latestTransportOffer,
      }),
    [days, focusedDayId, latestTransportOffer, trip],
  )
  const lodgingDefaults = useMemo(
    () =>
      buildLodgingDefaults({
        trip,
        days,
        focusedDayId,
        latestLodgingOffer,
        latestTransportOffer,
      }),
    [days, focusedDayId, latestLodgingOffer, latestTransportOffer, trip],
  )

  const transportForm = useForm<TransportFormValues>({
    resolver: zodResolver(transportSchema),
    defaultValues: transportDefaults,
  })
  const lodgingForm = useForm<LodgingFormValues>({
    resolver: zodResolver(lodgingSchema),
    defaultValues: lodgingDefaults,
  })

  const transportPrefillKeyRef = useRef('')
  const lodgingPrefillKeyRef = useRef('')
  const transportDirty = transportForm.formState.isDirty
  const lodgingDirty = lodgingForm.formState.isDirty

  useEffect(() => {
    const signature = JSON.stringify(transportDefaults)
    if (transportPrefillKeyRef.current === signature || transportDirty) return
    transportPrefillKeyRef.current = signature
    transportForm.reset(transportDefaults)
  }, [transportDefaults, transportDirty, transportForm])

  useEffect(() => {
    const signature = JSON.stringify(lodgingDefaults)
    if (lodgingPrefillKeyRef.current === signature || lodgingDirty) return
    lodgingPrefillKeyRef.current = signature
    lodgingForm.reset(lodgingDefaults)
  }, [lodgingDefaults, lodgingDirty, lodgingForm])

  const transportSearchMutation = useSubmitTransportOfferSearch(tripId)
  const lodgingSearchMutation = useSubmitLodgingOfferSearch(tripId)
  const refreshVisibleMutation = useRefreshTripOffers(tripId)
  const refreshOfferMutation = useRefreshOffer(tripId)
  const attachMutation = useAttachOfferToDay(tripId)

  const [mode, setMode] = useState<OfferMode>('transport')
  const [transportSort, setTransportSort] = useState<FlightSort>('best')
  const [hotelSort, setHotelSort] = useState<HotelSort>('recommended')
  const [transportCurrentOnly, setTransportCurrentOnly] = useState(true)
  const [hotelCurrentOnly, setHotelCurrentOnly] = useState(true)
  const [stopsFilter, setStopsFilter] = useState<StopsFilter>('all')
  const [airlineFilter, setAirlineFilter] = useState('all')
  const [flightPriceBucket, setFlightPriceBucket] = useState<PriceBucket>('all')
  const [departureBucket, setDepartureBucket] = useState<FlightDepartureBucket>('all')
  const [durationBucket, setDurationBucket] = useState<FlightDurationBucket>('all')
  const [hotelPriceBucket, setHotelPriceBucket] = useState<PriceBucket>('all')
  const [hotelStarBucket, setHotelStarBucket] = useState<HotelStarBucket>('all')
  const [hotelAmenityFilter, setHotelAmenityFilter] = useState('all')
  const [selectedTransportId, setSelectedTransportId] = useState<string | null>(null)
  const [selectedLodgingId, setSelectedLodgingId] = useState<string | null>(null)
  const [expandedTransportId, setExpandedTransportId] = useState<string | null>(null)
  const [attachingOffer, setAttachingOffer] = useState<Offer | null>(null)
  const [attachDayId, setAttachDayId] = useState(focusedDay?.id ?? '')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [queuedMode, setQueuedMode] = useState<OfferMode | null>(null)
  const [refreshingOfferId, setRefreshingOfferId] = useState<string | null>(null)
  const [modeIssue, setModeIssue] = useState<Record<OfferMode, ModeIssue | null>>({
    transport: null,
    lodging: null,
  })

  const { data: activeJob } = useJob(activeJobId)

  const importOfferIntoPlanner = async (offer: Offer) => {
    try {
      const { importOfferToPlanner } = await import('@/entities/activity/api')
      const activity = await importOfferToPlanner(
        tripId,
        {
          offer_kind: offer.kind,
          offer_id: offer.id,
          trip_day_id: plannerDayId,
        },
        crypto.randomUUID(),
      )
      await queryClient.invalidateQueries({ queryKey: ['offers', tripId] })
      await queryClient.invalidateQueries({ queryKey: ['planner', tripId] })
      toast.success('Added to planner')
      if (plannerReturnTo) {
        const separator = plannerReturnTo.includes('?') ? '&' : '?'
        navigate(`${plannerReturnTo}${separator}activityId=${activity.id}`)
      }
    } catch {
      toast.error('Unable to add this offer to the planner')
    }
  }

  const transportOffers = useMemo(
    () => offers.filter((offer) => offer.kind === 'transport'),
    [offers],
  )
  const lodgingOffers = useMemo(
    () => offers.filter((offer) => offer.kind === 'lodging'),
    [offers],
  )

  const airlineOptions = useMemo(
    () => uniqueStrings(transportOffers.map((offer) => getFlightPrimaryAirline(offer))),
    [transportOffers],
  )
  const hotelAmenities = useMemo(
    () => uniqueStrings(lodgingOffers.flatMap((offer) => getHotelDetails(offer)?.amenities ?? [])),
    [lodgingOffers],
  )

  const transportPriceRange = useMemo(() => {
    const prices = transportOffers.map((offer) => numericPrice(offer.price_amount))
    return {
      min: Math.min(...prices, 0),
      max: Math.max(...prices, 0),
    }
  }, [transportOffers])
  const transportDurationRange = useMemo(() => {
    const durations = transportOffers.map((offer) => getFlightDuration(offer) ?? 0)
    return {
      min: Math.min(...durations, 0),
      max: Math.max(...durations, 0),
    }
  }, [transportOffers])
  const transportStopRange = useMemo(() => {
    const stops = transportOffers.map((offer) => getFlightStopsCount(offer))
    return {
      min: Math.min(...stops, 0),
      max: Math.max(...stops, 0),
    }
  }, [transportOffers])

  const visibleTransportOffers = useMemo(() => {
    return [...transportOffers]
      .filter((offer) => !transportCurrentOnly || offer.is_current)
      .filter((offer) => matchesStopsFilter(getFlightStopsCount(offer), stopsFilter))
      .filter((offer) => airlineFilter === 'all' || getFlightPrimaryAirline(offer) === airlineFilter)
      .filter((offer) => matchesPriceBucket(numericPrice(offer.price_amount), flightPriceBucket))
      .filter((offer) => matchesDepartureBucket(getFlightDepartureHour(offer), departureBucket))
      .filter((offer) => matchesDurationBucket(getFlightDuration(offer), durationBucket))
      .sort((left, right) =>
        compareFlightOffers(left, right, transportSort, focusedDayId, {
          price: transportPriceRange,
          duration: transportDurationRange,
          stops: transportStopRange,
        }),
      )
  }, [
    airlineFilter,
    departureBucket,
    durationBucket,
    flightPriceBucket,
    focusedDayId,
    stopsFilter,
    transportCurrentOnly,
    transportDurationRange,
    transportOffers,
    transportPriceRange,
    transportSort,
    transportStopRange,
  ])

  const visibleLodgingOffers = useMemo(() => {
    return [...lodgingOffers]
      .filter((offer) => !hotelCurrentOnly || offer.is_current)
      .filter((offer) => matchesPriceBucket(numericPrice(offer.price_amount), hotelPriceBucket))
      .filter((offer) => matchesStarBucket(getHotelStarRating(offer), hotelStarBucket))
      .filter((offer) => hotelAmenityFilter === 'all' || (getHotelDetails(offer)?.amenities ?? []).includes(hotelAmenityFilter))
      .sort((left, right) => compareHotelOffers(left, right, hotelSort, focusedDayId))
  }, [
    focusedDayId,
    hotelAmenityFilter,
    hotelCurrentOnly,
    hotelPriceBucket,
    hotelSort,
    hotelStarBucket,
    lodgingOffers,
  ])

  useEffect(() => {
    if (transportOffers.length === 0 && lodgingOffers.length > 0) {
      setMode('lodging')
    }
  }, [lodgingOffers.length, transportOffers.length])

  useEffect(() => {
    if (visibleTransportOffers.length === 0) {
      setSelectedTransportId(null)
      setExpandedTransportId(null)
      return
    }

    if (!selectedTransportId || !visibleTransportOffers.some((offer) => offer.id === selectedTransportId)) {
      const nextId = visibleTransportOffers[0].id
      setSelectedTransportId(nextId)
      setExpandedTransportId(nextId)
    }
  }, [selectedTransportId, visibleTransportOffers])

  useEffect(() => {
    if (visibleLodgingOffers.length === 0) {
      setSelectedLodgingId(null)
      return
    }

    if (!selectedLodgingId || !visibleLodgingOffers.some((offer) => offer.id === selectedLodgingId)) {
      setSelectedLodgingId(visibleLodgingOffers[0].id)
    }
  }, [selectedLodgingId, visibleLodgingOffers])

  useEffect(() => {
    if (!activeJobId || !activeJob || !isJobTerminal(activeJob.status)) return

    if (isJobSuccessful(activeJob.status)) {
      void queryClient.invalidateQueries({ queryKey: ['offers', tripId] })
      if (queuedMode) {
        setMode(queuedMode)
      }
      toast.success(queuedMode === 'lodging' ? 'Hotel offers refreshed' : 'Flight offers refreshed')
    } else {
      toast.error(getJobErrorMessage(activeJob))
    }

    setActiveJobId(null)
    setQueuedMode(null)
    setRefreshingOfferId(null)
  }, [activeJob, activeJobId, queryClient, queuedMode, tripId])

  const selectedTransportOffer =
    visibleTransportOffers.find((offer) => offer.id === selectedTransportId) ?? null
  const selectedLodgingOffer =
    visibleLodgingOffers.find((offer) => offer.id === selectedLodgingId) ?? null
  const tripLayers = tripLayersData?.items ?? []

  const queueAcceptedJob = (jobId: string, nextMode: OfferMode) => {
    setActiveJobId(jobId)
    setQueuedMode(nextMode)
  }

  const submitTransportSearch = transportForm.handleSubmit(async (values) => {
    setModeIssue((current) => ({ ...current, transport: null }))
    const payload: TransportOfferSearchInput = {
      trip_id: tripId,
      trip_day_id: focusedDayId,
      origin_text: values.origin_text.toUpperCase(),
      destination_text: values.destination_text,
      depart_date: values.depart_date,
      return_date: values.trip_type === 'round_trip' ? values.return_date ?? null : null,
      adults: values.adults,
      currency: values.currency,
      transport_modes: ['flight'],
      providers: null,
      constraints: {},
    }

    try {
      const accepted = await transportSearchMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      queueAcceptedJob(accepted.job_id, 'transport')
      toast.success('Flight search queued')
    } catch (error) {
      if (isIntegrationNotConfigured(error)) {
        setModeIssue((current) => ({
          ...current,
          transport: {
            title: 'Flights are unavailable',
            description: 'Provider integrations are not configured for this environment.',
            variant: 'warning',
          },
        }))
        return
      }

      if (isRateLimit(error)) {
        setModeIssue((current) => ({
          ...current,
          transport: {
            title: 'Search limit reached',
            description: 'The provider is rate-limiting requests. Wait a moment and try again.',
            variant: 'warning',
          },
        }))
        return
      }

      setModeIssue((current) => ({
        ...current,
        transport: {
          title: 'Unable to search flights',
          description: 'Voyager could not queue a flight search right now.',
          variant: 'destructive',
        },
      }))
    }
  })

  const submitLodgingSearch = lodgingForm.handleSubmit(async (values) => {
    setModeIssue((current) => ({ ...current, lodging: null }))
    const payload: LodgingOfferSearchInput = {
      trip_id: tripId,
      trip_day_id: focusedDayId,
      location_text: values.location_text,
      checkin_date: values.checkin_date,
      checkout_date: values.checkout_date,
      guests: values.guests,
      currency: values.currency,
      lodging_types: ['hotel'],
      providers: null,
      constraints: {},
    }

    try {
      const accepted = await lodgingSearchMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      queueAcceptedJob(accepted.job_id, 'lodging')
      toast.success('Hotel search queued')
    } catch (error) {
      if (isIntegrationNotConfigured(error)) {
        setModeIssue((current) => ({
          ...current,
          lodging: {
            title: 'Hotels are unavailable',
            description: 'Provider integrations are not configured for this environment.',
            variant: 'warning',
          },
        }))
        return
      }

      if (isRateLimit(error)) {
        setModeIssue((current) => ({
          ...current,
          lodging: {
            title: 'Search limit reached',
            description: 'The provider is rate-limiting hotel searches. Wait a moment and try again.',
            variant: 'warning',
          },
        }))
        return
      }

      setModeIssue((current) => ({
        ...current,
        lodging: {
          title: 'Unable to search hotels',
          description: 'Voyager could not queue a hotel search right now.',
          variant: 'destructive',
        },
      }))
    }
  })

  const refreshVisibleOffers = async () => {
    const payload: TripOffersRefreshInput = {
      offer_kind: mode === 'transport' ? 'transport' : 'lodging',
      current_only: mode === 'transport' ? transportCurrentOnly : hotelCurrentOnly,
      constraints: {},
    }

    try {
      const accepted = await refreshVisibleMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      queueAcceptedJob(accepted.job_id, mode)
      toast.success(mode === 'transport' ? 'Refreshing visible flights' : 'Refreshing visible hotels')
    } catch {
      toast.error('Unable to refresh visible offers')
    }
  }

  const refreshSingleOffer = async (offer: Offer) => {
    try {
      setRefreshingOfferId(offer.id)
      const accepted = await refreshOfferMutation.mutateAsync({
        offerId: offer.id,
        data: { offer_kind: offer.kind, constraints: {} },
        idempotencyKey: crypto.randomUUID(),
      })
      queueAcceptedJob(accepted.job_id, offer.kind === 'transport' ? 'transport' : 'lodging')
    } catch {
      setRefreshingOfferId(null)
      toast.error('Unable to refresh this offer')
    }
  }

  const openAttachDialog = (offer: Offer) => {
    setAttachingOffer(offer)
    setAttachDayId(offer.trip_day_id ?? focusedDay?.id ?? days[0]?.id ?? '')
  }

  const attachOffer = async () => {
    if (!attachingOffer || !attachDayId) return

    try {
      await attachMutation.mutateAsync({
        offerId: attachingOffer.id,
        data: { offer_kind: attachingOffer.kind, trip_day_id: attachDayId },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Offer attached to day')
      setAttachingOffer(null)
    } catch {
      toast.error('Unable to attach this offer')
    }
  }

  const transportIssue = modeIssue.transport
  const lodgingIssue = modeIssue.lodging
  const activeLoading = tripLoading || daysLoading
  const activeJobRunning = isJobRunning(activeJob?.status)
  const transportSearchPending = transportSearchMutation.isPending || (queuedMode === 'transport' && activeJobRunning)
  const lodgingSearchPending = lodgingSearchMutation.isPending || (queuedMode === 'lodging' && activeJobRunning)
  const headerMeta = useMemo(() => {
    if (!trip) return null

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate font-medium text-[var(--color-text)]">{trip.title}</span>
        <span className="hidden text-black/20 lg:inline">•</span>
        <span className="truncate">{trip.destination_text}</span>
        <span className="hidden text-black/20 lg:inline">•</span>
        <span className="truncate">{`${format(new Date(trip.start_date), 'MMM d')} - ${format(
          new Date(trip.end_date),
          'MMM d, yyyy',
        )}`}</span>
        {trip.budget_amount && trip.budget_currency ? (
          <>
            <span className="hidden text-black/20 xl:inline">•</span>
            <span className="truncate">{`Budget ${formatMoney(trip.budget_amount, trip.budget_currency)}`}</span>
          </>
        ) : null}
        {focusedDay ? (
          <>
            <span className="hidden text-black/20 xl:inline">•</span>
            <span className="truncate">{`Scoped to ${dayBadgeLabel(focusedDay)}`}</span>
          </>
        ) : null}
      </div>
    )
  }, [focusedDay, trip])
  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex items-center rounded-[8px] border border-black/8 bg-[var(--color-secondary-surface)] p-0.5">
          <button
            type="button"
            onClick={() => setMode('transport')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[0.78rem] font-medium transition-colors',
              mode === 'transport'
                ? 'bg-[var(--color-text)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            <Plane className="h-3.5 w-3.5" />
            Flights
          </button>
          <button
            type="button"
            onClick={() => setMode('lodging')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[0.78rem] font-medium transition-colors',
              mode === 'lodging'
                ? 'bg-[var(--color-text)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            <Hotel className="h-3.5 w-3.5" />
            Hotels
          </button>
        </div>
        <Button
          variant="outline"
          onClick={refreshVisibleOffers}
          disabled={refreshVisibleMutation.isPending || activeJobRunning}
          className="h-8 rounded-[8px] px-3.5 text-[0.84rem] font-medium shadow-none hover:shadow-none"
        >
          {refreshVisibleMutation.isPending || (activeJobRunning && !refreshingOfferId) ? (
            <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw data-icon="inline-start" className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>
    ),
    [activeJobRunning, mode, refreshVisibleMutation.isPending, refreshingOfferId],
  )
  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)
  const hasShellHeaderMeta = useAppShellHeaderMeta(headerMeta)
  const showInlineMeta = !hasShellHeaderMeta && headerMeta != null
  const showInlineActions = !hasShellHeaderActions

  return (
    <>
      <WorkspacePage className="gap-4">
        {showInlineMeta || showInlineActions ? (
          <section className="rounded-[12px] border border-black/8 bg-white px-4 py-3">
            {showInlineMeta ? (
              <div className="text-sm text-[var(--color-text-muted)]">{headerMeta}</div>
            ) : null}
            {showInlineActions ? (
              <div className={cn('flex flex-wrap gap-2', showInlineMeta && 'mt-3 border-t border-black/8 pt-3')}>
                {headerActions}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-[12px] border border-black/8 bg-white p-4">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-medium text-[var(--color-text)]">
                {mode === 'transport' ? 'Flight search' : 'Hotel search'}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {focusedDay
                  ? `New results attach to ${dayBadgeLabel(focusedDay)} by default.`
                  : 'Search live offer snapshots for this trip.'}
              </p>
            </div>

            {mode === 'transport' ? (
              <form onSubmit={submitTransportSearch} className="flex flex-col gap-4">
                <FieldGroup className="gap-4 xl:grid xl:grid-cols-[0.8fr_1fr_1fr_0.9fr_0.9fr_0.7fr_0.7fr]">
                  <Field data-invalid={Boolean(transportForm.formState.errors.trip_type)}>
                    <FieldLabel htmlFor="transport-trip-type">Trip type</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={transportForm.control}
                        name="trip_type"
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={(nextValue) => {
                              field.onChange(nextValue)
                              if (nextValue === 'one_way') {
                                transportForm.setValue('return_date', null, { shouldDirty: true })
                              } else if (!transportForm.getValues('return_date')) {
                                transportForm.setValue('return_date', plusOneDay(transportForm.getValues('depart_date')), {
                                  shouldDirty: true,
                                })
                              }
                            }}
                          >
                            <SelectTrigger id="transport-trip-type" className="h-10 rounded-[8px] bg-white">
                              <ArrowRightLeft className="mr-2 h-4 w-4 text-[var(--color-text-muted)]" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="round_trip">Round trip</SelectItem>
                                <SelectItem value="one_way">One way</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError errors={[transportForm.formState.errors.trip_type]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.origin_text)}>
                    <FieldLabel htmlFor="transport-origin">Origin</FieldLabel>
                    <FieldContent>
                      <Input
                        id="transport-origin"
                        placeholder="Origin airport or city"
                        className="h-10 rounded-[8px] bg-white"
                        {...transportForm.register('origin_text')}
                      />
                      <FieldError errors={[transportForm.formState.errors.origin_text]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.destination_text)}>
                    <FieldLabel htmlFor="transport-destination">Destination</FieldLabel>
                    <FieldContent>
                      <Input
                        id="transport-destination"
                        placeholder="Destination airport or city"
                        className="h-10 rounded-[8px] bg-white"
                        {...transportForm.register('destination_text')}
                      />
                      <FieldError errors={[transportForm.formState.errors.destination_text]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.depart_date)}>
                    <FieldLabel htmlFor="transport-depart">Depart</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={transportForm.control}
                        name="depart_date"
                        render={({ field }) => (
                          <DatePicker
                            id="transport-depart"
                            value={field.value}
                            onChange={field.onChange}
                            invalid={Boolean(transportForm.formState.errors.depart_date)}
                            className="h-10 rounded-[8px] bg-white"
                          />
                        )}
                      />
                      <FieldError errors={[transportForm.formState.errors.depart_date]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.return_date)}>
                    <FieldLabel htmlFor="transport-return">Return</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={transportForm.control}
                        name="return_date"
                        render={({ field }) => (
                          <DatePicker
                            id="transport-return"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            disabled={transportForm.watch('trip_type') === 'one_way'}
                            invalid={Boolean(transportForm.formState.errors.return_date)}
                            placeholder="Optional"
                            className="h-10 rounded-[8px] bg-white"
                          />
                        )}
                      />
                      <FieldError errors={[transportForm.formState.errors.return_date]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.adults)}>
                    <FieldLabel htmlFor="transport-adults">Adults</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={transportForm.control}
                        name="adults"
                        render={({ field }) => (
                          <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                            <SelectTrigger id="transport-adults" className="h-10 rounded-[8px] bg-white">
                              <Users className="mr-2 h-4 w-4 text-[var(--color-text-muted)]" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {ADULT_OPTIONS.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {value} adult{value === '1' ? '' : 's'}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError errors={[transportForm.formState.errors.adults]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(transportForm.formState.errors.currency)}>
                    <FieldLabel htmlFor="transport-currency">Currency</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={transportForm.control}
                        name="currency"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="transport-currency" className="h-10 rounded-[8px] bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {DEFAULT_CURRENCIES.map((currency) => (
                                  <SelectItem key={currency} value={currency}>
                                    {currency}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError errors={[transportForm.formState.errors.currency]} />
                    </FieldContent>
                  </Field>
                </FieldGroup>

                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {transportIssue ? (
                      <InlineModeIssue issue={transportIssue} />
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Search snapshots stay trip-wide until you attach them to a specific day.
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={transportSearchPending} className="h-10 rounded-[8px] px-4">
                    {transportSearchPending ? (
                      <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search data-icon="inline-start" className="h-4 w-4" />
                    )}
                    Search flights
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitLodgingSearch} className="flex flex-col gap-4">
                <FieldGroup className="gap-4 xl:grid xl:grid-cols-[1.25fr_0.95fr_0.95fr_0.72fr_0.72fr]">
                  <Field data-invalid={Boolean(lodgingForm.formState.errors.location_text)}>
                    <FieldLabel htmlFor="hotel-location">Location</FieldLabel>
                    <FieldContent>
                      <Input
                        id="hotel-location"
                        placeholder="City or destination"
                        className="h-10 rounded-[8px] bg-white"
                        {...lodgingForm.register('location_text')}
                      />
                      <FieldError errors={[lodgingForm.formState.errors.location_text]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(lodgingForm.formState.errors.checkin_date)}>
                    <FieldLabel htmlFor="hotel-checkin">Check-in</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={lodgingForm.control}
                        name="checkin_date"
                        render={({ field }) => (
                          <DatePicker
                            id="hotel-checkin"
                            value={field.value}
                            onChange={field.onChange}
                            invalid={Boolean(lodgingForm.formState.errors.checkin_date)}
                            className="h-10 rounded-[8px] bg-white"
                          />
                        )}
                      />
                      <FieldError errors={[lodgingForm.formState.errors.checkin_date]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(lodgingForm.formState.errors.checkout_date)}>
                    <FieldLabel htmlFor="hotel-checkout">Check-out</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={lodgingForm.control}
                        name="checkout_date"
                        render={({ field }) => (
                          <DatePicker
                            id="hotel-checkout"
                            value={field.value}
                            onChange={field.onChange}
                            invalid={Boolean(lodgingForm.formState.errors.checkout_date)}
                            className="h-10 rounded-[8px] bg-white"
                          />
                        )}
                      />
                      <FieldError errors={[lodgingForm.formState.errors.checkout_date]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(lodgingForm.formState.errors.guests)}>
                    <FieldLabel htmlFor="hotel-guests">Guests</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={lodgingForm.control}
                        name="guests"
                        render={({ field }) => (
                          <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                            <SelectTrigger id="hotel-guests" className="h-10 rounded-[8px] bg-white">
                              <Users className="mr-2 h-4 w-4 text-[var(--color-text-muted)]" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {GUEST_OPTIONS.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {value} guest{value === '1' ? '' : 's'}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError errors={[lodgingForm.formState.errors.guests]} />
                    </FieldContent>
                  </Field>

                  <Field data-invalid={Boolean(lodgingForm.formState.errors.currency)}>
                    <FieldLabel htmlFor="hotel-currency">Currency</FieldLabel>
                    <FieldContent>
                      <Controller
                        control={lodgingForm.control}
                        name="currency"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="hotel-currency" className="h-10 rounded-[8px] bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {DEFAULT_CURRENCIES.map((currency) => (
                                  <SelectItem key={currency} value={currency}>
                                    {currency}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError errors={[lodgingForm.formState.errors.currency]} />
                    </FieldContent>
                  </Field>
                </FieldGroup>

                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {lodgingIssue ? (
                      <InlineModeIssue issue={lodgingIssue} />
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Hotel snapshots keep address, pricing, and place-photo links when provider data is available.
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={lodgingSearchPending} className="h-10 rounded-[8px] px-4">
                    {lodgingSearchPending ? (
                      <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search data-icon="inline-start" className="h-4 w-4" />
                    )}
                    Search hotels
                  </Button>
                </div>
              </form>
            )}

            {activeJobRunning ? (
              <Alert className="rounded-[10px] border-black/8 bg-[var(--color-secondary-surface)] p-3.5 shadow-none">
                <Loader2 className="h-4 w-4 animate-spin" />
                <div>
                  <AlertTitle>
                    {queuedMode === 'lodging' ? 'Refreshing hotel results' : 'Refreshing flight results'}
                  </AlertTitle>
                  <AlertDescription>
                    Voyager will refetch this list when the provider refresh finishes.
                  </AlertDescription>
                </div>
              </Alert>
            ) : null}
          </div>
        </section>

        {mode === 'transport' ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 flex flex-col gap-4">
              <section className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-medium text-[var(--color-text)]">Flights</h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {offersFetching ? 'Refreshing results' : `${visibleTransportOffers.length} result${visibleTransportOffers.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-[8px] border border-black/8 bg-white px-3 py-2 text-sm text-[var(--color-text-muted)]">
                    <Checkbox
                      checked={transportCurrentOnly}
                      onCheckedChange={(checked) => setTransportCurrentOnly(checked === true)}
                      aria-label="Current only"
                    />
                    Current only
                  </label>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <FilterSelect
                    label="Sort"
                    value={transportSort}
                    onValueChange={(value) => setTransportSort(value as FlightSort)}
                    options={[
                      { value: 'best', label: 'Best' },
                      { value: 'cheapest', label: 'Cheapest' },
                      { value: 'fastest', label: 'Fastest' },
                      { value: 'earliest', label: 'Earliest' },
                    ]}
                  />
                  <FilterSelect
                    label="Stops"
                    value={stopsFilter}
                    onValueChange={(value) => setStopsFilter(value as StopsFilter)}
                    options={[
                      { value: 'all', label: 'All stops' },
                      { value: 'nonstop', label: 'Nonstop' },
                      { value: '1', label: '1 stop' },
                      { value: '2+', label: '2+ stops' },
                    ]}
                  />
                  <FilterSelect
                    label="Airline"
                    value={airlineFilter}
                    onValueChange={setAirlineFilter}
                    options={[
                      { value: 'all', label: 'All airlines' },
                      ...airlineOptions.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                  <FilterSelect
                    label="Price"
                    value={flightPriceBucket}
                    onValueChange={(value) => setFlightPriceBucket(value as PriceBucket)}
                    options={[
                      { value: 'all', label: 'Any price' },
                      { value: 'under-150', label: 'Under 150' },
                      { value: '150-300', label: '150-300' },
                      { value: '300-500', label: '300-500' },
                      { value: '500+', label: '500+' },
                    ]}
                  />
                  <FilterSelect
                    label="Departure"
                    value={departureBucket}
                    onValueChange={(value) => setDepartureBucket(value as FlightDepartureBucket)}
                    options={[
                      { value: 'all', label: 'Any time' },
                      { value: 'morning', label: 'Morning' },
                      { value: 'afternoon', label: 'Afternoon' },
                      { value: 'evening', label: 'Evening' },
                      { value: 'overnight', label: 'Overnight' },
                    ]}
                  />
                  <FilterSelect
                    label="Duration"
                    value={durationBucket}
                    onValueChange={(value) => setDurationBucket(value as FlightDurationBucket)}
                    options={[
                      { value: 'all', label: 'Any duration' },
                      { value: 'under-180', label: 'Under 3 hr' },
                      { value: '180-360', label: '3-6 hr' },
                      { value: '360+', label: '6+ hr' },
                    ]}
                  />
                </div>
              </section>

              {offersLoading || activeLoading ? (
                <OffersLoadingState mode="transport" />
              ) : visibleTransportOffers.length === 0 ? (
                <Card className="rounded-[12px] border-dashed border-black/8 bg-white shadow-none">
                  <CardContent className="flex flex-col gap-3 p-8 text-center">
                    <Plane className="mx-auto h-8 w-8 text-[var(--color-primary-foreground)]" />
                    <div>
                      <p className="text-lg font-semibold text-[var(--color-text)]">No flights match the current filters</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Broaden the filters or run a new search with different dates or airports.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-3">
                  {visibleTransportOffers.map((offer, index) => {
                    const selected = offer.id === selectedTransportId
                    const expanded = offer.id === expandedTransportId
                    const departure = getFlightDepartureTime(offer)
                    const arrival = getFlightArrivalTime(offer)
                    const details = offer.transport_details
                    const stopsCount = getFlightStopsCount(offer)
                    const stopLabel = stopsCount === 0 ? 'Nonstop' : `${stopsCount} stop${stopsCount === 1 ? '' : 's'}`
                    const departureDayMatch = focusedDayId && offer.trip_day_id === focusedDayId

                    return (
                      <Card
                        key={offer.id}
                        className={cn(
                          'overflow-hidden rounded-[12px] border border-black/8 bg-white shadow-none',
                          selected && 'border-[var(--color-primary)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTransportId(offer.id)
                            setExpandedTransportId((current) => current === offer.id ? null : offer.id)
                          }}
                          className="w-full text-left"
                        >
                          <CardContent className="flex flex-col gap-4 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-medium text-[var(--color-text)]">
                                    {getFlightPrimaryAirline(offer)}
                                  </p>
                                  {index === 0 && transportSort === 'best' ? <Badge>Best</Badge> : null}
                                  {offer.is_current ? (
                                    <Badge variant="secondary">
                                      <ShieldCheck className="mr-1 h-3 w-3" />
                                      Current
                                    </Badge>
                                  ) : null}
                                  {offer.trip_day_id ? (
                                    <Badge variant="outline">
                                      Attached · Day {(days.find((day) => day.id === offer.trip_day_id)?.day_index ?? 0) + 1}
                                    </Badge>
                                  ) : null}
                                  {departureDayMatch ? <Badge variant="outline">Day scoped</Badge> : null}
                                </div>
                                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                                  {offer.origin_text ?? 'Origin'} → {offer.destination_text ?? 'Destination'}
                                </p>
                              </div>
                              <div className="text-left md:text-right">
                                <p className="text-xl font-semibold text-[var(--color-text)]">
                                  {formatMoney(offer.price_amount, offer.currency)}
                                </p>
                                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                  Expires {formatDateTimeLabel(offer.expires_at)}
                                </p>
                              </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-4">
                              <ValuePill
                                icon={Plane}
                                label="Route"
                                value={`${formatTimeLabel(departure)} → ${formatTimeLabel(arrival)}`}
                              />
                              <ValuePill
                                icon={Clock3}
                                label="Duration"
                                value={formatDurationMinutes(getFlightDuration(offer))}
                              />
                              <ValuePill
                                icon={Calendar}
                                label="Depart"
                                value={formatDateLabel(departure, 'EEE, MMM d')}
                              />
                              <ValuePill
                                icon={Sparkles}
                                label="Stops"
                                value={stopLabel}
                              />
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {details?.cabin ? <Badge variant="outline">{titleizeToken(details.cabin)}</Badge> : null}
                              {details?.baggage_summary ? <Badge variant="outline">{details.baggage_summary}</Badge> : null}
                              {details?.bookable_seats != null ? <Badge variant="outline">{details.bookable_seats} seats left</Badge> : null}
                            </div>
                          </CardContent>
                        </button>

                        <div className="border-t border-black/8 bg-[var(--color-secondary-surface)] px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => openAttachDialog(offer)} className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
                              <Ticket data-icon="inline-start" className="h-4 w-4" />
                              Attach to day
                            </Button>
                            {plannerImportMode ? (
                              <Button className="h-8 rounded-[8px] px-3.5" onClick={() => importOfferIntoPlanner(offer)}>
                                <Sparkles data-icon="inline-start" className="h-4 w-4" />
                                Add to planner
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() => refreshSingleOffer(offer)}
                              disabled={refreshingOfferId === offer.id}
                              className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none"
                            >
                              {refreshingOfferId === offer.id ? (
                                <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw data-icon="inline-start" className="h-4 w-4" />
                              )}
                              Refresh
                            </Button>
                            {offer.deep_link ? (
                              <Button variant="outline" asChild className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
                                <a href={offer.deep_link} target="_blank" rel="noreferrer">
                                  <ExternalLink data-icon="inline-start" className="h-4 w-4" />
                                  Open provider
                                </a>
                              </Button>
                            ) : null}
                          </div>

                          {expanded ? (
                            <div className="mt-4">
                              <FlightTimeline details={details} />
                            </div>
                          ) : null}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </section>

            <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
              <Card className="overflow-hidden rounded-[12px] border-black/8 bg-white shadow-none">
                <CardHeader className="gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-medium">Flight detail</CardTitle>
                      <CardDescription>
                        {selectedTransportOffer ? 'Selected route and provider detail.' : 'Select a flight result to inspect it.'}
                      </CardDescription>
                    </div>
                    {selectedTransportOffer?.trip_day_id ? (
                      <Badge variant="outline">
                        Attached · Day {(days.find((day) => day.id === selectedTransportOffer.trip_day_id)?.day_index ?? 0) + 1}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>

                <div className="px-4 pb-4">
                  <OfferMapCanvas
                    mode="transport"
                    selectedFlight={selectedTransportOffer}
                    hotelOffers={[]}
                    selectedHotelId={null}
                    onSelectHotel={() => undefined}
                    tripLayers={tripLayers}
                  />
                </div>

                <CardContent className="flex flex-col gap-4 border-t border-black/8 p-4">
                  {selectedTransportOffer ? (
                    <>
                      <div>
                        <p className="text-lg font-semibold text-[var(--color-text)]">
                          {selectedTransportOffer.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                          {selectedTransportOffer.origin_text ?? 'Origin'} → {selectedTransportOffer.destination_text ?? 'Destination'}
                        </p>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <ValuePill
                          icon={Sparkles}
                          label="Price"
                          value={formatMoney(selectedTransportOffer.price_amount, selectedTransportOffer.currency) || ''}
                        />
                        <ValuePill
                          icon={Clock3}
                          label="Duration"
                          value={formatDurationMinutes(getFlightDuration(selectedTransportOffer))}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {selectedTransportOffer.transport_details?.validating_airline_codes?.map((code) => (
                          <Badge key={code} variant="outline">
                            Validating {code}
                          </Badge>
                        ))}
                        {selectedTransportOffer.transport_details?.cabin ? (
                          <Badge variant="outline">{titleizeToken(selectedTransportOffer.transport_details.cabin)}</Badge>
                        ) : null}
                        {selectedTransportOffer.transport_details?.baggage_summary ? (
                          <Badge variant="outline">{selectedTransportOffer.transport_details.baggage_summary}</Badge>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3">
                        <p className="text-sm font-medium text-[var(--color-text)]">Segment timeline</p>
                        <FlightTimeline details={selectedTransportOffer.transport_details} compact />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <ValuePill
                          icon={Calendar}
                          label="Depart"
                          value={formatDateLabel(getFlightDepartureTime(selectedTransportOffer), 'EEE, MMM d')}
                        />
                        <ValuePill
                          icon={Calendar}
                          label="Arrival"
                          value={formatDateLabel(getFlightArrivalTime(selectedTransportOffer), 'EEE, MMM d')}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <Plane className="mx-auto h-8 w-8 text-[var(--color-primary-foreground)]" />
                      <p className="mt-3 text-sm font-medium text-[var(--color-text)]">No flight selected</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Choose a result to inspect the route and provider details.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0 flex flex-col gap-4">
              <section className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-medium text-[var(--color-text)]">Hotels</h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {offersFetching ? 'Refreshing results' : `${visibleLodgingOffers.length} result${visibleLodgingOffers.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-[8px] border border-black/8 bg-white px-3 py-2 text-sm text-[var(--color-text-muted)]">
                    <Checkbox
                      checked={hotelCurrentOnly}
                      onCheckedChange={(checked) => setHotelCurrentOnly(checked === true)}
                      aria-label="Current only"
                    />
                    Current only
                  </label>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <FilterSelect
                    label="Sort"
                    value={hotelSort}
                    onValueChange={(value) => setHotelSort(value as HotelSort)}
                    options={[
                      { value: 'recommended', label: 'Recommended' },
                      { value: 'price', label: 'Price' },
                      { value: 'rating', label: 'Rating' },
                    ]}
                  />
                  <FilterSelect
                    label="Price"
                    value={hotelPriceBucket}
                    onValueChange={(value) => setHotelPriceBucket(value as PriceBucket)}
                    options={[
                      { value: 'all', label: 'Any price' },
                      { value: 'under-150', label: 'Under 150' },
                      { value: '150-300', label: '150-300' },
                      { value: '300-500', label: '300-500' },
                      { value: '500+', label: '500+' },
                    ]}
                  />
                  <FilterSelect
                    label="Stars"
                    value={hotelStarBucket}
                    onValueChange={(value) => setHotelStarBucket(value as HotelStarBucket)}
                    options={[
                      { value: 'all', label: 'Any rating' },
                      { value: '3+', label: '3+' },
                      { value: '4+', label: '4+' },
                      { value: '5', label: '5 only' },
                    ]}
                  />
                  <FilterSelect
                    label="Amenity"
                    value={hotelAmenityFilter}
                    onValueChange={setHotelAmenityFilter}
                    options={[
                      { value: 'all', label: 'All amenities' },
                      ...hotelAmenities.map((amenity) => ({ value: amenity, label: titleizeToken(amenity) })),
                    ]}
                  />
                </div>
              </section>

              {offersLoading || activeLoading ? (
                <OffersLoadingState mode="lodging" />
              ) : visibleLodgingOffers.length === 0 ? (
                <Card className="rounded-[12px] border-dashed border-black/8 bg-white shadow-none">
                  <CardContent className="flex flex-col gap-3 p-8 text-center">
                    <Hotel className="mx-auto h-8 w-8 text-[var(--color-primary-foreground)]" />
                    <div>
                      <p className="text-lg font-semibold text-[var(--color-text)]">No hotels match the current filters</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Remove a star, amenity, or price constraint to widen the set of visible stays.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-3">
                  {visibleLodgingOffers.map((offer) => {
                    const selected = offer.id === selectedLodgingId
                    const details = getHotelDetails(offer)
                    const photo = details?.primary_photo

                    return (
                      <Card
                        key={offer.id}
                        className={cn(
                          'overflow-hidden rounded-[12px] border border-black/8 bg-white shadow-none',
                          selected && 'border-[var(--color-primary)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedLodgingId(offer.id)}
                          className="w-full text-left"
                        >
                          <CardContent className="grid gap-3 p-4 md:grid-cols-[132px_1fr_auto]">
                            <div className="overflow-hidden rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)]">
                              {resolvePhotoUrl(photo, 'thumb') ? (
                                <img
                                  src={resolvePhotoUrl(photo, 'thumb') || ''}
                                  alt={offer.title}
                                  className="h-full min-h-[112px] w-full object-cover"
                                />
                              ) : (
                                <div className="flex min-h-[112px] items-center justify-center bg-[var(--color-secondary-surface)]">
                                  <Hotel className="h-7 w-7 text-[var(--color-primary-foreground)]" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-medium text-[var(--color-text)]">{offer.title}</p>
                                {offer.is_current ? (
                                  <Badge variant="secondary">
                                    <ShieldCheck className="mr-1 h-3 w-3" />
                                    Current
                                  </Badge>
                                ) : null}
                                {offer.trip_day_id ? (
                                  <Badge variant="outline">
                                    Attached · Day {(days.find((day) => day.id === offer.trip_day_id)?.day_index ?? 0) + 1}
                                  </Badge>
                                ) : null}
                                {details?.star_rating != null ? (
                                  <Badge variant="outline">
                                    <Star className="mr-1 h-3 w-3" />
                                    {details.star_rating.toFixed(1)}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                                {details?.address_text ?? offer.location_text ?? 'Address unavailable'}
                              </p>
                              <p className="mt-2 line-clamp-2 text-sm text-[var(--color-text)]">
                                {details?.room_description ?? offer.room_type ?? 'Room details unavailable'}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(details?.amenities ?? []).slice(0, 3).map((amenity) => (
                                  <Badge key={amenity} variant="outline">
                                    {titleizeToken(amenity)}
                                  </Badge>
                                ))}
                              </div>
                            </div>

                            <div className="text-left md:text-right">
                              <p className="text-xl font-semibold text-[var(--color-text)]">
                                {formatMoney(offer.price_amount, offer.currency)}
                              </p>
                              {details?.nightly_rate_amount ? (
                                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                                  {formatMoney(details.nightly_rate_amount, offer.currency)} / night
                                </p>
                              ) : null}
                              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                                {formatDateLabel(offer.checkin_date, 'MMM d')} - {formatDateLabel(offer.checkout_date, 'MMM d')}
                              </p>
                            </div>
                          </CardContent>
                        </button>

                        <div className="border-t border-black/8 bg-[var(--color-secondary-surface)] px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => openAttachDialog(offer)} className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
                              <Ticket data-icon="inline-start" className="h-4 w-4" />
                              Attach to day
                            </Button>
                            {plannerImportMode ? (
                              <Button className="h-8 rounded-[8px] px-3.5" onClick={() => importOfferIntoPlanner(offer)}>
                                <Sparkles data-icon="inline-start" className="h-4 w-4" />
                                Add to planner
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() => refreshSingleOffer(offer)}
                              disabled={refreshingOfferId === offer.id}
                              className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none"
                            >
                              {refreshingOfferId === offer.id ? (
                                <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw data-icon="inline-start" className="h-4 w-4" />
                              )}
                              Refresh
                            </Button>
                            {offer.deep_link ? (
                              <Button variant="outline" asChild className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
                                <a href={offer.deep_link} target="_blank" rel="noreferrer">
                                  <ExternalLink data-icon="inline-start" className="h-4 w-4" />
                                  Open provider
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </section>

            <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
              <Card className="overflow-hidden rounded-[12px] border-black/8 bg-white shadow-none">
                <CardHeader className="gap-3 p-4">
                  <div>
                    <CardTitle className="text-base font-medium">Stay detail</CardTitle>
                    <CardDescription>
                      {selectedLodgingOffer ? 'Selected stay, map marker, and policy detail.' : 'Select a hotel result to inspect it.'}
                    </CardDescription>
                  </div>
                </CardHeader>

                <div className="px-4 pb-4">
                  <OfferMapCanvas
                    mode="lodging"
                    selectedFlight={null}
                    hotelOffers={visibleLodgingOffers}
                    selectedHotelId={selectedLodgingId}
                    onSelectHotel={setSelectedLodgingId}
                    tripLayers={tripLayers}
                  />
                </div>

                <CardContent className="flex flex-col gap-4 border-t border-black/8 p-4">
                  {selectedLodgingOffer ? (
                    <>
                      <HotelHero offer={selectedLodgingOffer} />

                      <div>
                        <p className="text-lg font-semibold text-[var(--color-text)]">
                          {selectedLodgingOffer.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                          {getHotelDetails(selectedLodgingOffer)?.address_text ?? selectedLodgingOffer.location_text ?? 'Address unavailable'}
                        </p>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <ValuePill
                          icon={Sparkles}
                          label="Total"
                          value={formatMoney(selectedLodgingOffer.price_amount, selectedLodgingOffer.currency) || ''}
                        />
                        <ValuePill
                          icon={Calendar}
                          label="Stay"
                          value={`${formatDateLabel(selectedLodgingOffer.checkin_date, 'MMM d')} - ${formatDateLabel(selectedLodgingOffer.checkout_date, 'MMM d')}`}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {getHotelDetails(selectedLodgingOffer)?.star_rating != null ? (
                          <Badge variant="outline">
                            <Star className="mr-1 h-3 w-3" />
                            {getHotelDetails(selectedLodgingOffer)?.star_rating?.toFixed(1)} stars
                          </Badge>
                        ) : null}
                        {getHotelDetails(selectedLodgingOffer)?.distance_km != null ? (
                          <Badge variant="outline">
                            {getHotelDetails(selectedLodgingOffer)?.distance_km?.toFixed(1)} km from center
                          </Badge>
                        ) : null}
                        {getHotelDetails(selectedLodgingOffer)?.chain_code ? (
                          <Badge variant="outline">
                            Chain {getHotelDetails(selectedLodgingOffer)?.chain_code}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3">
                        <p className="text-sm font-medium text-[var(--color-text)]">Room and stay policy</p>
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {getHotelDetails(selectedLodgingOffer)?.room_description ?? selectedLodgingOffer.room_type ?? 'Room detail not provided by provider.'}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ValuePill
                            icon={Users}
                            label="Payment"
                            value={titleizeToken(getHotelDetails(selectedLodgingOffer)?.payment_type)}
                          />
                          <ValuePill
                            icon={Clock3}
                            label="Cancellation"
                            value={getHotelDetails(selectedLodgingOffer)?.cancellation_summary ?? 'Policy unavailable'}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(getHotelDetails(selectedLodgingOffer)?.amenities ?? []).map((amenity) => (
                          <Badge key={amenity} variant="outline">
                            {titleizeToken(amenity)}
                          </Badge>
                        ))}
                      </div>

                      {getHotelDetails(selectedLodgingOffer)?.place_id ? (
                        <PlacePhotos
                          placeId={getHotelDetails(selectedLodgingOffer)?.place_id!}
                          placeName={selectedLodgingOffer.title}
                          autoFetchWhenEmpty
                        />
                      ) : (
                        <Alert variant="warning" className="rounded-[10px] border-black/8 p-3.5 shadow-none">
                          <CircleAlert className="h-4 w-4" />
                          <div>
                            <AlertTitle>Photos are not linked yet</AlertTitle>
                            <AlertDescription>
                              This hotel snapshot does not have a linked place record yet.
                            </AlertDescription>
                          </div>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <Hotel className="mx-auto h-8 w-8 text-[var(--color-primary-foreground)]" />
                      <p className="mt-3 text-sm font-medium text-[var(--color-text)]">No stay selected</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Choose a result to inspect the map marker and stay details.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </WorkspacePage>

      <Dialog open={Boolean(attachingOffer)} onOpenChange={(open) => !open && setAttachingOffer(null)}>
        <DialogContent className="rounded-[12px]">
          <DialogHeader>
            <DialogTitle>Attach offer to day</DialogTitle>
            <DialogDescription>
              {attachingOffer ? `Choose the trip day that should receive “${attachingOffer.title}”.` : 'Choose a day.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="attach-day">Trip day</FieldLabel>
              <FieldContent>
                <Select value={attachDayId} onValueChange={setAttachDayId}>
                  <SelectTrigger id="attach-day">
                    <SelectValue placeholder="Choose a day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {days.map((day) => (
                        <SelectItem key={day.id} value={day.id}>
                          Day {day.day_index + 1} · {format(new Date(day.date), 'EEE, MMM d')}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Offers attached here become visible on the planner and overview pages.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAttachingOffer(null)}>
              Cancel
            </Button>
            <Button onClick={attachOffer} disabled={!attachDayId || attachMutation.isPending}>
              {attachMutation.isPending ? (
                <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
              ) : (
                <Ticket data-icon="inline-start" className="h-4 w-4" />
              )}
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldContent>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="h-10 rounded-[8px] bg-white shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  )
}

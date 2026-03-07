import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDays, format } from 'date-fns'
import { z } from 'zod'
import { useSearchParams } from 'react-router-dom'
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
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
  SlidersHorizontal,
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
import { isIntegrationNotConfigured, isRateLimit } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import { getJobResultErrors, isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import type {
  Day,
  LodgingOfferDetails,
  LodgingOfferSearchInput,
  Offer,
  OfferKind,
  Trip,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

function getHotelNightlyPrice(offer: Offer) {
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
      className="rounded-[18px] border-white/60 bg-white/75"
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
    <div className="rounded-[18px] border border-[var(--color-border)] bg-white/85 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-base font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  )
}

function SummarySurface({
  active,
  label,
  value,
  detail,
  onClick,
}: {
  active?: boolean
  label: string
  value: string
  detail: string
  onClick?: () => void
}) {
  const content = (
    <div
      className={cn(
        'rounded-[22px] border px-4 py-4 text-left transition-all',
        active
          ? 'border-[#2F6F73] bg-[#EEF6F3] shadow-[0_18px_40px_rgba(47,111,115,0.12)]'
          : 'border-[var(--color-border)] bg-white/85 hover:border-[#2F6F73]/35',
      )}
    >
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[var(--color-text)]">{value}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{detail}</p>
    </div>
  )

  if (!onClick) return content

  return (
    <button type="button" onClick={onClick} className="w-full">
      {content}
    </button>
  )
}

function MapUnavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[26px] border border-dashed border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,235,221,0.7))] px-6 text-center">
      <MapPin className="h-8 w-8 text-[#2F6F73]" />
      <div>
        <p className="text-base font-semibold text-[var(--color-text)]">Map unavailable</p>
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
}: {
  mode: OfferMode
  selectedFlight: Offer | null
  hotelOffers: Offer[]
  selectedHotelId: string | null
  onSelectHotel: (offerId: string) => void
}) {
  const mapRef = useRef<MapRef | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)

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

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [details.origin_geo.longitude, details.origin_geo.latitude],
              [details.destination_geo.longitude, details.destination_geo.latitude],
            ],
          },
          properties: {},
        },
      ],
    }
  }, [selectedFlight])

  const hotelMarkerSignature = hotelMarkers
    .map((item) => `${item.offer.id}:${item.latitude}:${item.longitude}`)
    .join('|')

  useEffect(() => {
    if (!config.map.styleUrl || mapError || !mapRef.current) return

    if (mode === 'transport' && selectedFlight?.transport_details?.origin_geo && selectedFlight.transport_details.destination_geo) {
      const { origin_geo: origin, destination_geo: destination } = selectedFlight.transport_details
      mapRef.current.fitBounds(
        [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude],
        ],
        { padding: 64, duration: 0 },
      )
      return
    }

    if (mode === 'lodging' && hotelMarkers.length > 0) {
      const longitudes = hotelMarkers.map((item) => item.longitude)
      const latitudes = hotelMarkers.map((item) => item.latitude)
      mapRef.current.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        { padding: 64, duration: 0 },
      )
    }
  }, [hotelMarkerSignature, hotelMarkers.length, mapError, mode, selectedFlight])

  if (!config.map.styleUrl || mapError) {
    return (
      <MapUnavailable
        message={
          config.map.styleUrl
            ? mapError || 'The atlas canvas could not be loaded.'
            : 'Set `VITE_MAP_STYLE_URL` to enable the interactive map canvas.'
        }
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-[var(--color-border)]">
      <Map
        ref={mapRef}
        initialViewState={{ latitude: 48.8566, longitude: 2.3522, zoom: 4.1 }}
        mapStyle={config.map.styleUrl}
        onError={(event) => setMapError(String(event.error?.message || 'Map failed to load'))}
        style={{ minHeight: 280 }}
      >
        <NavigationControl position="top-right" />
        {mode === 'transport' && selectedFlightRoute ? (
          <>
            <Source id="flight-route" type="geojson" data={selectedFlightRoute}>
              <Layer
                id="flight-route-line"
                type="line"
                paint={{
                  'line-color': '#2F6F73',
                  'line-width': 3,
                  'line-opacity': 0.8,
                }}
              />
            </Source>
            {selectedFlight?.transport_details?.origin_geo ? (
              <Marker
                latitude={selectedFlight.transport_details.origin_geo.latitude}
                longitude={selectedFlight.transport_details.origin_geo.longitude}
                anchor="bottom"
              >
                <div className="flex size-4 items-center justify-center rounded-full border-2 border-white bg-[#2F6F73]" />
              </Marker>
            ) : null}
            {selectedFlight?.transport_details?.destination_geo ? (
              <Marker
                latitude={selectedFlight.transport_details.destination_geo.latitude}
                longitude={selectedFlight.transport_details.destination_geo.longitude}
                anchor="bottom"
              >
                <div className="flex size-4 items-center justify-center rounded-full border-2 border-white bg-[#C56A3D]" />
              </Marker>
            ) : null}
          </>
        ) : null}
        {mode === 'lodging'
          ? hotelMarkers.map((item) => (
            <Marker
              key={item.offer.id}
              latitude={item.latitude}
              longitude={item.longitude}
              anchor="bottom"
            >
              <button
                type="button"
                onClick={() => onSelectHotel(item.offer.id)}
                className={cn(
                  'rounded-full border px-2 py-1 text-xs font-semibold shadow-sm transition-all',
                  item.offer.id === selectedHotelId
                    ? 'border-[#2F6F73] bg-[#2F6F73] text-white'
                    : 'border-white bg-white text-[#1D2430]',
                )}
              >
                {formatMoney(item.offer.price_amount, item.offer.currency)}
              </button>
            </Marker>
          ))
          : null}
      </Map>
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
            <div className="grid gap-3 rounded-[18px] border border-[var(--color-border)] bg-white/85 px-4 py-3 md:grid-cols-[1fr_auto]">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Plane className="h-4 w-4 text-[#2F6F73]" />
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

  if (photo?.image_url) {
    return (
      <div className="overflow-hidden rounded-[22px] border border-[var(--color-border)]">
        <img
          src={photo.image_url}
          alt={offer.title}
          className="h-48 w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className="flex h-48 items-center justify-center rounded-[22px] border border-dashed border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(244,235,221,0.95),rgba(238,246,243,0.95))]">
      <div className="text-center">
        <Hotel className="mx-auto h-8 w-8 text-[#2F6F73]" />
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
        <Card key={index} className="rounded-[28px] border-white/60 bg-white/80">
          <CardContent className="flex flex-col gap-4 p-5">
            <Skeleton className="h-6 w-40 rounded-full" />
            <Skeleton className="h-16 w-full rounded-[20px]" />
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-10 rounded-[16px]" />
              <Skeleton className="h-10 rounded-[16px]" />
              <Skeleton className="h-10 rounded-[16px]" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function OffersWorkspace({ tripId }: Props) {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const focusedDayId = searchParams.get('dayId')

  const { data: trip, isLoading: tripLoading } = useTrip(tripId)
  const { data: daysData, isLoading: daysLoading } = useDays(tripId)
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

  const bestTransportOffer = visibleTransportOffers[0] ?? null
  const cheapestTransportOffer = [...visibleTransportOffers].sort(
    (left, right) => numericPrice(left.price_amount) - numericPrice(right.price_amount),
  )[0] ?? null
  const fastestTransportOffer = [...visibleTransportOffers].sort(
    (left, right) => (getFlightDuration(left) ?? Number.MAX_SAFE_INTEGER) - (getFlightDuration(right) ?? Number.MAX_SAFE_INTEGER),
  )[0] ?? null

  const recommendedHotelOffer = visibleLodgingOffers[0] ?? null
  const cheapestHotelOffer = [...visibleLodgingOffers].sort(
    (left, right) => numericPrice(left.price_amount) - numericPrice(right.price_amount),
  )[0] ?? null
  const topRatedHotelOffer = [...visibleLodgingOffers].sort(
    (left, right) => (getHotelStarRating(right) ?? -1) - (getHotelStarRating(left) ?? -1),
  )[0] ?? null

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

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(244,235,221,0.82),transparent_38%),linear-gradient(180deg,#fbf8f2_0%,#f5efe7_100%)]">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-5 md:px-6 md:py-6">
        <section className="relative overflow-hidden rounded-[34px] border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(244,235,221,0.82))] shadow-[0_24px_80px_rgba(26,38,48,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(47,111,115,0.12),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(197,106,61,0.1),transparent_30%)]" />
          <div className="relative flex flex-col gap-6 p-5 md:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex max-w-3xl flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Offers Workspace</Badge>
                  <Badge variant="outline">{dayBadgeLabel(focusedDay)}</Badge>
                  {focusedDay ? <Badge variant="outline">New searches attach to this day automatically</Badge> : null}
                </div>
                <div className="space-y-2">
                  <h1 className="max-w-3xl text-[clamp(2rem,3vw,3.3rem)] font-semibold tracking-[-0.04em] text-[var(--color-text)]">
                    Compare live flight and hotel snapshots without leaving Voyager.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-[var(--color-text-muted)] md:text-base">
                    This workspace borrows the clarity of Google Flights while staying grounded in your trip context:
                    prefilled dates, ranked results, richer Amadeus detail, and direct day attachment.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ValuePill
                  icon={Sparkles}
                  label="Active"
                  value={`${offers.filter((offer) => offer.is_current).length} current snapshots`}
                />
                <Button
                  variant="outline"
                  size="lg"
                  onClick={refreshVisibleOffers}
                  disabled={refreshVisibleMutation.isPending || activeJobRunning}
                  className="h-12 rounded-full bg-white/80 px-5"
                >
                  {refreshVisibleMutation.isPending || (activeJobRunning && !refreshingOfferId) ? (
                    <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw data-icon="inline-start" className="h-4 w-4" />
                  )}
                  Refresh visible offers
                </Button>
              </div>
            </div>

            <Tabs
              value={mode}
              onValueChange={(value) => setMode(value as OfferMode)}
              className="flex flex-col gap-5"
            >
              <TabsList className="w-fit rounded-full bg-white/70 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                <TabsTrigger value="transport" className="rounded-full px-5 py-2">
                  <Plane data-icon="inline-start" className="h-4 w-4" />
                  Flights
                </TabsTrigger>
                <TabsTrigger value="lodging" className="rounded-full px-5 py-2">
                  <Hotel data-icon="inline-start" className="h-4 w-4" />
                  Hotels
                </TabsTrigger>
              </TabsList>

              <TabsContent value="transport" className="mt-0">
                <form onSubmit={submitTransportSearch} className="flex flex-col gap-4">
                  <FieldGroup className="gap-5 xl:grid xl:grid-cols-[0.75fr_1fr_1fr_0.9fr_0.9fr_0.7fr_0.7fr]">
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
                              <SelectTrigger id="transport-trip-type" className="h-11 rounded-[18px] bg-white/85">
                                <ArrowRightLeft className="mr-2 h-4 w-4 text-[#526072]" />
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
                        <FieldDescription>Round trip defaults when your trip has a later day.</FieldDescription>
                        <FieldError errors={[transportForm.formState.errors.trip_type]} />
                      </FieldContent>
                    </Field>

                    <Field data-invalid={Boolean(transportForm.formState.errors.origin_text)}>
                      <FieldLabel htmlFor="transport-origin">Origin</FieldLabel>
                      <FieldContent>
                        <Input
                          id="transport-origin"
                          placeholder="Origin airport or city"
                          className="h-11 rounded-[18px] bg-white/85"
                          {...transportForm.register('origin_text')}
                        />
                        <FieldDescription>Prefilled from your latest transport snapshot when available.</FieldDescription>
                        <FieldError errors={[transportForm.formState.errors.origin_text]} />
                      </FieldContent>
                    </Field>

                    <Field data-invalid={Boolean(transportForm.formState.errors.destination_text)}>
                      <FieldLabel htmlFor="transport-destination">Destination</FieldLabel>
                      <FieldContent>
                        <Input
                          id="transport-destination"
                          placeholder="Destination airport or city"
                          className="h-11 rounded-[18px] bg-white/85"
                          {...transportForm.register('destination_text')}
                        />
                        <FieldDescription>Voyager anchors this to your trip destination by default.</FieldDescription>
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
                              className="h-11 rounded-[18px] bg-white/85"
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
                              className="h-11 rounded-[18px] bg-white/85"
                            />
                          )}
                        />
                        <FieldDescription>
                          {transportForm.watch('trip_type') === 'one_way'
                            ? 'Disabled for one-way searches.'
                            : 'Used for return ranking and detail comparison.'}
                        </FieldDescription>
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
                              <SelectTrigger id="transport-adults" className="h-11 rounded-[18px] bg-white/85">
                                <Users className="mr-2 h-4 w-4 text-[#526072]" />
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
                              <SelectTrigger id="transport-currency" className="h-11 rounded-[18px] bg-white/85">
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

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <InlineModeIssue issue={transportIssue} />
                    <div className="ml-auto flex items-center gap-3">
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Searches from this page create immutable snapshots you can attach to the planner.
                      </p>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={transportSearchPending}
                        className="h-12 rounded-full px-6"
                      >
                        {transportSearchPending ? (
                          <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search data-icon="inline-start" className="h-4 w-4" />
                        )}
                        Search flights
                      </Button>
                    </div>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="lodging" className="mt-0">
                <form onSubmit={submitLodgingSearch} className="flex flex-col gap-4">
                  <FieldGroup className="gap-5 xl:grid xl:grid-cols-[1.2fr_0.95fr_0.95fr_0.7fr_0.7fr]">
                    <Field data-invalid={Boolean(lodgingForm.formState.errors.location_text)}>
                      <FieldLabel htmlFor="hotel-location">Location</FieldLabel>
                      <FieldContent>
                        <Input
                          id="hotel-location"
                          placeholder="City or destination"
                          className="h-11 rounded-[18px] bg-white/85"
                          {...lodgingForm.register('location_text')}
                        />
                        <FieldDescription>Prefilled from your trip destination and latest hotel search.</FieldDescription>
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
                              className="h-11 rounded-[18px] bg-white/85"
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
                              className="h-11 rounded-[18px] bg-white/85"
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
                              <SelectTrigger id="hotel-guests" className="h-11 rounded-[18px] bg-white/85">
                                <Users className="mr-2 h-4 w-4 text-[#526072]" />
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
                              <SelectTrigger id="hotel-currency" className="h-11 rounded-[18px] bg-white/85">
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

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <InlineModeIssue issue={lodgingIssue} />
                    <div className="ml-auto flex items-center gap-3">
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Hotel searches enrich Amadeus snapshots with address, ratings, map points, and place-photo links.
                      </p>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={lodgingSearchPending}
                        className="h-12 rounded-full px-6"
                      >
                        {lodgingSearchPending ? (
                          <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search data-icon="inline-start" className="h-4 w-4" />
                        )}
                        Search hotels
                      </Button>
                    </div>
                  </div>
                </form>
              </TabsContent>
            </Tabs>

            {activeJobRunning ? (
              <Alert className="rounded-[20px] border-white/60 bg-white/75">
                <Loader2 className="h-4 w-4 animate-spin" />
                <div>
                  <AlertTitle>
                    {queuedMode === 'lodging' ? 'Refreshing hotel results' : 'Refreshing flight results'}
                  </AlertTitle>
                  <AlertDescription>
                    Voyager is polling the background job and will refetch the offer list automatically when the snapshot refresh completes.
                  </AlertDescription>
                </div>
              </Alert>
            ) : null}
          </div>
        </section>

        {mode === 'transport' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="flex flex-col gap-5">
              <Card className="rounded-[30px] border-white/60 bg-white/88 shadow-[0_24px_80px_rgba(26,38,48,0.06)]">
                <CardHeader className="flex flex-col gap-4 pb-0">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-2xl tracking-[-0.03em]">Flight results</CardTitle>
                      <CardDescription>
                        {visibleTransportOffers.length} ranked snapshot{visibleTransportOffers.length === 1 ? '' : 's'}
                        {offersFetching ? ' · refreshing' : ''}
                      </CardDescription>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[#fbf8f2] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                      <Checkbox
                        checked={transportCurrentOnly}
                        onCheckedChange={(checked) => setTransportCurrentOnly(checked === true)}
                        aria-label="Current only"
                      />
                      Current only
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
                    <SummarySurface
                      active={transportSort === 'best'}
                      label="Best"
                      value={bestTransportOffer ? formatMoney(bestTransportOffer.price_amount, bestTransportOffer.currency) : 'No offers'}
                      detail={bestTransportOffer ? `${getFlightPrimaryAirline(bestTransportOffer)} · ${formatDurationMinutes(getFlightDuration(bestTransportOffer))}` : 'Run a flight search'}
                      onClick={() => setTransportSort('best')}
                    />
                    <SummarySurface
                      active={transportSort === 'cheapest'}
                      label="Cheapest"
                      value={cheapestTransportOffer ? formatMoney(cheapestTransportOffer.price_amount, cheapestTransportOffer.currency) : 'No offers'}
                      detail={cheapestTransportOffer ? `${getFlightStopsCount(cheapestTransportOffer) === 0 ? 'Nonstop' : `${getFlightStopsCount(cheapestTransportOffer)} stop`}${getFlightStopsCount(cheapestTransportOffer) === 1 ? '' : getFlightStopsCount(cheapestTransportOffer) > 1 ? 's' : ''}` : 'Waiting for search'}
                      onClick={() => setTransportSort('cheapest')}
                    />
                    <SummarySurface
                      active={transportSort === 'fastest'}
                      label="Fastest"
                      value={fastestTransportOffer ? formatDurationMinutes(getFlightDuration(fastestTransportOffer)) : 'No offers'}
                      detail={fastestTransportOffer ? `${formatMoney(fastestTransportOffer.price_amount, fastestTransportOffer.currency)} · ${getFlightPrimaryAirline(fastestTransportOffer)}` : 'Waiting for search'}
                      onClick={() => setTransportSort('fastest')}
                    />
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4 pt-5">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
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

                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <SlidersHorizontal className="h-4 w-4" />
                    Sorted by {titleizeToken(transportSort)}
                  </div>
                </CardContent>
              </Card>

              {offersLoading || activeLoading ? (
                <OffersLoadingState mode="transport" />
              ) : visibleTransportOffers.length === 0 ? (
                <Card className="rounded-[30px] border-dashed border-[var(--color-border)] bg-white/88">
                  <CardContent className="flex flex-col gap-3 p-8 text-center">
                    <Plane className="mx-auto h-8 w-8 text-[#2F6F73]" />
                    <div>
                      <p className="text-lg font-semibold text-[var(--color-text)]">No flights match the current filters</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Broaden the filter set or run a new search with different dates or airports.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-4">
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
                          'overflow-hidden rounded-[30px] border-white/60 bg-white/92 shadow-[0_22px_70px_rgba(26,38,48,0.05)]',
                          selected && 'border-[#2F6F73] shadow-[0_24px_80px_rgba(47,111,115,0.14)]',
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
                          <CardContent className="flex flex-col gap-5 p-5">
                            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-lg font-semibold text-[var(--color-text)]">
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
                                <p className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                                  {formatMoney(offer.price_amount, offer.currency)}
                                </p>
                                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                                  Expires {formatDateTimeLabel(offer.expires_at)}
                                </p>
                              </div>
                            </div>

                            <div className="grid gap-3 rounded-[24px] border border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,235,221,0.55))] p-4 md:grid-cols-[1.1fr_0.9fr_0.8fr_0.8fr]">
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
                              {details?.bookable_seats != null ? (
                                <Badge variant="outline">{details.bookable_seats} seats left</Badge>
                              ) : null}
                              {details?.emissions_kg ? (
                                <Badge variant="outline">{details.emissions_kg} kg CO2e</Badge>
                              ) : null}
                              {details?.additional_baggage_price ? (
                                <Badge variant="outline">
                                  Bags from {formatMoney(details.additional_baggage_price, details.additional_baggage_currency ?? offer.currency)}
                                </Badge>
                              ) : null}
                            </div>
                          </CardContent>
                        </button>

                        <div className="border-t border-[var(--color-border)] bg-white/75 px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => openAttachDialog(offer)}>
                              <Ticket data-icon="inline-start" className="h-4 w-4" />
                              Attach to day
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => refreshSingleOffer(offer)}
                              disabled={refreshingOfferId === offer.id}
                            >
                              {refreshingOfferId === offer.id ? (
                                <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw data-icon="inline-start" className="h-4 w-4" />
                              )}
                              Refresh
                            </Button>
                            {offer.deep_link ? (
                              <Button variant="outline" asChild>
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

            <aside className="xl:sticky xl:top-6 xl:self-start">
              <Card className="overflow-hidden rounded-[32px] border-white/60 bg-white/92 shadow-[0_26px_90px_rgba(26,38,48,0.08)]">
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-2xl tracking-[-0.03em]">Flight detail</CardTitle>
                      <CardDescription>
                        {selectedTransportOffer ? 'Expanded Amadeus itinerary detail and map route.' : 'Select a flight to inspect the snapshot.'}
                      </CardDescription>
                    </div>
                    {selectedTransportOffer?.trip_day_id ? (
                      <Badge variant="outline">
                        Attached · Day {(days.find((day) => day.id === selectedTransportOffer.trip_day_id)?.day_index ?? 0) + 1}
                      </Badge>
                    ) : null}
                  </div>
                  <OfferMapCanvas
                    mode="transport"
                    selectedFlight={selectedTransportOffer}
                    hotelOffers={[]}
                    selectedHotelId={null}
                    onSelectHotel={() => undefined}
                  />
                </CardHeader>

                <CardContent className="flex flex-col gap-5">
                  {selectedTransportOffer ? (
                    <>
                      <div>
                        <p className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                          {selectedTransportOffer.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                          {selectedTransportOffer.origin_text ?? 'Origin'} → {selectedTransportOffer.destination_text ?? 'Destination'}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <ValuePill
                          icon={Sparkles}
                          label="Price"
                          value={formatMoney(selectedTransportOffer.price_amount, selectedTransportOffer.currency)}
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
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text)]">Segment timeline</p>
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            Terminals, cabin, baggage, and layover detail come from the normalized Amadeus payload.
                          </p>
                        </div>
                        <FlightTimeline details={selectedTransportOffer.transport_details} compact />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <ValuePill
                          icon={Calendar}
                          label="Depart"
                          value={formatDateLabel(getFlightDepartureTime(selectedTransportOffer), 'EEE, MMM d')}
                        />
                        <ValuePill
                          icon={Calendar}
                          label="Return / arrival"
                          value={formatDateLabel(getFlightArrivalTime(selectedTransportOffer), 'EEE, MMM d')}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <Plane className="mx-auto h-8 w-8 text-[#2F6F73]" />
                      <p className="mt-3 text-lg font-semibold text-[var(--color-text)]">No flight selected</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Choose a flight result to inspect the detailed timeline and route rendering.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="flex flex-col gap-5">
              <Card className="rounded-[30px] border-white/60 bg-white/88 shadow-[0_24px_80px_rgba(26,38,48,0.06)]">
                <CardHeader className="flex flex-col gap-4 pb-0">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-2xl tracking-[-0.03em]">Hotel results</CardTitle>
                      <CardDescription>
                        {visibleLodgingOffers.length} map-ready snapshot{visibleLodgingOffers.length === 1 ? '' : 's'}
                        {offersFetching ? ' · refreshing' : ''}
                      </CardDescription>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[#fbf8f2] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                      <Checkbox
                        checked={hotelCurrentOnly}
                        onCheckedChange={(checked) => setHotelCurrentOnly(checked === true)}
                        aria-label="Current only"
                      />
                      Current only
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1.25fr_1fr_1fr]">
                    <SummarySurface
                      active={hotelSort === 'recommended'}
                      label="Recommended"
                      value={recommendedHotelOffer ? recommendedHotelOffer.title : 'No offers'}
                      detail={recommendedHotelOffer ? `${formatMoney(recommendedHotelOffer.price_amount, recommendedHotelOffer.currency)} · ${getHotelSentiment(recommendedHotelOffer)?.toFixed(1) ?? 'No'} sentiment` : 'Run a hotel search'}
                      onClick={() => setHotelSort('recommended')}
                    />
                    <SummarySurface
                      active={hotelSort === 'price'}
                      label="Cheapest"
                      value={cheapestHotelOffer ? formatMoney(cheapestHotelOffer.price_amount, cheapestHotelOffer.currency) : 'No offers'}
                      detail={cheapestHotelOffer ? cheapestHotelOffer.title : 'Waiting for search'}
                      onClick={() => setHotelSort('price')}
                    />
                    <SummarySurface
                      active={hotelSort === 'rating'}
                      label="Top rated"
                      value={topRatedHotelOffer ? `${(getHotelStarRating(topRatedHotelOffer) ?? 0).toFixed(1)} stars` : 'No rating'}
                      detail={topRatedHotelOffer ? topRatedHotelOffer.title : 'Waiting for search'}
                      onClick={() => setHotelSort('rating')}
                    />
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4 pt-5">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr]">
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

                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <SlidersHorizontal className="h-4 w-4" />
                    Hotels are ranked with sentiment, price, and distance when the data is available.
                  </div>
                </CardContent>
              </Card>

              {offersLoading || activeLoading ? (
                <OffersLoadingState mode="lodging" />
              ) : visibleLodgingOffers.length === 0 ? (
                <Card className="rounded-[30px] border-dashed border-[var(--color-border)] bg-white/88">
                  <CardContent className="flex flex-col gap-3 p-8 text-center">
                    <Hotel className="mx-auto h-8 w-8 text-[#2F6F73]" />
                    <div>
                      <p className="text-lg font-semibold text-[var(--color-text)]">No hotels match the current filters</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Remove a star, amenity, or price constraint to widen the set of visible stays.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-4">
                  {visibleLodgingOffers.map((offer) => {
                    const selected = offer.id === selectedLodgingId
                    const details = getHotelDetails(offer)
                    const photo = details?.primary_photo

                    return (
                      <Card
                        key={offer.id}
                        className={cn(
                          'overflow-hidden rounded-[30px] border-white/60 bg-white/92 shadow-[0_22px_70px_rgba(26,38,48,0.05)]',
                          selected && 'border-[#2F6F73] shadow-[0_24px_80px_rgba(47,111,115,0.14)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedLodgingId(offer.id)}
                          className="w-full text-left"
                        >
                          <CardContent className="grid gap-4 p-5 md:grid-cols-[168px_1fr_auto]">
                            <div className="overflow-hidden rounded-[22px] border border-[var(--color-border)] bg-[#fbf8f2]">
                              {photo?.thumbnail_url || photo?.image_url ? (
                                <img
                                  src={photo.thumbnail_url ?? photo.image_url}
                                  alt={offer.title}
                                  className="h-full min-h-[136px] w-full object-cover"
                                />
                              ) : (
                                <div className="flex min-h-[136px] items-center justify-center bg-[linear-gradient(135deg,rgba(244,235,221,0.95),rgba(238,246,243,0.95))]">
                                  <Hotel className="h-8 w-8 text-[#2F6F73]" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-lg font-semibold text-[var(--color-text)]">{offer.title}</p>
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
                              <p className="mt-3 text-sm text-[var(--color-text)]">
                                {details?.room_description ?? offer.room_type ?? 'Room details coming from provider snapshot'}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {(details?.amenities ?? []).slice(0, 4).map((amenity) => (
                                  <Badge key={amenity} variant="outline">
                                    {titleizeToken(amenity)}
                                  </Badge>
                                ))}
                              </div>
                            </div>

                            <div className="text-left md:text-right">
                              <p className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                                {formatMoney(offer.price_amount, offer.currency)}
                              </p>
                              {details?.nightly_rate_amount ? (
                                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                                  {formatMoney(details.nightly_rate_amount, offer.currency)} / night
                                </p>
                              ) : null}
                              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                                {formatDateLabel(offer.checkin_date, 'MMM d')} - {formatDateLabel(offer.checkout_date, 'MMM d')}
                              </p>
                            </div>
                          </CardContent>
                        </button>

                        <div className="border-t border-[var(--color-border)] bg-white/75 px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => openAttachDialog(offer)}>
                              <Ticket data-icon="inline-start" className="h-4 w-4" />
                              Attach to day
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => refreshSingleOffer(offer)}
                              disabled={refreshingOfferId === offer.id}
                            >
                              {refreshingOfferId === offer.id ? (
                                <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw data-icon="inline-start" className="h-4 w-4" />
                              )}
                              Refresh
                            </Button>
                            {offer.deep_link ? (
                              <Button variant="outline" asChild>
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

            <aside className="xl:sticky xl:top-6 xl:self-start">
              <Card className="overflow-hidden rounded-[32px] border-white/60 bg-white/92 shadow-[0_26px_90px_rgba(26,38,48,0.08)]">
                <CardHeader className="gap-4">
                  <div>
                    <CardTitle className="text-2xl tracking-[-0.03em]">Stay detail</CardTitle>
                    <CardDescription>
                      Map-led detail with linked hotel imagery and policy data.
                    </CardDescription>
                  </div>
                  <OfferMapCanvas
                    mode="lodging"
                    selectedFlight={null}
                    hotelOffers={visibleLodgingOffers}
                    selectedHotelId={selectedLodgingId}
                    onSelectHotel={setSelectedLodgingId}
                  />
                </CardHeader>

                <CardContent className="flex flex-col gap-5">
                  {selectedLodgingOffer ? (
                    <>
                      <HotelHero offer={selectedLodgingOffer} />

                      <div>
                        <p className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                          {selectedLodgingOffer.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                          {getHotelDetails(selectedLodgingOffer)?.address_text ?? selectedLodgingOffer.location_text ?? 'Address unavailable'}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <ValuePill
                          icon={Sparkles}
                          label="Total"
                          value={formatMoney(selectedLodgingOffer.price_amount, selectedLodgingOffer.currency)}
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
                        {getHotelDetails(selectedLodgingOffer)?.sentiment_rating != null ? (
                          <Badge variant="outline">
                            {getHotelDetails(selectedLodgingOffer)?.sentiment_rating?.toFixed(1)} sentiment
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
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text)]">Room and stay policy</p>
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            {getHotelDetails(selectedLodgingOffer)?.room_description ?? selectedLodgingOffer.room_type ?? 'Room detail not provided by provider.'}
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
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
                        <Alert variant="warning" className="rounded-[18px]">
                          <CircleAlert className="h-4 w-4" />
                          <div>
                            <AlertTitle>Photos are not linked yet</AlertTitle>
                            <AlertDescription>
                              This hotel snapshot does not have a linked place record yet, so the shared photo pipeline cannot fetch imagery.
                            </AlertDescription>
                          </div>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <Hotel className="mx-auto h-8 w-8 text-[#2F6F73]" />
                      <p className="mt-3 text-lg font-semibold text-[var(--color-text)]">No stay selected</p>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Select a hotel result to inspect the map marker, room policy, and linked imagery.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </div>

      <Dialog open={Boolean(attachingOffer)} onOpenChange={(open) => !open && setAttachingOffer(null)}>
        <DialogContent className="rounded-[28px]">
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
    </div>
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
          <SelectTrigger className="h-11 rounded-[18px] bg-white/85">
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

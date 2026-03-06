import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import {
  Calendar,
  ExternalLink,
  Hotel,
  Loader2,
  Plane,
  RefreshCw,
  Ticket,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDays } from '@/entities/day/queries'
import {
  useAttachOfferToDay,
  useRefreshOffer,
  useRefreshTripOffers,
  useSubmitLodgingOfferSearch,
  useSubmitTransportOfferSearch,
  useTripOffers,
} from '@/entities/offer/queries'
import type { OfferListFilters } from '@/entities/offer/api'
import { useJob } from '@/entities/job/queries'
import { isIntegrationNotConfigured, isRateLimit } from '@/shared/api/client'
import { formatMoney } from '@/shared/lib/format'
import { getJobResultErrors, isJobSuccessful, isJobTerminal, isJobRunning } from '@/shared/lib/jobs'
import { useOffersStore } from '@/shared/stores/offers.store'
import type {
  LodgingOfferSearchInput,
  Offer,
  OfferKind,
  OfferRefreshInput,
  TransportOfferSearchInput,
} from '@/shared/api/types'

const transportSchema = z.object({
  origin_text: z.string().min(1, 'Origin is required').transform((value) => value.toUpperCase()),
  destination_text: z.string().min(1, 'Destination is required').transform((value) => value.toUpperCase()),
  depart_date: z.string().min(1, 'Departure date is required'),
  return_date: z.string().optional(),
  adults: z.coerce.number().int().min(1).max(9).default(1),
  currency: z.string().default('EUR'),
})

const lodgingSchema = z
  .object({
    location_text: z.string().min(1, 'Location is required'),
    checkin_date: z.string().min(1, 'Check-in date is required'),
    checkout_date: z.string().min(1, 'Check-out date is required'),
    guests: z.coerce.number().int().min(1).max(16).default(2),
    currency: z.string().default('EUR'),
  })
  .refine((data) => data.checkout_date > data.checkin_date, {
    message: 'Checkout must be after check-in',
    path: ['checkout_date'],
  })

type TransportFormValues = z.infer<typeof transportSchema>
type LodgingFormValues = z.infer<typeof lodgingSchema>

interface Props {
  tripId: string
}

function OfferCard({
  offer,
  selected,
  attachedDayLabel,
  onSelect,
  onAttach,
  onRefresh,
}: {
  offer: Offer
  selected: boolean
  attachedDayLabel?: string
  onSelect: (offerId: string) => void
  onAttach: (offer: Offer) => void
  onRefresh: (offer: Offer) => void
}) {
  const isExpired = new Date(offer.expires_at).getTime() < Date.now()

  return (
    <div
      className="rounded-[18px] border p-4 transition-colors"
      style={{
        borderColor: selected ? '#2F6F73' : 'var(--color-border)',
        background: selected ? 'rgba(47, 111, 115, 0.05)' : 'var(--color-surface)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {offer.kind === 'lodging' ? (
              <Hotel className="w-4 h-4 text-[#2F6F73]" />
            ) : (
              <Plane className="w-4 h-4 text-[#2F6F73]" />
            )}
            <button
              type="button"
              onClick={() => onSelect(offer.id)}
              className="text-left text-sm font-semibold text-[#1D2430] hover:text-[#2F6F73] transition-colors"
            >
              {offer.title}
            </button>
          </div>
          <p className="text-sm text-[#526072]">
            {offer.provider}
            {offer.transport_mode ? ` · ${offer.transport_mode}` : ''}
            {offer.lodging_type ? ` · ${offer.lodging_type}` : ''}
          </p>
          {attachedDayLabel && (
            <p className="text-xs text-[#2F6F73] mt-1">Attached to {attachedDayLabel}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-[#1D2430]">
            {formatMoney(offer.price_amount, offer.currency)}
          </p>
          <p className="text-xs text-[#526072] mt-1">
            {offer.is_current && !isExpired ? 'Current' : 'Stale'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
          Expires {format(new Date(offer.expires_at), 'MMM d, HH:mm')}
        </span>
        <button
          type="button"
          onClick={() => onAttach(offer)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] border text-xs text-[#526072] hover:bg-[#F4EBDD] transition-colors"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Ticket className="w-3 h-3 text-[#2F6F73]" />
          Attach to Day
        </button>
        <button
          type="button"
          onClick={() => onRefresh(offer)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] border text-xs text-[#526072] hover:bg-[#F4EBDD] transition-colors"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <RefreshCw className="w-3 h-3 text-[#2F6F73]" />
          Refresh
        </button>
        {offer.deep_link && (
          <a
            href={offer.deep_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] border text-xs text-[#526072] hover:bg-[#F4EBDD] transition-colors"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <ExternalLink className="w-3 h-3 text-[#2F6F73]" />
            Open Provider
          </a>
        )}
      </div>
    </div>
  )
}

export default function OffersWorkspace({ tripId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const dayIdFilter = searchParams.get('dayId')

  const {
    activeTab,
    setActiveTab,
    selectedOfferId,
    setSelectedOfferId,
    lastTransportJobId,
    setLastTransportJobId,
    lastLodgingJobId,
    setLastLodgingJobId,
  } = useOffersStore()

  const [currentOnly, setCurrentOnly] = useState(true)
  const [attachingOffer, setAttachingOffer] = useState<Offer | null>(null)
  const [selectedDayId, setSelectedDayId] = useState<string>('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<Error | null>(null)
  const previousJobStatus = useRef<string | null>(null)

  const { data: daysData } = useDays(tripId)
  const days = daysData?.items ?? []

  const offerFilters = useMemo<OfferListFilters>(
    () => ({
      kind:
        activeTab === 'all' || activeTab === 'rentals'
          ? undefined
          : (activeTab as OfferKind),
      current_only: currentOnly,
      limit: 200,
      offset: 0,
      transport_modes: activeTab === 'transport' ? ['flight'] : undefined,
      lodging_types: activeTab === 'lodging' ? ['hotel'] : undefined,
    }),
    [activeTab, currentOnly],
  )

  const { data: offersData, isLoading: isLoadingOffers } = useTripOffers(tripId, offerFilters)
  const transportMutation = useSubmitTransportOfferSearch(tripId)
  const lodgingMutation = useSubmitLodgingOfferSearch(tripId)
  const attachMutation = useAttachOfferToDay(tripId)
  const refreshOfferMutation = useRefreshOffer(tripId)
  const refreshTripMutation = useRefreshTripOffers(tripId)
  const { data: activeJob } = useJob(activeJobId)
  const { data: lastTransportJob } = useJob(lastTransportJobId)
  const { data: lastLodgingJob } = useJob(lastLodgingJobId)

  const transportForm = useForm<TransportFormValues>({
    resolver: zodResolver(transportSchema),
    defaultValues: {
      adults: 1,
      currency: 'EUR',
    },
  })
  const lodgingForm = useForm<LodgingFormValues>({
    resolver: zodResolver(lodgingSchema),
    defaultValues: {
      guests: 2,
      currency: 'EUR',
    },
  })

  useEffect(() => {
    if (!activeJob || !isJobTerminal(activeJob.status) || previousJobStatus.current === activeJob.status) {
      return
    }

    previousJobStatus.current = activeJob.status
    if (isJobSuccessful(activeJob.status)) {
      toast.success('Offers updated')
    } else {
      toast.error('Offer job failed')
    }
  }, [activeJob])

  const displayedOffers = useMemo(() => {
    const allOffers = offersData?.items ?? []
    if (!dayIdFilter) return allOffers
    return allOffers.filter((offer) => offer.trip_day_id === dayIdFilter)
  }, [dayIdFilter, offersData?.items])

  const selectedOffer = displayedOffers.find((offer) => offer.id === selectedOfferId) ?? displayedOffers[0] ?? null
  const jobErrors = getJobResultErrors(activeJob)

  const dayLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const day of days) {
      map.set(day.id, `Day ${day.day_index + 1} · ${format(new Date(day.date), 'MMM d')}`)
    }
    return map
  }, [days])

  const handleTransportSearch = async (values: TransportFormValues) => {
    setInlineError(null)
    const payload: TransportOfferSearchInput = {
      trip_id: tripId,
      origin_text: values.origin_text,
      destination_text: values.destination_text,
      depart_date: values.depart_date,
      return_date: values.return_date || null,
      adults: values.adults,
      currency: values.currency,
      transport_modes: ['flight'],
      providers: null,
      constraints: {},
    }

    try {
      const job = await transportMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      setLastTransportJobId(job.job_id)
      setActiveJobId(job.job_id)
      toast.success('Flight search queued')
    } catch (error) {
      setInlineError(error as Error)
      if (isIntegrationNotConfigured(error)) {
        return
      }
      if (isRateLimit(error)) {
        toast.error('Too many searches. Please wait a moment.')
      } else {
        toast.error('Failed to start flight search')
      }
    }
  }

  const handleLodgingSearch = async (values: LodgingFormValues) => {
    setInlineError(null)
    const payload: LodgingOfferSearchInput = {
      trip_id: tripId,
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
      const job = await lodgingMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      setLastLodgingJobId(job.job_id)
      setActiveJobId(job.job_id)
      toast.success('Hotel search queued')
    } catch (error) {
      setInlineError(error as Error)
      if (isIntegrationNotConfigured(error)) {
        return
      }
      if (isRateLimit(error)) {
        toast.error('Too many searches. Please wait a moment.')
      } else {
        toast.error('Failed to start hotel search')
      }
    }
  }

  const handleAttach = async () => {
    if (!attachingOffer || !selectedDayId) return

    try {
      await attachMutation.mutateAsync({
        offerId: attachingOffer.id,
        data: { offer_kind: attachingOffer.kind, trip_day_id: selectedDayId },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Offer attached to day')
      setAttachingOffer(null)
      setSelectedDayId('')
    } catch {
      toast.error('Failed to attach offer')
    }
  }

  const handleRefreshOffer = async (offer: Offer) => {
    const payload: OfferRefreshInput = {
      offer_kind: offer.kind,
      constraints: {},
    }

    try {
      const job = await refreshOfferMutation.mutateAsync({
        offerId: offer.id,
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      setActiveJobId(job.job_id)
      toast.success('Offer refresh queued')
    } catch (error) {
      if (isRateLimit(error)) {
        toast.error('Refresh limit reached. Please wait.')
      } else {
        toast.error('Failed to refresh offer')
      }
    }
  }

  const handleRefreshTrip = async () => {
    try {
      const job = await refreshTripMutation.mutateAsync({
        data: {
          offer_kind:
            activeTab === 'transport' || activeTab === 'lodging'
              ? (activeTab as OfferKind)
              : null,
          current_only: currentOnly,
          constraints: {},
        },
        idempotencyKey: crypto.randomUUID(),
      })
      setActiveJobId(job.job_id)
      toast.success('Trip offer refresh queued')
    } catch (error) {
      if (isRateLimit(error)) {
        toast.error('Refresh limit reached. Please wait.')
      } else {
        toast.error('Failed to refresh trip offers')
      }
    }
  }

  return (
    <div className="h-full min-h-screen flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <div
        className="px-6 py-4 border-b flex flex-col gap-4 shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-[#1D2430]">Offers Workspace</h1>
            <p className="text-sm text-[#526072]">
              Search flights and hotels, refresh snapshots, and attach the best option to a trip day.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefreshTrip}
            disabled={refreshTripMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] border text-sm text-[#526072] hover:bg-[#F4EBDD] transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {refreshTripMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#2F6F73]" />
            ) : (
              <RefreshCw className="w-4 h-4 text-[#2F6F73]" />
            )}
            Refresh Visible Offers
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'transport', 'lodging', 'rentals'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              disabled={tab === 'rentals'}
              onClick={() => setActiveTab(tab)}
              className="px-3 py-2 rounded-[10px] border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                borderColor: activeTab === tab ? '#2F6F73' : 'var(--color-border)',
                background: activeTab === tab ? '#2F6F73' : 'transparent',
                color: activeTab === tab ? '#FFFFFF' : 'var(--color-text-muted)',
              }}
            >
              {tab === 'all' ? 'All' : tab === 'transport' ? 'Flights' : tab === 'lodging' ? 'Hotels' : 'Rentals'}
            </button>
          ))}

          <label className="ml-auto inline-flex items-center gap-2 text-sm text-[#526072]">
            <input
              type="checkbox"
              checked={currentOnly}
              onChange={(event) => setCurrentOnly(event.target.checked)}
              className="rounded accent-[#2F6F73]"
            />
            Current only
          </label>
        </div>

        {dayIdFilter && (
          <div
            className="inline-flex items-center gap-2 self-start px-3 py-2 rounded-[10px] border text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            <Calendar className="w-4 h-4 text-[#2F6F73]" />
            Focused on {dayLookup.get(dayIdFilter) || 'selected day'}
            <button
              type="button"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams)
                nextParams.delete('dayId')
                setSearchParams(nextParams)
              }}
              className="text-[#2F6F73] hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'transport') && (
          <form
            onSubmit={transportForm.handleSubmit(handleTransportSearch)}
            className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_120px_120px_auto] gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Origin
              </label>
              <input
                {...transportForm.register('origin_text')}
                placeholder="CDG"
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Destination
              </label>
              <input
                {...transportForm.register('destination_text')}
                placeholder="MAD"
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Depart
              </label>
              <input
                type="date"
                {...transportForm.register('depart_date')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Adults
              </label>
              <input
                type="number"
                min={1}
                max={9}
                {...transportForm.register('adults', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Currency
              </label>
              <input
                {...transportForm.register('currency')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <button
              type="submit"
              disabled={transportMutation.isPending}
              className="px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors disabled:opacity-50"
            >
              {transportMutation.isPending ? 'Searching…' : 'Search Flights'}
            </button>
          </form>
        )}

        {(activeTab === 'all' || activeTab === 'lodging') && (
          <form
            onSubmit={lodgingForm.handleSubmit(handleLodgingSearch)}
            className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_120px_120px_auto] gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Location
              </label>
              <input
                {...lodgingForm.register('location_text')}
                placeholder="Barcelona"
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Check-in
              </label>
              <input
                type="date"
                {...lodgingForm.register('checkin_date')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Check-out
              </label>
              <input
                type="date"
                {...lodgingForm.register('checkout_date')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Guests
              </label>
              <input
                type="number"
                min={1}
                max={16}
                {...lodgingForm.register('guests', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Currency
              </label>
              <input
                {...lodgingForm.register('currency')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <button
              type="submit"
              disabled={lodgingMutation.isPending}
              className="px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors disabled:opacity-50"
            >
              {lodgingMutation.isPending ? 'Searching…' : 'Search Hotels'}
            </button>
          </form>
        )}

        {inlineError && isIntegrationNotConfigured(inlineError) && (
          <div
            className="rounded-[14px] border p-4 text-sm"
            style={{ borderColor: 'rgba(197, 106, 61, 0.2)', background: 'rgba(197, 106, 61, 0.08)', color: 'var(--color-text-muted)' }}
          >
            Provider integrations are not configured for this environment.
          </div>
        )}

        {activeJob && isJobRunning(activeJob.status) && (
          <div className="inline-flex items-center gap-2 text-sm text-[#2F6F73]">
            <Loader2 className="w-4 h-4 animate-spin" />
            Search in progress…
          </div>
        )}

        {jobErrors.length > 0 && (
          <div
            className="rounded-[14px] border p-4 text-sm"
            style={{ borderColor: 'rgba(197, 106, 61, 0.2)', background: 'rgba(197, 106, 61, 0.08)', color: 'var(--color-text-muted)' }}
          >
            Some providers failed, but Voyager still saved the successful results.
          </div>
        )}

        {(lastTransportJob || lastLodgingJob) && (
          <div className="flex flex-wrap gap-2 text-xs text-[#526072]">
            {lastTransportJob && <span>Flights: {lastTransportJob.status}</span>}
            {lastLodgingJob && <span>Hotels: {lastLodgingJob.status}</span>}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid md:grid-cols-[1.3fr_0.9fr] gap-4 p-4">
        <section
          className="min-h-0 rounded-[24px] border overflow-hidden flex flex-col"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium text-[#1D2430]">Offer Results</p>
            <p className="text-xs text-[#526072]">
              {displayedOffers.length} offer{displayedOffers.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoadingOffers ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-28 rounded-[18px] bg-[#CDBEA8]/30 animate-pulse" />
                ))}
              </div>
            ) : displayedOffers.length > 0 ? (
              displayedOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  selected={offer.id === selectedOffer?.id}
                  attachedDayLabel={offer.trip_day_id ? dayLookup.get(offer.trip_day_id) : undefined}
                  onSelect={setSelectedOfferId}
                  onAttach={(selected) => {
                    setAttachingOffer(selected)
                    setSelectedDayId(selected.trip_day_id ?? dayIdFilter ?? days[0]?.id ?? '')
                  }}
                  onRefresh={handleRefreshOffer}
                />
              ))
            ) : (
              <div className="text-sm text-[#526072] p-4">
                {inlineError && isIntegrationNotConfigured(inlineError)
                  ? 'Offers are unavailable because the provider integrations are not configured.'
                  : 'No offers yet. Run a search to create immutable flight or hotel snapshots.'}
              </div>
            )}
          </div>
        </section>

        <section
          className="min-h-0 rounded-[24px] border overflow-hidden flex flex-col"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium text-[#1D2430]">Offer Detail</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedOffer ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#1D2430]">{selectedOffer.title}</h2>
                  <p className="text-sm text-[#526072] mt-1">
                    {selectedOffer.provider}
                    {selectedOffer.kind === 'transport' && selectedOffer.origin_text && selectedOffer.destination_text
                      ? ` · ${selectedOffer.origin_text} → ${selectedOffer.destination_text}`
                      : ''}
                    {selectedOffer.kind === 'lodging' && selectedOffer.location_text
                      ? ` · ${selectedOffer.location_text}`
                      : ''}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className="rounded-[14px] border p-3"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  >
                    <p className="text-xs text-[#526072] uppercase tracking-wider mb-1">Price</p>
                    <p className="text-base font-semibold text-[#1D2430]">
                      {formatMoney(selectedOffer.price_amount, selectedOffer.currency)}
                    </p>
                  </div>
                  <div
                    className="rounded-[14px] border p-3"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  >
                    <p className="text-xs text-[#526072] uppercase tracking-wider mb-1">Status</p>
                    <p className="text-base font-semibold text-[#1D2430]">
                      {selectedOffer.is_current ? 'Current' : 'Superseded'}
                    </p>
                  </div>
                </div>
                {selectedOffer.trip_day_id && (
                  <div className="text-sm text-[#526072]">
                    Attached to <span className="text-[#1D2430] font-medium">{dayLookup.get(selectedOffer.trip_day_id)}</span>
                  </div>
                )}
                {selectedOffer.deep_link && (
                  <a
                    href={selectedOffer.deep_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Provider Offer
                  </a>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[#526072] text-center">
                Select an offer to inspect its snapshot metadata and attachment state.
              </div>
            )}
          </div>
        </section>
      </div>

      {attachingOffer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(29, 36, 48, 0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-md rounded-[18px] overflow-hidden"
            style={{ background: 'var(--color-surface)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h2 className="font-semibold text-[#1D2430]">Attach Offer To Day</h2>
                <p className="text-sm text-[#526072]">{attachingOffer.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setAttachingOffer(null)}
                className="p-1.5 rounded-[10px] hover:bg-[#F4EBDD] transition-colors"
              >
                <X className="w-4 h-4 text-[#526072]" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#526072] mb-2 uppercase tracking-wider">
                  Trip Day
                </label>
                <select
                  value={selectedDayId}
                  onChange={(event) => setSelectedDayId(event.target.value)}
                  className="w-full px-3 py-2 rounded-[10px] border text-sm"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <option value="">Choose a day</option>
                  {days.map((day) => (
                    <option key={day.id} value={day.id}>
                      Day {day.day_index + 1} — {format(new Date(day.date), 'MMM d, yyyy')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAttachingOffer(null)}
                  className="flex-1 px-4 py-2.5 border text-sm text-[#526072] rounded-[10px] hover:bg-[#F4EBDD] transition-colors"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAttach}
                  disabled={!selectedDayId || attachMutation.isPending}
                  className="flex-1 px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors disabled:opacity-50"
                >
                  {attachMutation.isPending ? 'Attaching…' : 'Attach'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

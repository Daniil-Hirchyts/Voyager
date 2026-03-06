import { requestJson } from '@/shared/api/client'
import type {
  JobAcceptedResponse,
  LodgingOfferSearchInput,
  Offer,
  OfferAttachDayInput,
  OfferKind,
  OfferListResponse,
  OfferRefreshInput,
  TransportMode,
  TransportOfferSearchInput,
  TripOffersRefreshInput,
  LodgingType,
} from '@/shared/api/types'

export interface OfferListFilters {
  kind?: OfferKind
  transport_modes?: TransportMode[]
  lodging_types?: LodgingType[]
  current_only?: boolean
  limit?: number
  offset?: number
}

function buildQuery(path: string, params: Record<string, string | number | boolean | string[] | undefined>) {
  const url = new URL(path, 'http://voyager.local')
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item))
      return
    }
    url.searchParams.set(key, String(value))
  })
  return `${url.pathname}${url.search}`
}

export async function listTripOffers(tripId: string, filters: OfferListFilters = {}) {
  return requestJson<OfferListResponse>(
    buildQuery(`/trips/${tripId}/offers`, {
      kind: filters.kind,
      current_only: filters.current_only ?? true,
      limit: filters.limit ?? 100,
      offset: filters.offset ?? 0,
      transport_modes: filters.transport_modes,
      lodging_types: filters.lodging_types,
    }),
  )
}

export async function submitTransportOfferSearch(
  data: TransportOfferSearchInput,
  idempotencyKey: string,
) {
  return requestJson<JobAcceptedResponse>('/offers/transport/search', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function submitLodgingOfferSearch(
  data: LodgingOfferSearchInput,
  idempotencyKey: string,
) {
  return requestJson<JobAcceptedResponse>('/offers/lodging/search', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function attachOfferToDay(
  tripId: string,
  offerId: string,
  data: OfferAttachDayInput,
  idempotencyKey: string,
) {
  return requestJson<Offer>(`/trips/${tripId}/offers/${offerId}/attach-day`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function refreshOffer(
  offerId: string,
  data: OfferRefreshInput,
  idempotencyKey: string,
) {
  return requestJson<JobAcceptedResponse>(`/offers/${offerId}/refresh`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function refreshTripOffers(
  tripId: string,
  data: TripOffersRefreshInput,
  idempotencyKey: string,
) {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/offers/refresh`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

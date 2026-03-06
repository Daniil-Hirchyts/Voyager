import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attachOfferToDay,
  listTripOffers,
  refreshOffer,
  refreshTripOffers,
  submitLodgingOfferSearch,
  submitTransportOfferSearch,
} from './api'
import type { OfferListFilters } from './api'
import type {
  LodgingOfferSearchInput,
  OfferAttachDayInput,
  OfferRefreshInput,
  TransportOfferSearchInput,
  TripOffersRefreshInput,
} from '@/shared/api/types'

export const offerKeys = {
  list: (tripId: string, filters: OfferListFilters) => ['offers', tripId, filters] as const,
}

export function useTripOffers(tripId: string, filters: OfferListFilters = {}) {
  return useQuery({
    queryKey: offerKeys.list(tripId, filters),
    queryFn: () => listTripOffers(tripId, filters),
    enabled: !!tripId,
  })
}

export function useSubmitTransportOfferSearch(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: TransportOfferSearchInput
      idempotencyKey: string
    }) => submitTransportOfferSearch(data, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', tripId] }),
  })
}

export function useSubmitLodgingOfferSearch(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: LodgingOfferSearchInput
      idempotencyKey: string
    }) => submitLodgingOfferSearch(data, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', tripId] }),
  })
}

export function useAttachOfferToDay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      offerId,
      data,
      idempotencyKey,
    }: {
      offerId: string
      data: OfferAttachDayInput
      idempotencyKey: string
    }) => attachOfferToDay(tripId, offerId, data, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offers', tripId] })
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
      qc.invalidateQueries({ queryKey: ['trip-days', tripId] })
      qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })
}

export function useRefreshOffer(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      offerId,
      data,
      idempotencyKey,
    }: {
      offerId: string
      data: OfferRefreshInput
      idempotencyKey: string
    }) => refreshOffer(offerId, data, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', tripId] }),
  })
}

export function useRefreshTripOffers(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: TripOffersRefreshInput
      idempotencyKey: string
    }) => refreshTripOffers(tripId, data, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', tripId] }),
  })
}

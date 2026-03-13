import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acceptTripInvitation,
  createTripInvite,
  getTripInvitationPreview,
  getTripSharing,
  removeTripCollaborator,
  revokeTripInvite,
} from './api'
import { tripKeys } from '@/entities/trip/queries'

export const tripSharingKeys = {
  all: ['trip-sharing'] as const,
  detail: (tripId: string) => ['trip-sharing', tripId] as const,
  invitation: (token: string) => ['trip-invitation', token] as const,
}

export function useTripSharing(tripId: string) {
  return useQuery({
    queryKey: tripSharingKeys.detail(tripId),
    queryFn: () => getTripSharing(tripId),
    enabled: Boolean(tripId),
  })
}

export function useCreateTripInvite(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => createTripInvite(tripId, { role: 'editor' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripSharingKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.all })
    },
  })
}

export function useRevokeTripInvite(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) => revokeTripInvite(tripId, invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripSharingKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.all })
    },
  })
}

export function useRemoveTripCollaborator(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (collaboratorUserId: string) => removeTripCollaborator(tripId, collaboratorUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripSharingKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.all })
    },
  })
}

export function useTripInvitationPreview(token: string) {
  return useQuery({
    queryKey: tripSharingKeys.invitation(token),
    queryFn: () => getTripInvitationPreview(token),
    enabled: Boolean(token),
    retry: false,
  })
}

export function useAcceptTripInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => acceptTripInvitation(token),
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: tripKeys.all })
      qc.invalidateQueries({ queryKey: tripKeys.detail(trip.id) })
    },
  })
}

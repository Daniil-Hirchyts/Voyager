import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { optimizeTrip, listProposals, getProposal, applyProposal } from './api';
import type { TripOptimizeInput } from '@/shared/api/types';
import { tripKeys } from '@/entities/trip/queries';
import { dayKeys } from '@/entities/day/queries';
import { activityKeys } from '@/entities/activity/queries';

export const proposalKeys = {
  list: (tripId: string) => ['proposals', tripId] as const,
  detail: (proposalId: string) => ['proposal', proposalId] as const,
};

export function useProposals(tripId: string) {
  return useQuery({
    queryKey: proposalKeys.list(tripId),
    queryFn: () => listProposals(tripId, { limit: 50 }),
    enabled: !!tripId,
    staleTime: 30_000,
  });
}

export function useProposal(proposalId: string | null) {
  return useQuery({
    queryKey: proposalKeys.detail(proposalId ?? '__none__'),
    queryFn: () => getProposal(proposalId!),
    enabled: !!proposalId,
    staleTime: 60_000,
  });
}

export function useOptimizeTrip(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ data, idempotencyKey }: { data: TripOptimizeInput; idempotencyKey: string }) =>
      optimizeTrip(tripId, data, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: proposalKeys.list(tripId) });
    },
  });
}

export function useApplyProposal(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      tripVersion,
      idempotencyKey,
    }: {
      proposalId: string;
      tripVersion: number;
      idempotencyKey: string;
    }) => applyProposal(proposalId, tripVersion, idempotencyKey),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
      qc.invalidateQueries({ queryKey: dayKeys.list(tripId) });
      for (const dayId of result.applied_day_ids) {
        qc.invalidateQueries({ queryKey: activityKeys.list(dayId) });
      }

      qc.invalidateQueries({ queryKey: proposalKeys.list(tripId) });
    },
  });
}

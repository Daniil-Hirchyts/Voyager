import { useQuery, useMutation } from '@tanstack/react-query';
import { getJob, generateItinerary, resetItinerary } from './api';

export const jobKeys = {
  detail: (jobId: string) => ['job', jobId] as const,
};

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: jobKeys.detail(jobId ?? '__none__'),
    queryFn: () => getJob(jobId!),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)?.status;
      if (status === 'SUCCEEDED' || status === 'FAILED') return false;
      return 1500;
    },
  });
}

export function useGenerateItinerary(tripId: string) {
  return useMutation({
    mutationFn: ({
      data,
      tripVersion,
      idempotencyKey,
    }: {
      data: Parameters<typeof generateItinerary>[1];
      tripVersion: number;
      idempotencyKey: string;
    }) => generateItinerary(tripId, data, tripVersion, idempotencyKey),
  });
}

export function useResetItinerary(tripId: string) {
  return useMutation({
    mutationFn: ({
      data,
      tripVersion,
      idempotencyKey,
    }: {
      data: Parameters<typeof resetItinerary>[1];
      tripVersion: number;
      idempotencyKey: string;
    }) => resetItinerary(tripId, data, tripVersion, idempotencyKey),
  });
}

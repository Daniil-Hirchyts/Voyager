import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDays, patchDay } from './api';

export const dayKeys = {
  list: (tripId: string) => ['trip-days', tripId] as const,
};

export function useDays(tripId: string) {
  return useQuery({
    queryKey: dayKeys.list(tripId),
    queryFn: () => getDays(tripId),
    enabled: !!tripId,
  });
}

export function usePatchDay(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dayId, data }: { dayId: string; data: { notes?: string | null } }) =>
      patchDay(dayId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: dayKeys.list(tripId) }),
  });
}

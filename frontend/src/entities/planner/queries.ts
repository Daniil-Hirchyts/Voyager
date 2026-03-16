import { useQuery } from '@tanstack/react-query';
import { getPlanner } from './api';

export const plannerKeys = {
  detail: (tripId: string) => ['trip-planner', tripId] as const,
};

export function usePlanner(tripId: string) {
  return useQuery({
    queryKey: plannerKeys.detail(tripId),
    queryFn: () => getPlanner(tripId),
    enabled: !!tripId,
  });
}

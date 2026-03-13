import { useQuery } from '@tanstack/react-query'
import { getAssistantThread } from './api'

export const assistantKeys = {
  thread: (tripId: string) => ['assistant-thread', tripId] as const,
}

export function useAssistantThread(tripId: string | null) {
  return useQuery({
    queryKey: assistantKeys.thread(tripId ?? '__none__'),
    queryFn: () => getAssistantThread(tripId!),
    enabled: Boolean(tripId),
    staleTime: 0,
  })
}


import type { QueryClient } from '@tanstack/react-query'
import { assistantKeys } from './queries'
import type { AssistantMessage, AssistantThread } from '@/shared/api/types'

function mergeMessages(
  existing: AssistantMessage[],
  incoming: AssistantMessage[],
): AssistantMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]))
  for (const message of incoming) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.id.localeCompare(b.id)
    }
    return a.created_at.localeCompare(b.created_at)
  })
}

export function upsertAssistantMessages(
  queryClient: QueryClient,
  tripId: string,
  messages: AssistantMessage[],
) {
  queryClient.setQueryData<AssistantThread | undefined>(
    assistantKeys.thread(tripId),
    (current) => {
      if (!current) {
        return {
          id: `thread-${tripId}`,
          trip_id: tripId,
          user_id: '',
          messages: mergeMessages([], messages),
        }
      }
      return {
        ...current,
        messages: mergeMessages(current.messages, messages),
      }
    },
  )
}


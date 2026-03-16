import { buildApiUrl, createRequestHeaders, requestJson, toApiError } from '@/shared/api/client';
import type {
  AssistantMessage,
  AssistantMessageStreamInput,
  AssistantMirrorJobInput,
  AssistantStreamEvent,
  AssistantThread,
} from '@/shared/api/types';

export async function getAssistantThread(tripId: string): Promise<AssistantThread> {
  return requestJson<AssistantThread>(`/trips/${tripId}/assistant/thread`);
}

export async function mirrorAssistantJob(
  tripId: string,
  payload: AssistantMirrorJobInput,
): Promise<AssistantMessage[]> {
  return requestJson<AssistantMessage[]>(`/trips/${tripId}/assistant/mirror-job`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function streamAssistantMessages(
  tripId: string,
  payload: AssistantMessageStreamInput,
  onEvent: (event: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl(`/trips/${tripId}/assistant/messages/stream`), {
    method: 'POST',
    headers: createRequestHeaders(undefined, { json: true }),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    if (!response.ok) {
      throw await toApiError(response);
    }
    throw new Error('Failed to stream assistant messages');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() ?? '';

    for (const line of chunks) {
      if (!line.startsWith('data: ')) continue;
      const payloadText = line.slice(6);
      try {
        const event = JSON.parse(payloadText) as AssistantStreamEvent;
        onEvent(event);
      } catch {
        // ignore malformed events
      }
    }
  }
}

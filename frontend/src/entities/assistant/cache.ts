import type { QueryClient } from '@tanstack/react-query';
import { assistantKeys } from './queries';
import type { AssistantMessage, AssistantThread, JobProgressEvent } from '@/shared/api/types';

function mergeMessages(
  existing: AssistantMessage[],
  incoming: AssistantMessage[],
): AssistantMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.id.localeCompare(b.id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

function isJobProgressPart(part: unknown): part is {
  type: 'data';
  name: 'job-progress';
  data: Record<string, unknown>;
} {
  return Boolean(
    part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'data' &&
    (part as { name?: unknown }).name === 'job-progress' &&
    typeof (part as { data?: unknown }).data === 'object',
  );
}

function mergeJobProgressEvent(
  message: AssistantMessage,
  event: JobProgressEvent,
): AssistantMessage {
  const nextParts = [...message.parts];
  const partIndex = nextParts.findIndex((part) => isJobProgressPart(part));
  const existingPart =
    partIndex >= 0 && isJobProgressPart(nextParts[partIndex]) ? nextParts[partIndex] : null;

  const existingEvents = Array.isArray(existingPart?.data.events)
    ? existingPart?.data.events.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : [];

  const hasEvent = existingEvents.some((item) => String(item.event_id ?? '') === event.event_id);
  const events = hasEvent ? existingEvents : [...existingEvents, event];

  const nextJobStatus = event.type === 'done' ? String(event.status ?? 'FAILED') : 'RUNNING';
  const nextStatus =
    event.type === 'done'
      ? String(event.status ?? '').toUpperCase() === 'SUCCEEDED'
        ? 'complete'
        : 'incomplete'
      : 'running';

  const nextPart = {
    type: 'data' as const,
    name: 'job-progress' as const,
    data: {
      job_id:
        existingPart?.data.job_id && typeof existingPart.data.job_id === 'string'
          ? existingPart.data.job_id
          : (message.source_job_id ?? event.job_id),
      action:
        existingPart?.data.action && typeof existingPart.data.action === 'string'
          ? existingPart.data.action
          : (message.metadata.action ?? 'generate'),
      request_text:
        existingPart?.data.request_text && typeof existingPart.data.request_text === 'string'
          ? existingPart.data.request_text
          : 'Planner job',
      job_status: nextJobStatus,
      events,
      summary:
        event.type === 'done' ? (event.summary ?? null) : (existingPart?.data.summary ?? null),
    },
  };

  if (partIndex >= 0) {
    nextParts[partIndex] = nextPart;
  } else {
    nextParts.push(nextPart);
  }

  return {
    ...message,
    status: nextStatus,
    parts: nextParts,
    metadata: {
      ...message.metadata,
      kind: 'job-progress',
      last_event_id: event.event_id,
    },
    updated_at: new Date().toISOString(),
  };
}

export function upsertAssistantMessages(
  queryClient: QueryClient,
  tripId: string,
  messages: AssistantMessage[],
) {
  queryClient.setQueryData<AssistantThread | undefined>(assistantKeys.thread(tripId), (current) => {
    if (!current) {
      return {
        id: `thread-${tripId}`,
        trip_id: tripId,
        user_id: '',
        messages: mergeMessages([], messages),
      };
    }
    return {
      ...current,
      messages: mergeMessages(current.messages, messages),
    };
  });
}

export function appendAssistantJobProgressEvent(
  queryClient: QueryClient,
  tripId: string,
  jobId: string,
  event: JobProgressEvent,
) {
  queryClient.setQueryData<AssistantThread | undefined>(assistantKeys.thread(tripId), (current) => {
    if (!current) {
      return current;
    }

    const nextMessages = current.messages.map((message) => {
      if (message.source_job_id !== jobId) {
        return message;
      }
      return mergeJobProgressEvent(message, event);
    });

    return {
      ...current,
      messages: nextMessages,
    };
  });
}

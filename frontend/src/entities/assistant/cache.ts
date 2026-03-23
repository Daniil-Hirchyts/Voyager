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

function jobActionLabel(action: unknown) {
  return String(action ?? '').trim().toLowerCase() === 'reset' ? 'reset' : 'generation';
}

function formatJobCompletionText(action: unknown, status: unknown, summary: unknown) {
  const normalizedStatus = String(status ?? '').toUpperCase();
  const operation = jobActionLabel(action);
  const summaryRecord =
    summary && typeof summary === 'object' && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : {};
  const counts =
    summaryRecord.summary &&
    typeof summaryRecord.summary === 'object' &&
    !Array.isArray(summaryRecord.summary)
      ? (summaryRecord.summary as Record<string, unknown>)
      : {};
  const dayCount = Array.isArray(summaryRecord.day_deltas) ? summaryRecord.day_deltas.length : 0;
  const detailParts: string[] = [];

  const created = typeof counts.created === 'number' ? counts.created : Number(counts.created ?? 0);
  const updated = typeof counts.updated === 'number' ? counts.updated : Number(counts.updated ?? 0);
  const deleted = typeof counts.deleted === 'number' ? counts.deleted : Number(counts.deleted ?? 0);
  const skipped = typeof counts.skipped === 'number' ? counts.skipped : Number(counts.skipped ?? 0);

  if (normalizedStatus !== 'SUCCEEDED') {
    return `Itinerary ${operation} failed. Review the progress details above and try again.`;
  }

  if (Number.isFinite(created) && created > 0) {
    detailParts.push(`added ${created}`);
  }
  if (Number.isFinite(updated) && updated > 0) {
    detailParts.push(`updated ${updated}`);
  }
  if (Number.isFinite(deleted) && deleted > 0) {
    detailParts.push(`removed ${deleted}`);
  }
  if (Number.isFinite(skipped) && skipped > 0) {
    detailParts.push(`skipped ${skipped}`);
  }
  if (dayCount > 0) {
    detailParts.push(`across ${dayCount} day${dayCount === 1 ? '' : 's'}`);
  }

  if (operation === 'reset') {
    return detailParts.length > 0
      ? `Itinerary reset finished. ${detailParts.join('; ')}.`
      : 'Itinerary reset finished. The planner board has been updated.';
  }

  return detailParts.length > 0
    ? `Itinerary generation finished. ${detailParts.join('; ')}.`
    : 'Itinerary generation finished. The planner board has been updated.';
}

function upsertJobCompletionPart(
  parts: AssistantMessage['parts'],
  event: JobProgressEvent,
  action: unknown,
) {
  const nextParts = [...parts];
  if (event.type !== 'done') {
    return nextParts;
  }

  const completionPart = {
    type: 'text' as const,
    text: formatJobCompletionText(
      action,
      event.status,
      event.summary && typeof event.summary === 'object' ? event.summary : undefined,
    ),
    intent: 'job-completion',
  };

  const existingIndex = nextParts.findIndex(
    (part) =>
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      (part as { intent?: unknown }).intent === 'job-completion',
  );

  if (existingIndex >= 0) {
    nextParts[existingIndex] = completionPart;
  } else {
    nextParts.push(completionPart);
  }

  return nextParts;
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

  const action =
    existingPart?.data.action && typeof existingPart.data.action === 'string'
      ? existingPart.data.action
      : (message.metadata.action ?? 'generate');
  const finalParts =
    event.type === 'done'
      ? upsertJobCompletionPart(nextParts, event, action)
      : nextParts;

  return {
    ...message,
    status: nextStatus,
    parts: finalParts,
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

export function replaceAssistantMessages(
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
        messages,
      };
    }
    return {
      ...current,
      messages,
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

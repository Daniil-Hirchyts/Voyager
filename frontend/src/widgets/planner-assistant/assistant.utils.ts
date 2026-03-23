import type { ThreadMessageLike } from '@assistant-ui/react';
import { isApiError } from '@/shared/api/client';
import type {
  AssistantDataPart,
  AssistantMessage,
  AssistantMessagePart,
  AssistantTextPart,
  AssistantToolCallPart,
} from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { getPlannerAssistantCommandSuggestions } from './commands';
import type { JobTimelineRow, PlannerAssistantSuggestedPlace } from './assistant.types';
import type { PlannerAssistantCommandDefinition } from './commands';

export function stripControlCharacters(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !(
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
    .join('');
}

export function statusToAssistantUi(status: AssistantMessage['status']) {
  if (status === 'running') return { type: 'running' as const };
  if (status === 'requires_action') {
    return { type: 'requires-action' as const, reason: 'interrupt' as const };
  }
  if (status === 'incomplete') {
    return { type: 'incomplete' as const, reason: 'error' as const };
  }
  return { type: 'complete' as const, reason: 'stop' as const };
}

export function isTextPart(part: AssistantMessagePart): part is AssistantTextPart {
  return typeof part === 'object' && part !== null && part.type === 'text';
}

export function isToolPart(part: AssistantMessagePart): part is AssistantToolCallPart {
  return typeof part === 'object' && part !== null && part.type === 'tool-call';
}

export function isDataPart(part: AssistantMessagePart): part is AssistantDataPart {
  return typeof part === 'object' && part !== null && part.type === 'data';
}

export function isJobProgressPart(part: AssistantMessagePart): part is AssistantDataPart {
  return isDataPart(part) && part.name === 'job-progress';
}

export function isPlannerMutationOperation(operation: unknown) {
  return ['create_activity', 'update_activity', 'move_activity', 'delete_activity'].includes(
    String(operation ?? ''),
  );
}

export function toThreadMessage(message: AssistantMessage) {
  const content = message.parts
    .map((part) => {
      if (isTextPart(part)) {
        return { type: 'text' as const, text: part.text };
      }
      if (isToolPart(part)) {
        return {
          type: 'tool-call' as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args ?? {},
          argsText: part.argsText ?? JSON.stringify(part.args ?? {}),
          result: part.result,
          isError: part.isError,
          interrupt: part.interrupt,
        };
      }
      if (isDataPart(part)) {
        return {
          type: 'data' as const,
          name: part.name,
          data: part.data,
        };
      }
      return null;
    })
    .filter(Boolean) as ThreadMessageLike['content'];

  const baseMessage = {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(message.created_at),
    metadata: {
      custom: {
        metadata: message.metadata,
        source_job_id: message.source_job_id,
      },
    },
  };

  if (message.role === 'assistant') {
    return {
      ...baseMessage,
      status: statusToAssistantUi(message.status),
    };
  }

  return baseMessage;
}

export function extractAppendText(message: { content: ReadonlyArray<{ type: string; text?: string }> }) {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      return '';
    })
    .join('\n')
    .trim();
}

export function formatToolLabel(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === 'generate_with_llm') {
    return 'Generate With LLM';
  }
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
    .replace(/\bLlm\b/g, 'LLM');
}

export function toInlineError(error: unknown, fallback = 'Something went wrong.') {
  if (typeof error === 'string') {
    return error;
  }
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function pluralize(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

export function dayScopeLabel(dayIds: unknown) {
  if (!Array.isArray(dayIds) || dayIds.length === 0) {
    return 'the whole trip';
  }
  return pluralize(dayIds.length, 'day');
}

export function summaryValueLabel(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return pluralize(value.length, 'item');
  }
  if (typeof value === 'object') {
    return pluralize(Object.keys(value as Record<string, unknown>).length, 'field');
  }
  return null;
}

export function summarizeToolUsage(
  toolName: string,
  args: Record<string, unknown>,
  result?: Record<string, unknown>,
  options?: {
    pending?: boolean;
    running?: boolean;
    isError?: boolean;
  },
) {
  const pending = Boolean(options?.pending);
  const running = Boolean(options?.running);
  const isError = Boolean(options?.isError);

  if (toolName === 'read_trip_snapshot') {
    const dayCount = Array.isArray(result?.days) ? result.days.length : null;
    if (running) {
      return 'Loading the latest trip context.';
    }
    return dayCount != null
      ? `Loaded the latest trip context for ${pluralize(dayCount, 'day')}.`
      : 'Loaded the latest trip context.';
  }

  if (toolName === 'search_places') {
    const query = asString(args.query);
    const itemCount = Array.isArray(result?.items) ? result.items.length : null;
    if (isError) {
      return query ? `Place search for "${query}" failed.` : 'Place search failed.';
    }
    if (itemCount != null) {
      return query
        ? `Found ${pluralize(itemCount, 'place')} for "${query}".`
        : `Found ${pluralize(itemCount, 'place')}.`;
    }
    if (running) {
      return query ? `Searching places for "${query}".` : 'Searching places.';
    }
    return query ? `Searching places for "${query}".` : 'Searching places.';
  }

  if (toolName === 'create_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title) ?? asString(args.title) ?? 'the activity';
    return pending || running ? `Preparing ${title}.` : `Added ${title} to the itinerary.`;
  }

  if (toolName === 'update_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title) ?? asString(args.title) ?? 'the activity';
    return pending || running ? `Updating ${title}.` : `Updated ${title}.`;
  }

  if (toolName === 'move_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title);
    if (running) {
      return title ? `Moving ${title}.` : 'Moving the activity to a new slot.';
    }
    return title ? `Moved ${title}.` : 'Moved the activity to a new slot.';
  }

  if (toolName === 'delete_activity') {
    if (pending) {
      return 'Ready to remove this activity from the itinerary.';
    }
    return isError ? 'Could not delete the activity.' : 'Deleted the activity from the itinerary.';
  }

  if (toolName === 'generate_itinerary') {
    const mode = asString(args.mode) ?? asString(result?.mode) ?? 'replace';
    return pending
      ? `Ready to generate in ${mode} mode for ${dayScopeLabel(args.day_ids)}.`
      : running
        ? `Queueing itinerary generation in ${mode} mode for ${dayScopeLabel(args.day_ids)}.`
      : 'Queued itinerary generation and attached live progress below.';
  }

  if (toolName === 'reset_itinerary') {
    return pending
      ? `Ready to clear every activity from ${dayScopeLabel(args.day_ids)}.`
      : running
        ? `Queueing an itinerary reset for ${dayScopeLabel(args.day_ids)}.`
      : 'Queued itinerary reset and attached live progress below.';
  }

  return isError
    ? `${formatToolLabel(toolName)} failed.`
    : pending
      ? `${formatToolLabel(toolName)} is ready to run.`
      : running
        ? `${formatToolLabel(toolName)} is running.`
        : `${formatToolLabel(toolName)} completed.`;
}

export function summarizeTimelineTool(row: Extract<JobTimelineRow, { kind: 'tool' }>) {
  const query = asString(row.args.query);
  const result = row.result;
  const running = !row.result && !row.isError;

  if (row.toolName === 'generate_with_llm') {
    const model = asString(result?.model);
    const candidates =
      typeof result?.candidates === 'number' ? result.candidates : Number(result?.candidates ?? 0);
    if (row.isError) {
      return model ? `The ${model} drafting pass failed.` : 'The LLM drafting pass failed.';
    }
    if (result) {
      return model && Number.isFinite(candidates) && candidates > 0
        ? `${model} drafted ${pluralize(candidates, 'candidate activity')}.`
        : model
          ? `${model} finished drafting the itinerary candidates.`
          : 'The LLM drafting pass completed.';
    }
    return 'Drafting itinerary candidates with the configured LLM.';
  }

  if (row.toolName === 'google_places_search') {
    const count = Array.isArray(result?.items) ? result.items.length : null;
    if (count != null) {
      return query
        ? `Found ${pluralize(count, 'place')} for "${query}".`
        : `Found ${pluralize(count, 'place')}.`;
    }
    return query ? `Searching for "${query}".` : 'Searching places.';
  }

  if (row.toolName === 'google_place_details') {
    const place = asRecord(result?.place);
    const candidate = asRecord(result?.candidate);
    const placeName = asString(place?.name) ?? asString(candidate?.name);
    return placeName ? `Loaded details for ${placeName}.` : 'Loading place details.';
  }

  if (row.toolName.includes('photo')) {
    return row.result ? 'Added photos to the shortlisted places.' : 'Collecting place photos.';
  }

  if (row.toolName.includes('ground')) {
    return row.result
      ? 'Grounded the suggestions against trip constraints.'
      : 'Grounding suggestions against the trip context.';
  }

  if (row.toolName.includes('apply')) {
    return row.result ? 'Applied the generated itinerary changes.' : 'Applying itinerary changes.';
  }

  return summarizeToolUsage(row.toolName, row.args, row.result, {
    running,
    isError: row.isError,
  });
}

export function buildTimelineRows(events: unknown[]): JobTimelineRow[] {
  const rows: JobTimelineRow[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const item of events) {
    if (!item || typeof item !== 'object') continue;
    const event = item as Record<string, unknown>;
    const phase = typeof event.phase === 'string' ? event.phase : null;
    const eventId =
      typeof event.event_id === 'string' && event.event_id ? event.event_id : crypto.randomUUID();

    if (event.type === 'step') {
      rows.push({
        kind: 'step',
        phase,
        eventId,
        name: String(event.name ?? 'Progress update'),
        detail: String(event.detail ?? ''),
      });
      continue;
    }

    if (event.type === 'tool_call') {
      const callId = typeof event.call_id === 'string' ? event.call_id : eventId;
      toolIndexByCallId.set(callId, rows.length);
      rows.push({
        kind: 'tool',
        phase,
        eventId,
        toolName: String(event.tool_name ?? 'Tool'),
        callId,
        args:
          event.args && typeof event.args === 'object'
            ? (event.args as Record<string, unknown>)
            : {},
      });
      continue;
    }

    if (event.type === 'tool_result') {
      const callId = typeof event.call_id === 'string' ? event.call_id : null;
      const rowIndex = callId ? toolIndexByCallId.get(callId) : undefined;
      if (rowIndex !== undefined) {
        const row = rows[rowIndex];
        if (!row || row.kind !== 'tool') {
          continue;
        }
        row.result =
          event.result && typeof event.result === 'object'
            ? (event.result as Record<string, unknown>)
            : {};
        row.isError = Boolean(event.is_error);
        continue;
      }

      rows.push({
        kind: 'tool',
        phase,
        eventId,
        toolName: String(event.tool_name ?? 'Tool'),
        callId,
        args: {},
        result:
          event.result && typeof event.result === 'object'
            ? (event.result as Record<string, unknown>)
            : {},
        isError: Boolean(event.is_error),
      });
      continue;
    }

    if (event.type === 'done') {
      rows.push({
        kind: 'done',
        phase,
        eventId,
        status: String(event.status ?? 'FAILED'),
        summary:
          event.summary && typeof event.summary === 'object'
            ? (event.summary as Record<string, unknown>)
            : undefined,
      });
    }
  }

  return rows;
}

export function buildSummaryEntries(summary: Record<string, unknown> | undefined) {
  if (!summary) return [];
  const entries: Array<readonly [string, string]> = [];
  const counts = asRecord(summary.summary);

  const appendCount = (key: string, labelKey: string) => {
    const raw = counts?.[key];
    const value = typeof raw === 'number' ? raw : Number(raw ?? 0);
    if (Number.isFinite(value) && value > 0) {
      entries.push([labelKey, String(value)]);
    }
  };

  appendCount('created', 'added');
  appendCount('updated', 'updated');
  appendCount('deleted', 'removed');
  appendCount('skipped', 'skipped');

  const llmModel = asString(summary.llm_model);
  if (llmModel) {
    entries.push(['llm_model', llmModel]);
  }

  const engine = asString(summary.generator_engine);
  if (engine) {
    entries.push(['generator_engine', engine]);
  }

  const resolvedPlaceCount =
    typeof summary.resolved_place_count === 'number'
      ? summary.resolved_place_count
      : Number(summary.resolved_place_count ?? 0);
  if (Number.isFinite(resolvedPlaceCount) && resolvedPlaceCount > 0) {
    entries.push(['resolved_places', String(resolvedPlaceCount)]);
  }

  const photoCount =
    typeof summary.photo_enriched_place_count === 'number'
      ? summary.photo_enriched_place_count
      : Number(summary.photo_enriched_place_count ?? 0);
  if (Number.isFinite(photoCount) && photoCount > 0) {
    entries.push(['photo_enriched_places', String(photoCount)]);
  }

  if (typeof summary.fallback_used === 'boolean') {
    entries.push(['fallback_used', summary.fallback_used ? 'Yes' : 'No']);
  }

  const unresolvedCount =
    typeof summary.unresolved_activity_count === 'number'
      ? summary.unresolved_activity_count
      : Number(summary.unresolved_activity_count ?? 0);
  if (Number.isFinite(unresolvedCount) && unresolvedCount > 0) {
    entries.push(['unresolved_activities', String(unresolvedCount)]);
  }

  const providerErrors = Array.isArray(summary.provider_errors) ? summary.provider_errors.length : 0;
  if (providerErrors > 0) {
    entries.push(['provider_errors', pluralize(providerErrors, 'issue')]);
  }

  if (entries.length > 0) {
    return entries;
  }

  return Object.entries(summary).flatMap(([key, value]) => {
    const label = summaryValueLabel(value);
    return label ? [[key, label] as const] : [];
  });
}

export function toneChipClasses(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  return cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-medium',
    tone === 'success' && 'bg-[rgba(34,197,94,0.12)] text-[rgba(21,128,61,1)]',
    tone === 'warning' && 'bg-[rgba(245,158,11,0.12)] text-[rgba(180,83,9,1)]',
    tone === 'danger' && 'bg-[rgba(255,81,14,0.12)] text-[rgba(255,81,14,1)]',
    tone === 'neutral' && 'bg-[rgba(15,23,42,0.06)] text-[var(--color-text-muted)]',
  );
}

export function extractSuggestedPlaces(
  result: Record<string, unknown> | null,
): PlannerAssistantSuggestedPlace[] {
  const items = Array.isArray(result?.items) ? result.items : [];
  return items.flatMap((item) => {
    const record = asRecord(item);
    const placeId = asString(record?.place_id);
    const name = asString(record?.name);
    if (!placeId || !name) {
      return [];
    }
    return [
      {
        placeId,
        name,
        label: asString(record?.label),
        addressText: asString(record?.address_text),
        category: asString(record?.category),
        lat: typeof record?.lat === 'number' ? record.lat : null,
        lon: typeof record?.lon === 'number' ? record.lon : null,
      },
    ];
  });
}

export function getAvailableCommandSuggestions(
  draft: string,
  hasActivities: boolean,
): PlannerAssistantCommandDefinition[] {
  return getPlannerAssistantCommandSuggestions(draft).filter((command) => {
    if (!hasActivities && command.name === 'reset') {
      return false;
    }
    return true;
  });
}

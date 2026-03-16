import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Radio,
  Search,
  Slash,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from '@/components/ui/chain-of-thought';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Markdown } from '@/components/ui/markdown';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/ui/prompt-input';
import { mirrorAssistantJob, streamAssistantMessages } from '@/entities/assistant/api';
import {
  appendAssistantJobProgressEvent,
  upsertAssistantMessages,
} from '@/entities/assistant/cache';
import { assistantKeys, useAssistantThread } from '@/entities/assistant/queries';
import { streamJobProgress } from '@/entities/job/api';
import { plannerKeys } from '@/entities/planner/queries';
import { useGooglePlaceDetail } from '@/entities/place/queries';
import { isApiError } from '@/shared/api/client';
import type {
  AssistantDataPart,
  AssistantMessage,
  AssistantMessagePart,
  AssistantMessageStreamInput,
  AssistantToolCallPart,
  AssistantTextPart,
  JobProgressEvent,
  Day,
} from '@/shared/api/types';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { cn } from '@/shared/lib/cn';
import { resolveMediaUrl } from '@/shared/lib/media';
import {
  getPlannerAssistantCommandSuggestions,
  parsePlannerAssistantCommand,
  type PlannerAssistantCommandDefinition,
  type PlannerAssistantInlineCommand,
} from './commands';
import {
  PlannerGenerationInlineCard,
  type PlannerGenerationAction,
  type PlannerGenerationFormValues,
} from '@/widgets/planner-board/GenerationControls';

type PlannerAssistantContextValue = {
  confirmToolCall: (messageId: string, toolCallId: string, confirmed: boolean) => Promise<void>;
  selectSuggestedPlace: (place: PlannerAssistantSuggestedPlace) => void;
};

type PlannerAssistantPanelProps = {
  tripId: string;
  destination: string;
  days: Day[];
  hasActivities: boolean;
  isOpen: boolean;
  requestedInlineAction: PlannerGenerationAction | null;
  onRequestedInlineActionHandled: () => void;
  onSubmitInlineAction: (
    action: PlannerGenerationAction,
    values: PlannerGenerationFormValues,
    idempotencyKey: string,
  ) => Promise<void>;
  isPlannerActionPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSuggestedPlace?: (place: PlannerAssistantSuggestedPlace) => void;
};

export type PlannerAssistantSuggestedPlace = {
  placeId: string;
  name: string;
  label: string | null;
  addressText: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
};

type SavedConversation = {
  id: string;
  name: string;
  messages: AssistantMessage[];
  savedAt: string;
};

type JobTimelineRow =
  | {
      kind: 'step';
      phase: string | null;
      eventId: string;
      name: string;
      detail: string;
    }
  | {
      kind: 'tool';
      phase: string | null;
      eventId: string;
      toolName: string;
      callId: string | null;
      args: Record<string, unknown>;
      result?: Record<string, unknown>;
      isError?: boolean;
    }
  | {
      kind: 'done';
      phase: string | null;
      eventId: string;
      status: string;
      summary?: Record<string, unknown>;
    };

const PlannerAssistantContext = createContext<PlannerAssistantContextValue | null>(null);

function usePlannerAssistantContext() {
  const ctx = useContext(PlannerAssistantContext);
  if (!ctx) {
    throw new Error('PlannerAssistantContext not found');
  }
  return ctx;
}

function stripControlCharacters(value: string) {
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

function statusToAssistantUi(status: AssistantMessage['status']) {
  if (status === 'running') return { type: 'running' as const };
  if (status === 'requires_action') {
    return { type: 'requires-action' as const, reason: 'interrupt' as const };
  }
  if (status === 'incomplete') {
    return { type: 'incomplete' as const, reason: 'error' as const };
  }
  return { type: 'complete' as const, reason: 'stop' as const };
}

function isTextPart(part: AssistantMessagePart): part is AssistantTextPart {
  return typeof part === 'object' && part !== null && part.type === 'text';
}

function isToolPart(part: AssistantMessagePart): part is AssistantToolCallPart {
  return typeof part === 'object' && part !== null && part.type === 'tool-call';
}

function isDataPart(part: AssistantMessagePart): part is AssistantDataPart {
  return typeof part === 'object' && part !== null && part.type === 'data';
}

function isJobProgressPart(part: AssistantMessagePart): part is AssistantDataPart {
  return isDataPart(part) && part.name === 'job-progress';
}

function toThreadMessage(message: AssistantMessage): ThreadMessageLike {
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
        } as ThreadMessageLike['content'][number];
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
  } satisfies Omit<ThreadMessageLike, 'status'>;

  if (message.role === 'assistant') {
    return {
      ...baseMessage,
      status: statusToAssistantUi(message.status),
    };
  }

  return baseMessage;
}

function extractAppendText(message: AppendMessage) {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text;
      return '';
    })
    .join('\n')
    .trim();
}

function formatToolLabel(toolName: string) {
  return toolName.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function toInlineError(error: unknown, fallback = 'Something went wrong.') {
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

function removeAssistantMessage(queryClient: QueryClient, tripId: string, messageId: string) {
  queryClient.setQueryData(assistantKeys.thread(tripId), (current: unknown) => {
    if (!current || typeof current !== 'object') {
      return current;
    }
    const thread = current as { messages?: AssistantMessage[] };
    if (!Array.isArray(thread.messages)) {
      return current;
    }
    return {
      ...thread,
      messages: thread.messages.filter((message) => message.id !== messageId),
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pluralize(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function dayScopeLabel(dayIds: unknown) {
  if (!Array.isArray(dayIds) || dayIds.length === 0) {
    return 'the whole trip';
  }
  return pluralize(dayIds.length, 'day');
}

function summaryValueLabel(value: unknown): string | null {
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

function summarizeToolUsage(
  toolName: string,
  args: Record<string, unknown>,
  result?: Record<string, unknown>,
  options?: {
    pending?: boolean;
    isError?: boolean;
  },
) {
  const pending = Boolean(options?.pending);
  const isError = Boolean(options?.isError);

  if (toolName === 'read_trip_snapshot') {
    const dayCount = Array.isArray(result?.days) ? result.days.length : null;
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
    return query ? `Searching places for "${query}".` : 'Searching places.';
  }

  if (toolName === 'create_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title) ?? asString(args.title) ?? 'the activity';
    return pending ? `Preparing ${title}.` : `Added ${title} to the itinerary.`;
  }

  if (toolName === 'update_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title) ?? asString(args.title) ?? 'the activity';
    return pending ? `Updating ${title}.` : `Updated ${title}.`;
  }

  if (toolName === 'move_activity') {
    const activity = asRecord(result?.activity);
    const title = asString(activity?.title);
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
      : 'Queued itinerary generation and attached live progress below.';
  }

  if (toolName === 'reset_itinerary') {
    return pending
      ? `Ready to clear generated activities from ${dayScopeLabel(args.day_ids)}.`
      : 'Queued itinerary reset and attached live progress below.';
  }

  return isError
    ? `${formatToolLabel(toolName)} failed.`
    : pending
      ? `${formatToolLabel(toolName)} is ready to run.`
      : `${formatToolLabel(toolName)} completed.`;
}

function summarizeTimelineTool(row: Extract<JobTimelineRow, { kind: 'tool' }>) {
  const query = asString(row.args.query);
  const result = row.result;

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
    isError: row.isError,
  });
}

function buildTimelineRows(events: unknown[]): JobTimelineRow[] {
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

function buildSummaryEntries(summary: Record<string, unknown> | undefined) {
  if (!summary) return [];
  return Object.entries(summary).flatMap(([key, value]) => {
    const label = summaryValueLabel(value);
    return label ? [[key, label] as const] : [];
  });
}

function toneChipClasses(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  return cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-medium',
    tone === 'success' && 'bg-[rgba(34,197,94,0.12)] text-[rgba(21,128,61,1)]',
    tone === 'warning' && 'bg-[rgba(245,158,11,0.12)] text-[rgba(180,83,9,1)]',
    tone === 'danger' && 'bg-[rgba(255,81,14,0.12)] text-[rgba(255,81,14,1)]',
    tone === 'neutral' && 'bg-[rgba(15,23,42,0.06)] text-[var(--color-text-muted)]',
  );
}

type SubmitPlannerAssistantInputResult = 'sent' | 'inline' | 'invalid' | 'noop';

function getAvailableCommandSuggestions(
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

const MAX_INPUT_LENGTH = 2000;
const SUBMIT_COOLDOWN_MS = 1500;

const CONVERSATIONS_STORAGE_KEY = (tripId: string) => `assistant-conversations-${tripId}`;

function loadSavedConversations(tripId: string): SavedConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY(tripId));
    if (!raw) return [];
    return JSON.parse(raw) as SavedConversation[];
  } catch {
    return [];
  }
}

function persistSavedConversations(tripId: string, convs: SavedConversation[]) {
  try {
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY(tripId), JSON.stringify(convs));
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

const HIDDEN_IDS_KEY = (tripId: string) => `assistant-hidden-ids-${tripId}`;

function loadHiddenIds(tripId: string): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_IDS_KEY(tripId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistHiddenIds(tripId: string, ids: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_IDS_KEY(tripId), JSON.stringify([...ids]));
  } catch {
    // fail silently
  }
}

const MESSAGE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="m-0 leading-7 text-[var(--color-text)]">{children}</p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[var(--color-text)]">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="text-[var(--color-text)] italic">{children}</em>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="m-0 flex list-decimal flex-col gap-2 pl-5">{children}</ol>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="m-0 flex list-disc flex-col gap-2 pl-5">{children}</ul>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="pl-0.5 text-[var(--color-text)] marker:text-[var(--color-text-muted)]">
      {children}
    </li>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-[var(--color-primary)] underline underline-offset-4"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="m-0 border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-text-muted)]">
      {children}
    </blockquote>
  ),
};

function extractSuggestedPlaces(
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

function SuggestedPlaceCard({ place }: { place: PlannerAssistantSuggestedPlace }) {
  const { selectSuggestedPlace } = usePlannerAssistantContext();
  const detailQuery = useGooglePlaceDetail(place.placeId);
  const heroPhoto = detailQuery.data?.photos?.[0] ?? null;
  const heroPhotoUrl = resolveMediaUrl(heroPhoto?.thumbnail_url ?? heroPhoto?.image_url ?? null);

  return (
    <button
      type="button"
      onClick={() => selectSuggestedPlace(place)}
      className="group flex w-full items-stretch overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[#faf8f4] text-left transition-colors hover:border-black/12 hover:bg-white"
    >
      <div className="relative aspect-[1.08] w-[5.8rem] shrink-0 overflow-hidden bg-[linear-gradient(135deg,#ece7df_0%,#f7f1e8_100%)]">
        {heroPhotoUrl ? (
          <img
            src={heroPhotoUrl}
            alt={place.name}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[var(--color-text-muted)]">
            <MapPin className="size-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.82rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
              {place.name}
            </p>
            {place.category ? (
              <p className="mt-0.5 text-[0.68rem] tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                {place.category.replace(/_/g, ' ')}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-1 text-[0.65rem] font-medium text-[var(--color-text-muted)]">
            Map
          </span>
        </div>
        <p className="mt-2 max-h-[2.6rem] overflow-hidden text-[0.75rem] leading-5 text-[var(--color-text-muted)]">
          {place.addressText ?? place.label ?? 'Open this place on the map.'}
        </p>
      </div>
    </button>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-3 py-2.5 text-[0.84rem] leading-7 text-[var(--color-text)]">
      <Markdown
        className="flex flex-col gap-3 text-[0.84rem] leading-7 [&_code]:rounded-[6px] [&_code]:bg-black/[0.04] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.78rem]"
        components={MESSAGE_MARKDOWN_COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
}

function PlannerResultCard({ part }: { part: AssistantDataPart }) {
  const operation = String(part.data.operation ?? 'tool');
  const activity =
    part.data.activity && typeof part.data.activity === 'object'
      ? (part.data.activity as Record<string, unknown>)
      : null;
  const title = typeof activity?.title === 'string' ? activity.title : null;
  const place =
    activity?.place && typeof activity.place === 'object'
      ? (activity.place as Record<string, unknown>)
      : null;
  const placeName = typeof place?.name === 'string' ? place.name : null;
  const jobId = typeof part.data.job_id === 'string' ? part.data.job_id : null;

  return (
    <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
          <WandSparkles className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.84rem] font-semibold text-[var(--color-text)]">
              {title || 'Planner update completed'}
            </p>
            <span className={toneChipClasses('success')}>{formatToolLabel(operation)}</span>
          </div>
          <p className="mt-1 text-[0.75rem] leading-5 text-[var(--color-text-muted)]">
            {jobId
              ? `Job ${jobId.slice(0, 8)} is mirrored in this thread.`
              : placeName
                ? `Updated around ${placeName}.`
                : 'The planner state was updated and the board will refresh automatically.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ part, messageId }: { part: AssistantToolCallPart; messageId: string }) {
  const { confirmToolCall } = usePlannerAssistantContext();
  const pending = Boolean(part.interrupt);
  const result = asRecord(part.result);
  const suggestedPlaces = part.toolName === 'search_places' ? extractSuggestedPlaces(result) : [];
  const stateLabel = pending
    ? 'Awaiting confirmation'
    : part.isError
      ? 'Failed'
      : part.result
        ? 'Complete'
        : 'Running';
  const stateTone = pending
    ? 'warning'
    : part.isError
      ? 'danger'
      : part.result
        ? 'success'
        : 'neutral';
  const summary = summarizeToolUsage(part.toolName, part.args ?? {}, result ?? undefined, {
    pending,
    isError: part.isError,
  });
  const errorDetail = part.isError
    ? (asString(result?.error) ?? asString(result?.message) ?? asString(result?.detail) ?? null)
    : null;

  return (
    <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
          {part.isError ? <XCircle className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.84rem] font-semibold text-[var(--color-text)]">
              {formatToolLabel(part.toolName)}
            </p>
            <span className={toneChipClasses(stateTone)}>{stateLabel}</span>
          </div>
          <p className="mt-1 text-[0.75rem] leading-5 text-[var(--color-text-muted)]">{summary}</p>
        </div>
      </div>

      {suggestedPlaces.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {suggestedPlaces.map((place) => (
            <SuggestedPlaceCard key={place.placeId} place={place} />
          ))}
        </div>
      ) : null}

      {errorDetail ? (
        <div className="mt-3 rounded-[14px] bg-[rgba(255,81,14,0.06)] px-3 py-2 text-[0.74rem] leading-5 text-[rgba(255,81,14,1)]">
          {errorDetail}
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full px-4"
            onClick={() => void confirmToolCall(messageId, part.toolCallId, true)}
          >
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-full px-4"
            onClick={() => void confirmToolCall(messageId, part.toolCallId, false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function jobRowIcon(row: JobTimelineRow) {
  if (row.kind === 'done') {
    return row.status === 'SUCCEEDED' ? (
      <Check className="size-3.5" />
    ) : (
      <XCircle className="size-3.5" />
    );
  }
  if (row.kind === 'tool') {
    const name = row.toolName.toLowerCase();
    if (name.includes('search') || name.includes('places')) return <Search className="size-3.5" />;
    if (name.includes('apply') || name.includes('create') || name.includes('update'))
      return <WandSparkles className="size-3.5" />;
  }
  return <ChevronRight className="size-3.5" />;
}

function JobProgressCard({ part }: { part: AssistantDataPart }) {
  const requestText = String(part.data.request_text ?? 'Planner job');
  const jobStatus = String(part.data.job_status ?? 'PENDING');
  const rows = buildTimelineRows(Array.isArray(part.data.events) ? part.data.events : []);
  const summaryEntries = buildSummaryEntries(
    part.data.summary && typeof part.data.summary === 'object'
      ? (part.data.summary as Record<string, unknown>)
      : undefined,
  );
  const isRunning = jobStatus !== 'SUCCEEDED' && jobStatus !== 'FAILED';
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const currentActivityRow = isRunning && lastRow && lastRow.kind !== 'done' ? lastRow : null;

  const jobTone =
    jobStatus === 'SUCCEEDED' ? 'success' : jobStatus === 'FAILED' ? 'danger' : 'warning';

  const activeRowLabel =
    currentActivityRow?.kind === 'step'
      ? currentActivityRow.name
      : currentActivityRow?.kind === 'tool'
        ? `${formatToolLabel(currentActivityRow.toolName)}…`
        : null;

  return (
    <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
          {jobStatus === 'SUCCEEDED' ? (
            <Check className="size-4" />
          ) : jobStatus === 'FAILED' ? (
            <XCircle className="size-4" />
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.84rem] font-semibold text-[var(--color-text)]">{requestText}</p>
            <span className={toneChipClasses(jobTone)}>
              {isRunning ? 'In progress' : jobStatus}
            </span>
          </div>
          {activeRowLabel ? (
            <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] leading-5 text-[var(--color-primary)]">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--color-primary)]" />
              {activeRowLabel}
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-1 text-[0.75rem] leading-5 text-[var(--color-text-muted)]">
              Queued and waiting for worker pickup.
            </p>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-[14px] bg-[rgba(244,246,248,0.72)] px-3 py-2.5 text-[0.76rem] text-[var(--color-text-muted)]">
          <Clock3 className="size-3.5" />
          <span>Queued and waiting for worker pickup.</span>
        </div>
      ) : (
        <div className="mt-3 rounded-[14px] bg-[rgba(244,246,248,0.55)] px-3 py-2.5">
          <ChainOfThought>
            {rows.map((row) => {
              if (row.kind === 'done') {
                return (
                  <ChainOfThoughtStep key={row.eventId}>
                    <ChainOfThoughtTrigger
                      leftIcon={jobRowIcon(row)}
                      className={cn(
                        'py-1 text-[0.78rem] font-medium',
                        row.status === 'SUCCEEDED'
                          ? 'text-[rgba(21,128,61,1)]'
                          : 'text-[rgba(255,81,14,1)]',
                      )}
                      swapIconOnHover={false}
                    >
                      {row.status === 'SUCCEEDED'
                        ? 'Completed successfully'
                        : 'Finished with an error'}
                    </ChainOfThoughtTrigger>
                  </ChainOfThoughtStep>
                );
              }

              if (row.kind === 'step') {
                const isActive = isRunning && row === currentActivityRow;
                const detail = row.detail;
                return (
                  <ChainOfThoughtStep key={row.eventId} defaultOpen={isActive}>
                    <ChainOfThoughtTrigger
                      leftIcon={jobRowIcon(row)}
                      className={cn(
                        'py-1 text-[0.78rem] font-medium',
                        isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]',
                      )}
                    >
                      {row.name}
                    </ChainOfThoughtTrigger>
                    {detail ? (
                      <ChainOfThoughtContent>
                        <ChainOfThoughtItem className="text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
                          {detail}
                        </ChainOfThoughtItem>
                      </ChainOfThoughtContent>
                    ) : null}
                  </ChainOfThoughtStep>
                );
              }

              // tool row
              const isActive = isRunning && row === currentActivityRow;
              const isComplete = Boolean(row.result);
              const toolStatusLabel = isComplete
                ? row.isError
                  ? 'Error'
                  : 'Done'
                : isActive
                  ? 'Running'
                  : 'Pending';
              const toolTone = isComplete
                ? row.isError
                  ? 'danger'
                  : 'success'
                : isActive
                  ? 'warning'
                  : 'neutral';
              const toolSummary = summarizeTimelineTool(row);
              return (
                <ChainOfThoughtStep key={row.eventId} defaultOpen={isActive}>
                  <ChainOfThoughtTrigger
                    leftIcon={jobRowIcon(row)}
                    className={cn(
                      'py-1 text-[0.78rem] font-medium',
                      isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {formatToolLabel(row.toolName)}
                      <span className={toneChipClasses(toolTone)}>{toolStatusLabel}</span>
                    </span>
                  </ChainOfThoughtTrigger>
                  <ChainOfThoughtContent>
                    <ChainOfThoughtItem className="text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
                      {toolSummary}
                    </ChainOfThoughtItem>
                  </ChainOfThoughtContent>
                </ChainOfThoughtStep>
              );
            })}
          </ChainOfThought>
        </div>
      )}

      {summaryEntries.length > 0 ? (
        <div className="mt-3 rounded-[14px] bg-[rgba(244,246,248,0.72)] px-3 py-2.5">
          <p className="text-[0.67rem] font-medium tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
            Summary
          </p>
          <div className="mt-2 space-y-1.5">
            {summaryEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[0.74rem] leading-5">
                <span className="min-w-[6.5rem] text-[var(--color-text-muted)]">
                  {formatToolLabel(key)}
                </span>
                <span className="flex-1 break-words text-[var(--color-text)]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyThreadState({
  destination,
  hasActivities,
}: {
  destination: string;
  hasActivities: boolean;
}) {
  return (
    <div className="flex min-h-[12rem] flex-col justify-center px-1 pt-1 pb-3">
      <div className="flex gap-2 pb-2.5">
        <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-primary)]">
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-3 py-2.5">
            <p className="text-[0.84rem] leading-7 text-[var(--color-text)]">
              I can help shape <span className="font-semibold">{destination || 'this trip'}</span>.
              Ask me to add places, rebalance a day, or use{' '}
              <span className="font-medium">/generate</span>
              {hasActivities ? ' or /reset' : ''}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlannerAssistantEmptyState({
  destination,
  hasActivities,
}: {
  destination: string;
  hasActivities: boolean;
}) {
  return <EmptyThreadState destination={destination} hasActivities={hasActivities} />;
}

function PlannerAssistantComposer({
  hasActivities,
  draft,
  setDraft,
  isStreaming,
  streamError,
  setStreamError,
  textareaRef,
  onRequestInlineAction,
  onSubmitInput,
}: {
  hasActivities: boolean;
  draft: string;
  setDraft: (value: string) => void;
  isStreaming: boolean;
  streamError: string | null;
  setStreamError: (error: string | null) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  onRequestInlineAction: (action: PlannerAssistantInlineCommand) => void;
  onSubmitInput: (rawInput: string) => Promise<SubmitPlannerAssistantInputResult>;
}) {
  const [commandMenuForcedOpen, setCommandMenuForcedOpen] = useState(false);
  const commandSuggestions = useMemo(
    () =>
      getAvailableCommandSuggestions(
        draft.trimStart().startsWith('/') ? draft : '/',
        hasActivities,
      ),
    [draft, hasActivities],
  );

  const isCommandMenuVisible = commandMenuForcedOpen || draft.trimStart().startsWith('/');

  const handleCommandAction = useCallback(
    (command: PlannerAssistantCommandDefinition) => {
      setStreamError(null);
      setCommandMenuForcedOpen(false);
      setDraft('');
      onRequestInlineAction(command.name as PlannerAssistantInlineCommand);
    },
    [onRequestInlineAction, setDraft, setStreamError],
  );

  const submitComposer = useCallback(async () => {
    const submission = draft;
    if (!submission.trim()) {
      return;
    }

    setDraft('');
    setCommandMenuForcedOpen(false);
    setStreamError(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    const result = await onSubmitInput(submission);

    if (result === 'invalid' || result === 'noop') {
      setDraft(submission);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [draft, onSubmitInput, setDraft, setStreamError, textareaRef]);

  return (
    <div className="border-t border-[var(--color-border)] bg-[#fcfcfb] px-3 py-3">
      {streamError ? (
        <div className="mb-2 rounded-[14px] border border-[rgba(255,81,14,0.18)] bg-[rgba(255,81,14,0.06)] px-3 py-2 text-[0.75rem] text-[rgba(255,81,14,1)]">
          {streamError}
        </div>
      ) : null}

      <div className="relative">
        <AnimatePresence>
          {isCommandMenuVisible ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute inset-x-0 bottom-full z-10 mb-2"
            >
              <Command className="overflow-hidden rounded-[20px] border border-[var(--color-border)] bg-white">
                <CommandList className="max-h-[13rem] p-1.5">
                  <CommandEmpty>No matching commands.</CommandEmpty>
                  <CommandGroup heading="Commands">
                    {commandSuggestions.map((command) => (
                      <CommandItem
                        key={command.name}
                        value={command.name}
                        onSelect={() => handleCommandAction(command)}
                        className="items-start rounded-[14px] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-[0.8rem] font-medium text-[var(--color-text)]">
                            /{command.name}
                          </span>
                          <p className="mt-1 text-[0.73rem] leading-5 text-[var(--color-text-muted)]">
                            {command.description}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <PromptInput
          value={draft}
          onValueChange={(value) => {
            if (streamError) {
              setStreamError(null);
            }
            if (!value.trimStart().startsWith('/')) {
              setCommandMenuForcedOpen(false);
            }
            setDraft(value);
          }}
          onSubmit={() => void submitComposer()}
          textareaRef={textareaRef}
          className="rounded-[24px] border-[var(--color-border)] bg-white p-0"
        >
          <PromptInputTextarea
            placeholder="Ask about this trip or type /generate…"
            className="min-h-[104px] px-4 py-3 text-[0.9rem] leading-7"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <PromptInputActions className="gap-1.5">
              <PromptInputAction tooltip="Commands">
                <Button
                  type="button"
                  size="icon"
                  className="size-8 rounded-full border border-[var(--color-border)] bg-[rgba(15,23,42,0.05)] text-[var(--color-text)] hover:bg-[rgba(15,23,42,0.09)]"
                  onClick={() => {
                    setCommandMenuForcedOpen(true);
                    textareaRef.current?.focus();
                  }}
                >
                  <Slash className="size-4" />
                </Button>
              </PromptInputAction>
            </PromptInputActions>
            <div className="flex items-center gap-2">
              {draft.length > MAX_INPUT_LENGTH * 0.8 ? (
                <span
                  className={cn(
                    'text-[0.68rem] tabular-nums',
                    draft.length > MAX_INPUT_LENGTH
                      ? 'text-[rgba(255,81,14,1)]'
                      : 'text-[var(--color-text-muted)]',
                  )}
                >
                  {draft.length}/{MAX_INPUT_LENGTH}
                </span>
              ) : null}
              <PromptInputActions className="gap-1.5">
                <PromptInputAction tooltip={isStreaming ? 'Sending' : 'Send'}>
                  <Button
                    type="button"
                    size="icon"
                    className="size-8 rounded-full bg-[#111827] text-white hover:bg-[#0f172a]"
                    disabled={isStreaming || !draft.trim() || draft.length > MAX_INPUT_LENGTH}
                    onClick={() => void submitComposer()}
                  >
                    {isStreaming ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </div>
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

function UserMessage() {
  const state = useAuiState((s) => s.message);
  const text = state.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  return (
    <MessagePrimitive.Root className="flex justify-end pb-2.5">
      <div className="max-w-[86%] rounded-[18px] rounded-br-[8px] bg-[#111827] px-3 py-2.5 text-white">
        <p className="text-[0.83rem] leading-6 whitespace-pre-wrap">{text}</p>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessageView() {
  const state = useAuiState((s) => s.message);
  const parts = state.content as AssistantMessagePart[];
  const messageId = state.id;

  return (
    <MessagePrimitive.Root className="flex gap-2 pb-2.5">
      <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-primary)]">
        {state.status?.type === 'running' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Bot className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {parts.map((part, index) => {
          if (isTextPart(part)) {
            return <TextBlock key={`${messageId}-text-${index}`} text={part.text} />;
          }
          if (isToolPart(part)) {
            return (
              <ToolCard
                key={`${messageId}-tool-${part.toolCallId}-${index}`}
                part={part}
                messageId={messageId}
              />
            );
          }
          if (isDataPart(part) && part.name === 'planner-result') {
            return <PlannerResultCard key={`${messageId}-result-${index}`} part={part} />;
          }
          if (isDataPart(part) && part.name === 'job-progress') {
            return <JobProgressCard key={`${messageId}-job-${index}`} part={part} />;
          }
          return null;
        })}
      </div>
    </MessagePrimitive.Root>
  );
}

export function PlannerAssistantPanel({
  tripId,
  destination,
  days,
  hasActivities,
  isOpen,
  requestedInlineAction,
  onRequestedInlineActionHandled,
  onSubmitInlineAction,
  isPlannerActionPending,
  onOpenChange,
  onSelectSuggestedPlace,
}: PlannerAssistantPanelProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { data, isLoading } = useAssistantThread(tripId);
  const [inlineAction, setInlineAction] = useState<PlannerGenerationAction | null>(null);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobStreamControllersRef = useRef(new Map<string, AbortController>());
  const ignoredJobResumeIdsRef = useRef(new Set<string>());
  const handledRequestedInlineActionRef = useRef<PlannerGenerationAction | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSubmitTimeRef = useRef(0);
  const [discussionName, setDiscussionName] = useState(
    () => localStorage.getItem(`assistant-discussion-${tripId}`) ?? '',
  );
  const [isRenamingDiscussion, setIsRenamingDiscussion] = useState(false);
  const [renameInputValue, setRenameInputValue] = useState('');
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>(() =>
    loadSavedConversations(tripId),
  );
  const [viewingConvId, setViewingConvId] = useState<string | null>(null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() =>
    loadHiddenIds(tripId),
  );

  const liveMessages = data?.messages ?? [];
  // Filter out messages that belong to a previously archived conversation.
  // We cannot clear the React Query cache (staleTime: 0 causes immediate refetch
  // from the backend), so we track hidden IDs in localStorage instead.
  const currentLiveMessages = useMemo(
    () => liveMessages.filter((m) => !hiddenMessageIds.has(m.id)),
    [liveMessages, hiddenMessageIds],
  );
  const displayMessages =
    viewingConvId !== null
      ? (savedConversations.find((c) => c.id === viewingConvId)?.messages ?? [])
      : currentLiveMessages;
  const runningJobIds = useMemo(() => {
    return Array.from(
      new Set(
        currentLiveMessages.flatMap((message) => {
          if (
            message.role !== 'assistant' ||
            message.status !== 'running' ||
            !message.source_job_id ||
            !message.parts.some((part) => isJobProgressPart(part))
          ) {
            return [];
          }
          return [message.source_job_id];
        }),
      ),
    );
  }, [currentLiveMessages]);
  useEffect(() => {
    if (!requestedInlineAction) {
      handledRequestedInlineActionRef.current = null;
      return;
    }
    if (handledRequestedInlineActionRef.current === requestedInlineAction) {
      return;
    }
    handledRequestedInlineActionRef.current = requestedInlineAction;
    setInlineAction(requestedInlineAction);
    if (!isOpen) {
      onOpenChange(true);
    }
    onRequestedInlineActionHandled();
  }, [isOpen, onOpenChange, onRequestedInlineActionHandled, requestedInlineAction]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (isMobile || !isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, isOpen, onOpenChange]);

  useEffect(() => {
    const controllerMap = jobStreamControllersRef.current;
    const activeJobIds = new Set(runningJobIds);
    // Note: intentionally NOT cleaning up ignoredJobResumeIdsRef here.
    // After a 'done' event, invalidateQueries causes the thread to refetch
    // which may temporarily restore 'running' status from the backend before
    // the server-side update propagates. Cleaning up the ignored set during
    // this window causes the stream to restart, creating an infinite loop.

    for (const [jobId, controller] of controllerMap.entries()) {
      if (!activeJobIds.has(jobId)) {
        controller.abort();
        controllerMap.delete(jobId);
      }
    }

    for (const jobId of activeJobIds) {
      if (ignoredJobResumeIdsRef.current.has(jobId)) {
        continue;
      }
      if (controllerMap.has(jobId)) {
        continue;
      }

      const controller = new AbortController();
      controllerMap.set(jobId, controller);

      void streamJobProgress(
        jobId,
        (event: JobProgressEvent) => {
          appendAssistantJobProgressEvent(queryClient, tripId, jobId, event);
          if (event.type === 'done') {
            ignoredJobResumeIdsRef.current.add(jobId);
            controller.abort();
            // Invalidate planner immediately to show new activities
            void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
            // Delay thread invalidation: the backend may not have committed the
            // updated message status yet, so an immediate refetch would overwrite
            // the local 'complete' status we just applied above and make the card
            // appear frozen (spinner never stops). Give the backend a few seconds.
            window.setTimeout(() => {
              void queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) });
            }, 4000);
          }
        },
        controller.signal,
      )
        .catch((error) => {
          if ((error as Error)?.name === 'AbortError') {
            return;
          }
          if (isApiError(error) && error.status === 404) {
            ignoredJobResumeIdsRef.current.add(jobId);
            return;
          }
          setStreamError(
            (current) => current ?? toInlineError(error, 'Failed to resume planner job progress.'),
          );
        })
        .finally(() => {
          if (controllerMap.get(jobId) === controller) {
            controllerMap.delete(jobId);
          }
        });
    }
  }, [queryClient, runningJobIds, tripId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      for (const controller of jobStreamControllersRef.current.values()) {
        controller.abort();
      }
      jobStreamControllersRef.current.clear();
    };
  }, []);

  const cancelCurrentStream = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(
    async (payload: AssistantMessageStreamInput, optimisticMessageId?: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStreamError(null);

      try {
        await streamAssistantMessages(
          tripId,
          payload,
          (event) => {
            if (event.type === 'message_upsert') {
              upsertAssistantMessages(queryClient, tripId, [event.message]);
              return;
            }
            if (event.type === 'error') {
              setStreamError(event.error.message);
            }
          },
          controller.signal,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) }),
          queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) }),
        ]);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return;
        }
        if (optimisticMessageId) {
          removeAssistantMessage(queryClient, tripId, optimisticMessageId);
        }
        setStreamError(toInlineError(error, 'Failed to reach the planner assistant.'));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [queryClient, tripId],
  );

  const handleTextTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) {
        return;
      }

      // Rate limit: prevent rapid successive messages
      const now = Date.now();
      if (now - lastSubmitTimeRef.current < SUBMIT_COOLDOWN_MS) {
        setStreamError('Please wait a moment before sending another message.');
        return;
      }

      // Length limit
      if (trimmed.length > MAX_INPUT_LENGTH) {
        setStreamError(`Message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`);
        return;
      }

      // Strip null bytes and dangerous control characters (basic injection protection)
      const sanitized = stripControlCharacters(trimmed).trim();
      if (!sanitized) {
        return;
      }

      // Warn on obvious prompt injection patterns
      const injectionPatterns = [
        /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
        /you\s+are\s+now\s+a/i,
        /disregard\s+(all\s+)?(previous|prior)/i,
        /system\s*:\s*[^\n]{0,100}/i,
      ];
      if (injectionPatterns.some((p) => p.test(sanitized))) {
        setStreamError(
          'This message contains patterns that are not allowed. Please rephrase your request.',
        );
        return;
      }

      lastSubmitTimeRef.current = now;
      const clientMessageId = crypto.randomUUID();
      const optimisticMessage: AssistantMessage = {
        id: clientMessageId,
        thread_id: data?.id ?? `thread-${tripId}`,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: sanitized }],
        metadata: { kind: 'chat' },
        source_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      upsertAssistantMessages(queryClient, tripId, [optimisticMessage]);
      onOpenChange(true);

      await startStream(
        {
          client_message_id: clientMessageId,
          text: sanitized,
        },
        clientMessageId,
      );
    },
    [data?.id, isStreaming, onOpenChange, queryClient, startStream, tripId],
  );

  const handleSubmitInput = useCallback(
    async (rawInput: string): Promise<SubmitPlannerAssistantInputResult> => {
      const trimmed = rawInput.trim();
      if (!trimmed) {
        return 'noop';
      }
      if (isStreaming) {
        return 'noop';
      }

      if (!trimmed.startsWith('/')) {
        await handleTextTurn(trimmed);
        return 'sent';
      }

      const parsed = parsePlannerAssistantCommand(trimmed);
      if (!parsed) {
        return 'noop';
      }

      if (parsed.type === 'invalid') {
        setStreamError(parsed.message);
        return 'invalid';
      }

      if (parsed.type === 'inline') {
        setStreamError(null);
        setInlineAction(parsed.name);
        onOpenChange(true);
        return 'inline';
      }

      return 'noop';
    },
    [handleTextTurn, isStreaming, onOpenChange],
  );

  const handleCancelInlineAction = useCallback(() => {
    setInlineAction(null);
  }, []);

  const handleSubmitInlineAction = useCallback(
    async (
      action: PlannerGenerationAction,
      values: PlannerGenerationFormValues,
      idempotencyKey: string,
    ) => {
      try {
        await onSubmitInlineAction(action, values, idempotencyKey);
        setInlineAction(null);
      } catch {
        // planner mutations already surface toast errors upstream
      }
    },
    [onSubmitInlineAction],
  );

  const confirmToolCall = useCallback(
    async (messageId: string, toolCallId: string, confirmed: boolean) => {
      if (isStreaming) {
        return;
      }
      await startStream({
        confirmation: {
          message_id: messageId,
          tool_call_id: toolCallId,
          confirmed,
        },
      });
    },
    [isStreaming, startStream],
  );

  const selectSuggestedPlace = useCallback(
    (place: PlannerAssistantSuggestedPlace) => {
      onSelectSuggestedPlace?.(place);
    },
    [onSelectSuggestedPlace],
  );

  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages: displayMessages,
    isRunning: isStreaming && viewingConvId === null,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const text = extractAppendText(message);
      await handleSubmitInput(text);
    },
    onCancel: cancelCurrentStream,
  });

  const handleRenameDiscussion = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      setDiscussionName(trimmedName);
      if (trimmedName) {
        localStorage.setItem(`assistant-discussion-${tripId}`, trimmedName);
      } else {
        localStorage.removeItem(`assistant-discussion-${tripId}`);
      }
      setIsRenamingDiscussion(false);
    },
    [tripId],
  );

  const handleClearConversation = useCallback(() => {
    if (currentLiveMessages.length === 0) return;
    const newHiddenIds = new Set([...hiddenMessageIds, ...currentLiveMessages.map((m) => m.id)]);
    setHiddenMessageIds(newHiddenIds);
    persistHiddenIds(tripId, newHiddenIds);
  }, [currentLiveMessages, hiddenMessageIds, tripId]);

  const handleNewConversation = useCallback(() => {
    if (currentLiveMessages.length > 0) {
      const conv: SavedConversation = {
        id: crypto.randomUUID(),
        name:
          discussionName ||
          new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        messages: currentLiveMessages,
        savedAt: new Date().toISOString(),
      };
      const updated = [conv, ...savedConversations];
      setSavedConversations(updated);
      persistSavedConversations(tripId, updated);
      // Hide current messages from the live view — cannot clear React Query cache
      // because staleTime: 0 causes an immediate refetch that restores them.
      const newHiddenIds = new Set([...hiddenMessageIds, ...currentLiveMessages.map((m) => m.id)]);
      setHiddenMessageIds(newHiddenIds);
      persistHiddenIds(tripId, newHiddenIds);
    }
    setViewingConvId(null);
    setDiscussionName('');
    localStorage.removeItem(`assistant-discussion-${tripId}`);
  }, [currentLiveMessages, discussionName, savedConversations, hiddenMessageIds, tripId]);

  const handleSwitchConversation = useCallback((convId: string | null) => {
    setViewingConvId(convId);
  }, []);

  const handleDeleteSavedConversation = useCallback(
    (convId: string) => {
      const updated = savedConversations.filter((c) => c.id !== convId);
      setSavedConversations(updated);
      persistSavedConversations(tripId, updated);
      if (viewingConvId === convId) {
        setViewingConvId(null);
      }
    },
    [savedConversations, viewingConvId, tripId],
  );

  const assistantSurface = (
    <>
      <div className="border-b border-[var(--color-border)] px-3 py-3 text-left">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            {viewingConvId !== null ? (
              <h2 className="text-left text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text-muted)]">
                {savedConversations.find((c) => c.id === viewingConvId)?.name ?? 'Archived'}
              </h2>
            ) : isRenamingDiscussion ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRenameDiscussion(renameInputValue);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  value={renameInputValue}
                  onChange={(e) => setRenameInputValue(e.target.value)}
                  onBlur={() => handleRenameDiscussion(renameInputValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsRenamingDiscussion(false);
                    }
                  }}
                  placeholder="Conversation name…"
                  className="min-w-0 flex-1 rounded-[12px] border border-[var(--color-border)] bg-white px-2 py-0.5 text-[0.84rem] font-semibold tracking-[-0.02em] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                />
              </form>
            ) : (
              <h2 className="text-left text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                {discussionName || 'Planner Assistant'}
              </h2>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.74rem] text-[var(--color-text-muted)]">
              <MapPin className="size-3.5" />
              <span>{destination || 'Current trip'}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-full border-[var(--color-border)] bg-white/78 text-[var(--color-text-muted)]"
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Conversation options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[210px]">
                <DropdownMenuItem onClick={handleNewConversation}>
                  <MessageSquarePlus className="mr-2 size-3.5" />
                  New conversation
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleSwitchConversation(null)}
                  className={cn(
                    'flex items-center',
                    viewingConvId === null && 'text-[var(--color-primary)]',
                  )}
                >
                  <Radio className="mr-2 size-3.5 shrink-0" />
                  <span className="flex-1 truncate">Live thread</span>
                  {viewingConvId === null && <Check className="ml-2 size-3.5 shrink-0" />}
                </DropdownMenuItem>
                {savedConversations.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <p className="px-2 py-1.5 text-[0.67rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Saved
                    </p>
                    {savedConversations.map((conv) => (
                      <DropdownMenuItem
                        key={conv.id}
                        onClick={() => handleSwitchConversation(conv.id)}
                        className={cn(
                          'flex items-center',
                          viewingConvId === conv.id && 'text-[var(--color-primary)]',
                        )}
                      >
                        <History className="mr-2 size-3.5 shrink-0" />
                        <span className="flex-1 truncate">{conv.name}</span>
                        {viewingConvId === conv.id ? (
                          <Check className="ml-2 size-3.5 shrink-0" />
                        ) : (
                          <button
                            type="button"
                            className="ml-2 shrink-0 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[rgba(255,81,14,1)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSavedConversation(conv.id);
                            }}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setRenameInputValue(discussionName);
                    setIsRenamingDiscussion(true);
                  }}
                  disabled={viewingConvId !== null}
                >
                  <Pencil className="mr-2 size-3.5" />
                  Rename conversation
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-[rgba(255,81,14,1)] focus:text-[rgba(255,81,14,1)]"
                  onClick={handleClearConversation}
                  disabled={viewingConvId !== null}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  Clear messages
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isMobile ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-full border-[var(--color-border)] bg-white/78 text-[var(--color-text-muted)]"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" />
                <span className="sr-only">Close assistant</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {viewingConvId !== null ? (
        <div className="flex items-center justify-between border-b border-[var(--color-gold)]/20 bg-[var(--color-gold)]/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[0.73rem] text-[var(--color-warning)]/90">
            <History className="size-3.5" />
            <span>Viewing archived conversation</span>
          </div>
          <button
            type="button"
            className="text-[0.73rem] font-medium text-[var(--color-primary)] hover:underline"
            onClick={() => handleSwitchConversation(null)}
          >
            Return to live
          </button>
        </div>
      ) : null}

      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">
              <Loader2 className="mr-2 size-4 animate-spin text-[var(--color-primary)]" />
              <span>Loading assistant thread…</span>
            </div>
          ) : (
            <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <ThreadPrimitive.Viewport
                autoScroll
                className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pt-3"
              >
                <ThreadPrimitive.Empty>
                  <PlannerAssistantEmptyState
                    destination={destination}
                    hasActivities={hasActivities}
                  />
                </ThreadPrimitive.Empty>

                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage: AssistantMessageView,
                  }}
                />

                {inlineAction ? (
                  <div className="pb-2.5">
                    <PlannerGenerationInlineCard
                      key={inlineAction}
                      action={inlineAction}
                      days={days}
                      isSubmitting={isPlannerActionPending}
                      onCancel={handleCancelInlineAction}
                      onSubmit={handleSubmitInlineAction}
                    />
                  </div>
                ) : null}
              </ThreadPrimitive.Viewport>
              {viewingConvId !== null ? (
                <div className="border-t border-[var(--color-border)] bg-[#fcfcfb] px-3 py-3">
                  <button
                    type="button"
                    className="w-full rounded-[24px] border border-[var(--color-border)] bg-white px-4 py-3 text-[0.84rem] text-[var(--color-text-muted)] transition-colors hover:bg-[#faf8f4]"
                    onClick={() => handleSwitchConversation(null)}
                  >
                    Return to live thread to send messages
                  </button>
                </div>
              ) : (
                <PlannerAssistantComposer
                  hasActivities={hasActivities}
                  draft={draft}
                  setDraft={setDraft}
                  isStreaming={isStreaming}
                  streamError={streamError}
                  setStreamError={setStreamError}
                  textareaRef={textareaRef}
                  onRequestInlineAction={(action) => {
                    setInlineAction(action);
                    onOpenChange(true);
                  }}
                  onSubmitInput={handleSubmitInput}
                />
              )}
            </ThreadPrimitive.Root>
          )}
        </div>
      </AssistantRuntimeProvider>
    </>
  );

  return (
    <PlannerAssistantContext.Provider value={{ confirmToolCall, selectSuggestedPlace }}>
      {isMobile ? (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="flex h-[min(88vh,48rem)] w-full flex-col gap-0 overflow-hidden rounded-t-[28px] border-x-0 border-b-0 border-[var(--color-border)] bg-[#fcfcfb] p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Planner Assistant</SheetTitle>
              <SheetDescription>{destination || 'Current trip'}</SheetDescription>
            </SheetHeader>
            {assistantSurface}
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {isOpen ? (
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
              className="absolute inset-y-0 left-0 z-40 flex w-[46%] max-w-full min-w-[380px] flex-col overflow-hidden border-r border-[var(--color-border)] bg-[#fcfcfb]"
            >
              {assistantSurface}
            </motion.aside>
          ) : null}
        </AnimatePresence>
      )}
    </PlannerAssistantContext.Provider>
  );
}

type MirrorPlannerJobOptions = {
  tripId: string;
  jobId: string;
  requestText: string;
  action: string;
};

export async function mirrorPlannerJobToAssistant(
  queryClient: QueryClient,
  options: MirrorPlannerJobOptions,
) {
  const messages = await mirrorAssistantJob(options.tripId, {
    job_id: options.jobId,
    request_text: options.requestText,
    action: options.action,
  });
  upsertAssistantMessages(queryClient, options.tripId, messages);
  await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(options.tripId) });
}

import type { ReactNode } from 'react';
import { MapPin, Sparkles, WandSparkles, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { useGooglePlaceDetail } from '@/entities/place/queries';
import type { AssistantDataPart, AssistantToolCallPart } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { resolveMediaUrl } from '@/shared/lib/media';
import { usePlannerAssistantContext } from './assistant.context';
import {
  asRecord,
  asString,
  extractSuggestedPlaces,
  formatToolLabel,
  summarizeToolUsage,
  toneChipClasses,
} from './assistant.utils';
import type { PlannerAssistantSuggestedPlace } from './assistant.types';

export const MESSAGE_MARKDOWN_COMPONENTS = {
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

export function SuggestedPlaceCard({ place }: { place: PlannerAssistantSuggestedPlace }) {
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

export function TextBlock({ text }: { text: string }) {
  return (
    <div className="rounded-[18px] rounded-tl-[8px] bg-white px-3 py-2.5 text-[0.84rem] leading-7 text-[var(--color-text)] border border-b border-[var(--color-border)]">
      <Markdown
        className="flex flex-col gap-3 text-[0.84rem] leading-7 [&_code]:rounded-[6px] [&_code]:bg-black/[0.04] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.78rem]"
        components={MESSAGE_MARKDOWN_COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function PlannerResultCard({ part }: { part: AssistantDataPart }) {
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
    <div className="rounded-[18px] bg-white px-3 py-3 rounded-tl-[8px] border border-[var(--color-border)]">
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

export function ToolCard({ part, messageId }: { part: AssistantToolCallPart; messageId: string }) {
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
    running: !pending && !part.isError && !part.result,
    isError: part.isError,
  });
  const errorDetail = part.isError
    ? (asString(result?.error) ?? asString(result?.message) ?? asString(result?.detail) ?? null)
    : null;

  return (
    <div className="rounded-[18px] bg-white px-3 py-3 rounded-tl-[8px] border border-[var(--color-border)]">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(15,23,42,0.04)] text-[var(--color-text)]">
          {part.isError ? (
            <XCircle className="h-4 w-4 text-[rgba(255,81,14,1)]" />
          ) : (
            <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
          )}
        </div>
        <div className="min-w-0 flex-1 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.84rem] font-medium text-[var(--color-text)]">
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

export { cn };

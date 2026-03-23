import { Check, ChevronRight, Clock3, Search, Sparkles, WandSparkles, XCircle } from 'lucide-react';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from '@/components/ui/chain-of-thought';
import type { AssistantDataPart } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import {
  buildSummaryEntries,
  buildTimelineRows,
  formatToolLabel,
  summarizeTimelineTool,
  toneChipClasses,
} from './assistant.utils';
import type { JobTimelineRow } from './assistant.types';

export function jobRowIcon(row: JobTimelineRow) {
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

export function JobProgressCard({ part }: { part: AssistantDataPart }) {
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
    <div className="rounded-[18px] bg-white px-3 py-3 rounded-tl-[8px] border border-[var(--color-border)]">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(15,23,42,0.04)] text-[var(--color-text)]">
          {jobStatus === 'SUCCEEDED' ? (
            <Check className="h-4 w-4 text-[rgba(21,128,61,1)]" />
          ) : jobStatus === 'FAILED' ? (
            <XCircle className="h-4 w-4 text-[rgba(255,81,14,1)]" />
          ) : (
            <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
          )}
        </div>
        <div className="min-w-0 flex-1 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-[0.84rem] font-medium text-[var(--color-text)]">
              {requestText}
            </p>
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
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-[rgba(15,23,42,0.03)] px-3 py-2 text-[0.76rem] text-[var(--color-text-muted)]">
          <Clock3 className="h-3.5 w-3.5" />
          <span>Starting up…</span>
        </div>
      ) : (
        <div className="mt-2.5 rounded-xl border border-[var(--color-border)] bg-white/40 px-3 py-2.5 shadow-sm">
          <ChainOfThought>
            {rows.map((row) => {
              if (row.kind === 'done') {
                return (
                  <ChainOfThoughtStep key={row.eventId}>
                    <ChainOfThoughtTrigger
                      leftIcon={jobRowIcon(row)}
                      className={cn(
                        'py-1.5 text-[0.78rem] font-medium transition-colors',
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
                  <ChainOfThoughtStep key={row.eventId} defaultOpen>
                    <ChainOfThoughtTrigger
                      leftIcon={jobRowIcon(row)}
                      className={cn(
                        'py-1.5 text-[0.78rem] font-medium transition-colors',
                        isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]',
                      )}
                    >
                      {row.name}
                    </ChainOfThoughtTrigger>
                    {detail ? (
                      <ChainOfThoughtContent>
                        <ChainOfThoughtItem className="break-words pb-2 pt-0.5 text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
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
                <ChainOfThoughtStep key={row.eventId} defaultOpen>
                  <ChainOfThoughtTrigger
                    leftIcon={jobRowIcon(row)}
                    className={cn(
                      'py-1.5 text-[0.78rem] font-medium transition-colors',
                      isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {formatToolLabel(row.toolName)}
                      <span className={toneChipClasses(toolTone)}>{toolStatusLabel}</span>
                    </span>
                  </ChainOfThoughtTrigger>
                  <ChainOfThoughtContent>
                    <ChainOfThoughtItem className="break-words pb-2 pt-0.5 text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
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
        <div className="mt-2.5 rounded-xl border border-[var(--color-border)] bg-white/40 px-3 py-2.5 shadow-sm">
          <p className="text-[0.67rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
            Summary
          </p>
          <div className="mt-2 space-y-2">
            {summaryEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[0.74rem] leading-5">
                <span className="min-w-[5.5rem] font-medium text-[var(--color-text-muted)]">
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

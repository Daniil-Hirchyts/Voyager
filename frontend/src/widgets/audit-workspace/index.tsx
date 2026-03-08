import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Filter, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAuditLog } from '@/entities/audit/queries'
import { useExportsStore } from '@/shared/stores/exports.store'
import { cn } from '@/shared/lib/cn'
import { WorkspaceHeader, WorkspacePage, WorkspaceStatCard, WorkspaceStatGrid } from '@/shared/layouts/workspace-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { AuditLogEntry } from '@/shared/api/types'
import type { AuditFilters } from '@/entities/audit/api'

const PAGE_SIZE = 20

const filtersSchema = z
  .object({
    entity_type: z.string().optional(),
    action: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .refine(
    (d) => {
      if (d.from && d.to) return d.from <= d.to
      return true
    },
    { message: 'From date must not be after To date', path: ['from'] },
  )

type FilterDraft = z.infer<typeof filtersSchema>

function AuditEntryRow({
  entry,
  selected,
  onClick,
}: {
  entry: AuditLogEntry
  selected: boolean
  onClick: () => void
}) {
  const date = new Date(entry.created_at)
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timeLabel = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-[18px] border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-[var(--color-primary)] bg-[rgba(114,174,230,0.12)]'
          : 'border-[var(--color-border-strong)] bg-white/70 hover:border-[rgba(114,174,230,0.38)] hover:bg-white/88',
      )}
      aria-pressed={selected}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="entity">{entry.entity_type}</Badge>
          <Badge variant="action">{entry.action}</Badge>
          {entry.entity_id && (
            <span className="max-w-[120px] truncate font-mono text-xs text-[var(--color-text-muted)]">{entry.entity_id}</span>
          )}
        </div>
        {entry.request_path && (
          <p className="truncate font-mono text-xs text-[var(--color-text-muted)]">{entry.request_path}</p>
        )}
      </div>
      <div className="shrink-0 text-right text-xs text-[var(--color-text-muted)]">
        <div>{dateLabel}</div>
        <div>{timeLabel}</div>
      </div>
    </button>
  )
}

function AuditDetailDrawer({
  entry,
  onClose,
}: {
  entry: AuditLogEntry
  onClose: () => void
}) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = drawerRef.current
    if (!el) return
    el.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const date = new Date(entry.created_at)

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Audit entry detail"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(18,33,50,0.24)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/70 bg-[rgba(255,255,255,0.94)] shadow-[0_32px_80px_-30px_rgba(32,56,83,0.32)] outline-none backdrop-blur-xl"
      >
        <div
          className="flex items-center justify-between border-b border-[var(--color-border-strong)] px-5 py-4"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="entity">{entry.entity_type}</Badge>
            <Badge variant="action">{entry.action}</Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close detail drawer"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Metadata</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-[var(--color-text-muted)]">ID</dt>
              <dd className="truncate font-mono text-xs text-[var(--color-text)]">{entry.id}</dd>
              {entry.entity_id && (
                <>
                  <dt className="text-[var(--color-text-muted)]">Entity ID</dt>
                  <dd className="truncate font-mono text-xs text-[var(--color-text)]">{entry.entity_id}</dd>
                </>
              )}
              {entry.user_id && (
                <>
                  <dt className="text-[var(--color-text-muted)]">User ID</dt>
                  <dd className="truncate font-mono text-xs text-[var(--color-text)]">{entry.user_id}</dd>
                </>
              )}
              {entry.correlation_id && (
                <>
                  <dt className="text-[var(--color-text-muted)]">Correlation ID</dt>
                  <dd className="truncate font-mono text-xs text-[var(--color-text)]">{entry.correlation_id}</dd>
                </>
              )}
              {entry.request_path && (
                <>
                  <dt className="text-[var(--color-text-muted)]">Request path</dt>
                  <dd className="truncate font-mono text-xs text-[var(--color-text)]">{entry.request_path}</dd>
                </>
              )}
              <dt className="text-[var(--color-text-muted)]">Timestamp</dt>
              <dd className="text-xs text-[var(--color-text)]">{date.toLocaleString()}</dd>
            </dl>
          </section>

          {entry.before && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Before</h3>
              <pre
                className="max-h-48 overflow-auto rounded-[16px] border border-[var(--color-border-strong)] bg-white/72 p-3 font-mono text-xs whitespace-pre-wrap break-all text-[var(--color-text)]"
              >
                {JSON.stringify(entry.before, null, 2)}
              </pre>
            </section>
          )}

          {entry.after && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">After</h3>
              <pre
                className="max-h-48 overflow-auto rounded-[16px] border border-[var(--color-border-strong)] bg-white/72 p-3 font-mono text-xs whitespace-pre-wrap break-all text-[var(--color-text)]"
              >
                {JSON.stringify(entry.after, null, 2)}
              </pre>
            </section>
          )}

          {!entry.before && !entry.after && (
            <p className="text-xs text-[var(--color-text-muted)]">No before/after snapshot available for this entry.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-3 rounded-[18px] border border-[var(--color-border-strong)] bg-white/72 px-4 py-3"
    >
      <div className="flex-1 space-y-1.5">
        <div className="flex gap-2">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  )
}

interface Props {
  tripId: string
}

export default function AuditWorkspace({ tripId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { auditDetailEntryId, setAuditDetailEntryId } = useExportsStore()

  const getFiltersFromParams = (): FilterDraft => ({
    entity_type: searchParams.get('entity_type') ?? undefined,
    action: searchParams.get('action') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  })

  const [draft, setDraft] = useState<FilterDraft>(getFiltersFromParams)
  const [offset, setOffset] = useState(0)
  const [filterError, setFilterError] = useState<string | null>(null)

  const activeFilters: AuditFilters = {
    entity_type: searchParams.get('entity_type') ?? undefined,
    action: searchParams.get('action') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    limit: PAGE_SIZE,
    offset,
  }

  const { data, isFetching, isLoading, isError, error } = useAuditLog(tripId, activeFilters)
  const entries = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const selectedEntry = auditDetailEntryId
    ? entries.find((e) => e.id === auditDetailEntryId) ?? null
    : null

  const applyFilters = () => {
    const result = filtersSchema.safeParse(draft)
    if (!result.success) {
      setFilterError(result.error.errors[0]?.message ?? 'Invalid filter')
      return
    }
    setFilterError(null)
    setOffset(0)
    const next = new URLSearchParams(searchParams)
    if (draft.entity_type) next.set('entity_type', draft.entity_type)
    else next.delete('entity_type')
    if (draft.action) next.set('action', draft.action)
    else next.delete('action')
    if (draft.from) next.set('from', draft.from)
    else next.delete('from')
    if (draft.to) next.set('to', draft.to)
    else next.delete('to')
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => {
    setDraft({})
    setFilterError(null)
    setOffset(0)
    setSearchParams({}, { replace: true })
  }

  const hasActiveFilters = !!(
    searchParams.get('entity_type') ||
    searchParams.get('action') ||
    searchParams.get('from') ||
    searchParams.get('to')
  )

  return (
    <WorkspacePage className="gap-6">
      <WorkspaceHeader
        eyebrow="Audit log"
        title="Inspect every append-only change."
        description="Trace who changed what, when it happened, and which payload moved through the trip workspace."
        meta={hasActiveFilters ? <span className="voyager-pill">Filters active</span> : undefined}
      />

      <WorkspaceStatGrid className="md:grid-cols-3">
        <WorkspaceStatCard label="Entries" value={total} detail="Total records matching the current query" icon={Filter} />
        <WorkspaceStatCard label="Current page" value={currentPage} detail={totalPages > 0 ? `of ${totalPages}` : 'No pages yet'} icon={ChevronRight} />
        <WorkspaceStatCard label="Selection" value={selectedEntry ? 'Open' : 'None'} detail={selectedEntry ? selectedEntry.action : 'Choose an entry to inspect payload detail'} icon={X} />
      </WorkspaceStatGrid>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card variant="solid" className="h-fit">
          <CardHeader className="gap-3">
            <Badge variant="neutral" className="w-fit">Filters</Badge>
            <CardTitle>Refine the audit feed</CardTitle>
            <CardDescription>
              Narrow the stream by entity type, action, or time window.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="audit-entity-type">
              Entity type
            </label>
            <Input
              id="audit-entity-type"
              value={draft.entity_type ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, entity_type: e.target.value || undefined }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="e.g. activity"
              className="h-10 text-sm"
            />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="audit-action">
              Action
            </label>
            <Input
              id="audit-action"
              value={draft.action ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value || undefined }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="e.g. create"
              className="h-10 text-sm"
            />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="audit-from">
              From
            </label>
            <Input
              id="audit-from"
              type="date"
              value={draft.from ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
              className="h-10 text-sm"
            />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="audit-to">
              To
            </label>
            <Input
              id="audit-to"
              type="date"
              value={draft.to ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
              className="h-10 text-sm"
            />
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button size="sm" onClick={applyFilters}>
                <Filter data-icon="inline-start" />
                Apply
              </Button>
              {hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X data-icon="inline-start" />
                  Clear
                </Button>
              ) : null}
            </div>
            {filterError ? (
              <p className="text-xs text-[var(--color-danger)]">{filterError}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card variant="solid" className="min-h-[32rem]">
          <CardHeader className="gap-3">
            <Badge variant="accent" className="w-fit">Entries</Badge>
            <CardTitle>Trip mutation stream</CardTitle>
            <CardDescription>
              Open any row to inspect metadata and before/after snapshots in the side drawer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </>
            ) : null}

            {isError ? (
              <Alert variant="destructive">
                <p className="text-sm">
                  {error instanceof Error ? error.message : 'Failed to load audit log.'}
                </p>
              </Alert>
            ) : null}

            {!isLoading && !isError && entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-[24px] border border-dashed border-[var(--color-border-strong)] bg-white/58 py-16 text-center">
                <p className="text-sm font-medium text-[var(--color-text)]">No audit entries found</p>
                {hasActiveFilters ? (
                  <p className="max-w-xs text-xs leading-5 text-[var(--color-text-muted)]">
                    Try adjusting or clearing your filters to see more entries.
                  </p>
                ) : (
                  <p className="max-w-xs text-xs leading-5 text-[var(--color-text-muted)]">
                    Actions on this trip will appear here as they happen.
                  </p>
                )}
              </div>
            ) : null}

            {!isLoading && entries.map((entry) => (
              <AuditEntryRow
                key={entry.id}
                entry={entry}
                selected={auditDetailEntryId === entry.id}
                onClick={() =>
                  setAuditDetailEntryId(auditDetailEntryId === entry.id ? null : entry.id)
                }
              />
            ))}

            {total > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 pt-2">
                <span className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Page {currentPage} of {totalPages} ({total} entries)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0 || isFetching}
                    aria-label="Previous page"
                  >
                    <ChevronLeft data-icon="inline-start" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={offset + PAGE_SIZE >= total || isFetching}
                    aria-label="Next page"
                  >
                    Next
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {selectedEntry && (
        <AuditDetailDrawer
          entry={selectedEntry}
          onClose={() => setAuditDetailEntryId(null)}
        />
      )}
    </WorkspacePage>
  )
}

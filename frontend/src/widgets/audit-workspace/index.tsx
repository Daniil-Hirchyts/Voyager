import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Filter, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAuditLog } from '@/entities/audit/queries'
import { useExportsStore } from '@/shared/stores/exports.store'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
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
        'w-full flex items-start gap-3 px-4 py-3 rounded-[10px] border text-left transition-colors',
        selected
          ? 'border-[#2F6F73] bg-[#2F6F73]/5'
          : 'border-[var(--color-border)] hover:border-[#2F6F73]/40 hover:bg-[#F4EBDD]',
      )}
      style={{ background: selected ? undefined : 'var(--color-surface)' }}
      aria-pressed={selected}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="entity">{entry.entity_type}</Badge>
          <Badge variant="action">{entry.action}</Badge>
          {entry.entity_id && (
            <span className="text-xs text-[#526072] font-mono truncate max-w-[120px]">{entry.entity_id}</span>
          )}
        </div>
        {entry.request_path && (
          <p className="text-xs text-[#526072] truncate font-mono">{entry.request_path}</p>
        )}
      </div>
      <div className="text-right text-xs text-[#526072] shrink-0">
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
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-xl h-full flex flex-col overflow-hidden shadow-xl outline-none"
        style={{ background: 'var(--color-surface)' }}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
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
          {/* Metadata */}
          <section>
            <h3 className="text-xs font-semibold text-[#526072] uppercase tracking-wide mb-2">Metadata</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-[#526072]">ID</dt>
              <dd className="font-mono text-[#1D2430] text-xs truncate">{entry.id}</dd>
              {entry.entity_id && (
                <>
                  <dt className="text-[#526072]">Entity ID</dt>
                  <dd className="font-mono text-[#1D2430] text-xs truncate">{entry.entity_id}</dd>
                </>
              )}
              {entry.user_id && (
                <>
                  <dt className="text-[#526072]">User ID</dt>
                  <dd className="font-mono text-[#1D2430] text-xs truncate">{entry.user_id}</dd>
                </>
              )}
              {entry.correlation_id && (
                <>
                  <dt className="text-[#526072]">Correlation ID</dt>
                  <dd className="font-mono text-[#1D2430] text-xs truncate">{entry.correlation_id}</dd>
                </>
              )}
              {entry.request_path && (
                <>
                  <dt className="text-[#526072]">Request path</dt>
                  <dd className="font-mono text-[#1D2430] text-xs truncate">{entry.request_path}</dd>
                </>
              )}
              <dt className="text-[#526072]">Timestamp</dt>
              <dd className="text-[#1D2430] text-xs">{date.toLocaleString()}</dd>
            </dl>
          </section>

          {/* Before */}
          {entry.before && (
            <section>
              <h3 className="text-xs font-semibold text-[#526072] uppercase tracking-wide mb-2">Before</h3>
              <pre
                className="text-xs font-mono bg-[#F4EBDD] rounded-[8px] p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all"
                style={{ color: 'var(--color-text)' }}
              >
                {JSON.stringify(entry.before, null, 2)}
              </pre>
            </section>
          )}

          {/* After */}
          {entry.after && (
            <section>
              <h3 className="text-xs font-semibold text-[#526072] uppercase tracking-wide mb-2">After</h3>
              <pre
                className="text-xs font-mono bg-[#F4EBDD] rounded-[8px] p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all"
                style={{ color: 'var(--color-text)' }}
              >
                {JSON.stringify(entry.after, null, 2)}
              </pre>
            </section>
          )}

          {!entry.before && !entry.after && (
            <p className="text-xs text-[#526072]">No before/after snapshot available for this entry.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-[10px] border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <h1 className="font-display text-xl text-[#1D2430]">Audit Log</h1>
        <p className="text-sm text-[#526072] mt-0.5">
          Append-only record of all changes made to this trip.
        </p>
      </div>

      {/* Filter bar */}
      <div
        className="px-6 py-3 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#526072]" htmlFor="audit-entity-type">
              Entity type
            </label>
            <Input
              id="audit-entity-type"
              value={draft.entity_type ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, entity_type: e.target.value || undefined }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="e.g. activity"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#526072]" htmlFor="audit-action">
              Action
            </label>
            <Input
              id="audit-action"
              value={draft.action ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value || undefined }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="e.g. create"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#526072]" htmlFor="audit-from">
              From
            </label>
            <Input
              id="audit-from"
              type="date"
              value={draft.from ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#526072]" htmlFor="audit-to">
              To
            </label>
            <Input
              id="audit-to"
              type="date"
              value={draft.to ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
              className="h-8 text-sm"
            />
          </div>
          <Button size="sm" onClick={applyFilters} className="h-8">
            <Filter className="w-3.5 h-3.5" />
            Apply
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>
        {filterError && (
          <p className="text-xs text-red-600 mt-1.5">{filterError}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-2">
        {isLoading && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </>
        )}

        {isError && (
          <Alert variant="destructive">
            <p className="text-sm">
              {error instanceof Error ? error.message : 'Failed to load audit log.'}
            </p>
          </Alert>
        )}

        {!isLoading && !isError && entries.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-[#526072]">No audit entries found</p>
            {hasActiveFilters ? (
              <p className="text-xs text-[#526072]/70 max-w-xs">
                Try adjusting or clearing your filters to see more entries.
              </p>
            ) : (
              <p className="text-xs text-[#526072]/70 max-w-xs">
                Actions on this trip will appear here as they happen.
              </p>
            )}
          </div>
        )}

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

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-[#526072]">
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
                <ChevronLeft className="w-3.5 h-3.5" />
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
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedEntry && (
        <AuditDetailDrawer
          entry={selectedEntry}
          onClose={() => setAuditDetailEntryId(null)}
        />
      )}
    </div>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileJson,
  FileText,
  Calendar,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTrip, tripKeys } from '@/entities/trip/queries'
import { useJob } from '@/entities/job/queries'
import { useSubmitExport, useExport } from '@/entities/export/queries'
import { downloadExportContent } from '@/entities/export/api'
import { isConflict, isRateLimit } from '@/shared/api/client'
import { isJobRunning, isJobSuccessful } from '@/shared/lib/jobs'
import { useExportsStore } from '@/shared/stores/exports.store'
import { cn } from '@/shared/lib/cn'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useAppShellHeaderActions, useAppShellHeaderMeta } from '@/widgets/app-shell'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ExportFormat } from '@/shared/api/types'

const FORMAT_META: Record<ExportFormat, { label: string; description: string; icon: LucideIcon }> = {
  json: {
    label: 'JSON',
    description: 'Machine-readable snapshot of the full trip',
    icon: FileJson,
  },
  ics: {
    label: 'Calendar (ICS)',
    description: 'Import into Google Calendar, Outlook, or Apple Calendar',
    icon: Calendar,
  },
  pdf: {
    label: 'PDF',
    description: 'Printable itinerary document',
    icon: FileText,
  },
}

const STATUS_BADGE_CLASS_NAME = 'rounded-full px-2 py-0.5 text-[0.72rem] font-medium normal-case tracking-normal'

function formatSize(sizeBytes: number | null | undefined) {
  if (!sizeBytes) return null
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function ExportStatusRow({ jobId }: { jobId: string }) {
  const { data: job } = useJob(jobId)
  const exportId = job?.result && typeof job.result === 'object' && 'export_id' in job.result
    ? (job.result as { export_id?: string }).export_id ?? null
    : null
  const { data: exportRecord } = useExport(exportId)

  const isRunning = isJobRunning(job?.status)
  const isSuccess = isJobSuccessful(job?.status)
  const isFailed = job?.status === 'FAILED'

  const handleDownload = async () => {
    if (!exportId) return
    if (exportRecord?.download_url) {
      window.open(exportRecord.download_url, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      const res = await downloadExportContent(exportId)
      if (!res.ok) {
        toast.error('Download unavailable', { description: 'The export file could not be retrieved.' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = exportRecord?.format ?? 'export'
      a.download = `trip-export.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed', { description: 'Could not retrieve the export file.' })
    }
  }

  const sizeLabel = formatSize(exportRecord?.size_bytes)

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-black/8 bg-white px-3.5 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {exportRecord
              ? FORMAT_META[exportRecord.format]?.label ?? exportRecord.format.toUpperCase()
              : '—'}
          </span>
          {exportRecord?.trip_version != null && (
            <span className="text-xs text-[var(--color-text-muted)]">v{exportRecord.trip_version}</span>
          )}
          {sizeLabel && (
            <span className="text-xs text-[var(--color-text-muted)]">{sizeLabel}</span>
          )}
        </div>
        {isRunning ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">Generating…</p> : null}
        {isFailed && (
          <p className="mt-1 text-xs text-[var(--color-danger)]">
            {job?.error && typeof job.error === 'object' && 'message' in job.error
              ? String(job.error.message)
              : 'Export failed'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isRunning && (
          <Badge
            variant="warning"
            aria-live="polite"
            className={cn(STATUS_BADGE_CLASS_NAME, 'flex items-center gap-1 border-0')}
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating
          </Badge>
        )}
        {isSuccess && (
          <Badge variant="success" className={cn(STATUS_BADGE_CLASS_NAME, 'flex items-center gap-1 border-0')}>
            <CheckCircle2 className="w-3 h-3" />
            Ready
          </Badge>
        )}
        {isFailed && (
          <Badge variant="danger" className={cn(STATUS_BADGE_CLASS_NAME, 'flex items-center gap-1 border-0')}>
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        )}
        {!job && (
          <Badge variant="neutral" className={cn(STATUS_BADGE_CLASS_NAME, 'flex items-center gap-1')}>
            <Clock className="w-3 h-3" />
            Pending
          </Badge>
        )}

        {isSuccess && exportId ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
            onClick={handleDownload}
            aria-label="Download export"
          >
            <Download data-icon="inline-start" />
            Download
          </Button>
        ) : null}
      </div>
    </div>
  )
}

interface Props {
  tripId: string
}

export default function ExportsWorkspace({ tripId }: Props) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json')
  const [conflictBanner, setConflictBanner] = useState(false)
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null)

  const { data: trip } = useTrip(tripId)
  const qc = useQueryClient()
  const { mutateAsync: submitExport, isPending } = useSubmitExport(tripId)
  const { pendingExports, addPendingExport } = useExportsStore()

  const isRateLimited = rateLimitedUntil != null && Date.now() < rateLimitedUntil

  const handleSubmit = useCallback(async () => {
    if (!trip) return
    if (isRateLimited) return

    const idempotencyKey = `export-${tripId}-${selectedFormat}-${Date.now()}`

    try {
      const accepted = await submitExport({
        format: selectedFormat,
        tripVersion: trip.version,
        idempotencyKey,
      })
      addPendingExport({
        jobId: accepted.job_id,
        format: selectedFormat,
        submittedAt: new Date().toISOString(),
      })
      setConflictBanner(false)
      toast.success('Export submitted', { description: `Generating ${FORMAT_META[selectedFormat].label} export…` })
    } catch (err) {
      if (isConflict(err)) {
        setConflictBanner(true)
        await qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
        toast.error('Version conflict', { description: 'Trip has been updated. Please retry.' })
      } else if (isRateLimit(err)) {
        setRateLimitedUntil(Date.now() + 30_000)
        toast.error('Too many requests', { description: 'Export requests are being paced. Please wait 30 seconds.' })
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error'
        toast.error('Export failed', { description: message })
      }
    }
  }, [addPendingExport, isRateLimited, qc, selectedFormat, submitExport, trip, tripId])

  const sessionExports = pendingExports
  const headerMeta = useMemo(
    () => (trip ? <span>{`Trip version ${trip.version}`}</span> : null),
    [trip],
  )
  const headerActions = useMemo(
    () => (
      <Button
        onClick={handleSubmit}
        disabled={isPending || isRateLimited || !trip}
        className="h-8 rounded-[8px] px-3.5 text-[0.84rem] font-medium shadow-none hover:shadow-none"
      >
        {isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
        Export {FORMAT_META[selectedFormat].label}
      </Button>
    ),
    [handleSubmit, isPending, isRateLimited, selectedFormat, trip],
  )
  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)
  const hasShellHeaderMeta = useAppShellHeaderMeta(headerMeta)
  const showInlineMeta = !hasShellHeaderMeta && headerMeta != null
  const showInlineActions = !hasShellHeaderActions

  return (
    <WorkspacePage className="gap-4">
      {showInlineMeta || showInlineActions ? (
        <section className="rounded-[12px] border border-black/8 bg-white px-4 py-3">
          {showInlineMeta ? (
            <p className="text-sm text-[var(--color-text-muted)]">{headerMeta}</p>
          ) : null}
          {showInlineActions ? (
            <div className={cn('flex flex-wrap gap-2', showInlineMeta && 'mt-3 border-t border-black/8 pt-3')}>
              {headerActions}
            </div>
          ) : null}
        </section>
      ) : null}

      {conflictBanner ? (
        <Alert variant="warning" className="rounded-[12px] p-3.5 shadow-none">
          <AlertCircle className="w-4 h-4" />
          <div>
            <AlertTitle>Version conflict</AlertTitle>
            <AlertDescription>
              Your local trip view is behind the server version. The page has been refreshed. Review the latest changes and retry the export.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {isRateLimited ? (
        <Alert variant="destructive" className="rounded-[12px] p-3.5 shadow-none">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            Export requests are being paced. Please wait before retrying.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
        <div className="mb-4">
          <h2 className="text-base font-medium text-[var(--color-text)]">Format</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Choose the snapshot output for the current trip version.
          </p>
        </div>

        <ToggleGroup
          type="single"
          value={selectedFormat}
          onValueChange={(value) => {
            if (value) {
              setSelectedFormat(value as ExportFormat)
            }
          }}
          variant="outline"
          aria-label="Export format"
          className="grid gap-3 sm:grid-cols-3"
        >
          {(Object.keys(FORMAT_META) as ExportFormat[]).map((fmt) => {
            const meta = FORMAT_META[fmt]
            const Icon = meta.icon
            return (
              <ToggleGroupItem
                key={fmt}
                value={fmt}
                aria-label={`${meta.label} format`}
                className={cn(
                  'h-auto min-h-[5.5rem] items-start justify-start rounded-[10px] px-4 py-3 text-left shadow-none',
                  'data-[state=on]:border-black/14 data-[state=on]:bg-white',
                )}
              >
                <div className="flex w-full flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-[var(--color-text-muted)]" />
                    <span className="text-sm font-medium text-[var(--color-text)]">{meta.label}</span>
                  </div>
                  <span className="text-xs leading-5 text-[var(--color-text-muted)]">{meta.description}</span>
                </div>
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </section>

      <section className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-[var(--color-text)]">This session</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Track export jobs requested in this browser session.
            </p>
          </div>
          <Badge variant="neutral" className="rounded-full border-black/8 bg-white px-2.5 py-1 text-[0.72rem] font-medium normal-case tracking-normal text-[var(--color-text-muted)]">
            {sessionExports.length} queued
          </Badge>
        </div>

        <div className="flex flex-col gap-3">
          {sessionExports.length > 0 ? (
            sessionExports.map((entry) => <ExportStatusRow key={entry.jobId} jobId={entry.jobId} />)
          ) : (
            <Empty className="bg-white py-10">
              <EmptyMedia variant="icon">
                <Download className="size-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No exports yet</EmptyTitle>
                <EmptyDescription>
                  Choose a format above and submit an export to start a session queue.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </section>
    </WorkspacePage>
  )
}

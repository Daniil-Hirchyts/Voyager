import { useState } from 'react'
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
import { WorkspaceHeader, WorkspacePage, WorkspaceStatCard, WorkspaceStatGrid } from '@/shared/layouts/workspace-shell'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

  const sizeLabel = exportRecord?.size_bytes
    ? exportRecord.size_bytes < 1024
      ? `${exportRecord.size_bytes} B`
      : exportRecord.size_bytes < 1024 * 1024
        ? `${(exportRecord.size_bytes / 1024).toFixed(1)} KB`
        : `${(exportRecord.size_bytes / (1024 * 1024)).toFixed(1)} MB`
    : null

  return (
    <div
      className="flex items-center gap-3 rounded-[20px] border border-[var(--color-border-strong)] bg-white/72 px-4 py-3"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
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
        {isRunning && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Generating…</p>
        )}
        {isFailed && (
          <p className="mt-0.5 text-xs text-[var(--color-danger)]">
            {job?.error && typeof job.error === 'object' && 'message' in job.error
              ? String(job.error.message)
              : 'Export failed'}
          </p>
        )}
        {isSuccess && exportRecord && !exportRecord.download_url && !exportId && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">File unavailable</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isRunning && (
          <Badge variant="warning" aria-live="polite" className="flex items-center gap-1 border-0">
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating
          </Badge>
        )}
        {isSuccess && (
          <Badge variant="success" className="flex items-center gap-1 border-0">
            <CheckCircle2 className="w-3 h-3" />
            Ready
          </Badge>
        )}
        {isFailed && (
          <Badge variant="danger" className="flex items-center gap-1 border-0">
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        )}
        {!job && (
          <Badge variant="neutral" className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Pending
          </Badge>
        )}
      </div>

      {isSuccess && exportId && (
        <Button
          size="sm"
          onClick={handleDownload}
          aria-label="Download export"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </Button>
      )}
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

  const handleSubmit = async () => {
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
  }

  const sessionExports = pendingExports

  return (
    <WorkspacePage className="gap-6">
      <WorkspaceHeader
        eyebrow="Exports"
        title="Create deterministic trip snapshots."
        description="Freeze the current trip version into a shareable file format without leaving the workspace."
        actions={(
          <Button onClick={handleSubmit} disabled={isPending || isRateLimited || !trip}>
            {isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            Export {FORMAT_META[selectedFormat].label}
          </Button>
        )}
        meta={trip ? <span className="voyager-pill">Trip version {trip.version}</span> : undefined}
      />

      <WorkspaceStatGrid className="md:grid-cols-3">
        <WorkspaceStatCard label="Format" value={FORMAT_META[selectedFormat].label} detail={FORMAT_META[selectedFormat].description} icon={FORMAT_META[selectedFormat].icon} />
        <WorkspaceStatCard label="Session queue" value={sessionExports.length} detail="Exports requested in this browser session" icon={Download} />
        <WorkspaceStatCard label="Behavior" value="Read only" detail="Exports capture the current trip state and cannot be undone" icon={FileText} />
      </WorkspaceStatGrid>

      {conflictBanner ? (
        <Alert variant="warning">
          <AlertCircle className="w-5 h-5" />
          <div>
            <AlertTitle>Version conflict</AlertTitle>
            <AlertDescription>
              Your local trip view is behind the server version. The page has been refreshed. Review the latest changes and retry the export.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {isRateLimited ? (
        <Alert variant="destructive">
          <AlertCircle className="w-5 h-5" />
          <AlertDescription>
            Export requests are being paced. Please wait before retrying.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card variant="solid">
        <CardHeader className="gap-3">
          <Badge variant="neutral" className="w-fit">Choose format</Badge>
          <CardTitle>Select the snapshot output</CardTitle>
          <CardDescription>
            Use JSON for machine-readable state, ICS for calendar import, or PDF for a printable itinerary handoff.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(Object.keys(FORMAT_META) as ExportFormat[]).map((fmt) => {
              const meta = FORMAT_META[fmt]
              const Icon = meta.icon
              return (
                <button
                  key={fmt}
                  onClick={() => setSelectedFormat(fmt)}
                  className={cn(
                    'flex flex-col items-start gap-2 rounded-[20px] border px-4 py-4 text-left transition-colors',
                    selectedFormat === fmt
                      ? 'border-[var(--color-primary)] bg-[rgba(114,174,230,0.12)]'
                      : 'border-[var(--color-border-strong)] bg-white/70 hover:border-[rgba(114,174,230,0.4)] hover:bg-white/88',
                  )}
                  aria-pressed={selectedFormat === fmt}
                >
                  <Icon className={cn('w-5 h-5', selectedFormat === fmt ? 'text-[var(--color-primary-foreground)]' : 'text-[var(--color-text-muted)]')} />
                  <span className={cn('text-sm font-medium', selectedFormat === fmt ? 'text-[var(--color-primary-foreground)]' : 'text-[var(--color-text)]')}>
                    {meta.label}
                  </span>
                  <span className="text-xs leading-5 text-[var(--color-text-muted)]">{meta.description}</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
            Exports are deterministic snapshots tied to the current trip version.
          </p>
        </CardContent>
      </Card>

      <Card variant="solid">
        <CardHeader className="gap-3">
          <Badge variant="accent" className="w-fit">Recent exports</Badge>
          <CardTitle>Track export jobs in this session</CardTitle>
          <CardDescription>
            Completed exports are ready for download as soon as the background job resolves.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sessionExports.length > 0 ? (
            sessionExports.map((entry) => <ExportStatusRow key={entry.jobId} jobId={entry.jobId} />)
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-[24px] border border-dashed border-[var(--color-border-strong)] bg-white/58 py-10 text-center">
              <Download className="w-8 h-8 text-[var(--color-text-muted)]/50" />
              <p className="text-sm font-medium text-[var(--color-text)]">No exports yet</p>
              <p className="max-w-xs text-xs leading-5 text-[var(--color-text-muted)]">
                Choose a format above and submit an export. Each export is a deterministic snapshot tied to the current trip version.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </WorkspacePage>
  )
}

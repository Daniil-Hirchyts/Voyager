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
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import type { ExportFormat } from '@/shared/api/types'

const FORMAT_META: Record<ExportFormat, { label: string; description: string; icon: React.FC<{ className?: string }> }> = {
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
      className="flex items-center gap-3 px-4 py-3 rounded-[10px] border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-[#1D2430]">
            {exportRecord
              ? FORMAT_META[exportRecord.format]?.label ?? exportRecord.format.toUpperCase()
              : '—'}
          </span>
          {exportRecord?.trip_version != null && (
            <span className="text-xs text-[#526072]">v{exportRecord.trip_version}</span>
          )}
          {sizeLabel && (
            <span className="text-xs text-[#526072]">{sizeLabel}</span>
          )}
        </div>
        {isRunning && (
          <p className="text-xs text-[#526072] mt-0.5">Generating…</p>
        )}
        {isFailed && (
          <p className="text-xs text-red-600 mt-0.5">
            {job?.error && typeof job.error === 'object' && 'message' in job.error
              ? String(job.error.message)
              : 'Export failed'}
          </p>
        )}
        {isSuccess && exportRecord && !exportRecord.download_url && !exportId && (
          <p className="text-xs text-[#526072] mt-0.5">File unavailable</p>
        )}
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isRunning && (
          <Badge aria-live="polite" className="flex items-center gap-1 bg-amber-50 text-amber-600 border-0">
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating
          </Badge>
        )}
        {isSuccess && (
          <Badge className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border-0">
            <CheckCircle2 className="w-3 h-3" />
            Ready
          </Badge>
        )}
        {isFailed && (
          <Badge className="flex items-center gap-1 bg-red-50 text-red-700 border-0">
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        )}
        {!job && (
          <Badge variant="secondary" className="flex items-center gap-1">
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <h1 className="font-display text-xl text-[#1D2430]">Exports</h1>
        <p className="text-sm text-[#526072] mt-0.5">
          Export a deterministic snapshot of your trip at its current version.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
        {/* Conflict banner */}
        {conflictBanner && (
          <Alert variant="warning">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <div>
              <AlertTitle>Version conflict</AlertTitle>
              <AlertDescription>
                Your local trip view is behind the server version. The page has been refreshed — please review and retry the export.
              </AlertDescription>
            </div>
          </Alert>
        )}

        {/* Rate-limit banner */}
        {isRateLimited && (
          <Alert variant="destructive">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">Export requests are being paced. Please wait before retrying.</p>
          </Alert>
        )}

        {/* Format chooser */}
        <section>
          <h2 className="text-sm font-semibold text-[#1D2430] mb-3">Choose format</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(Object.keys(FORMAT_META) as ExportFormat[]).map((fmt) => {
              const meta = FORMAT_META[fmt]
              const Icon = meta.icon
              return (
                <button
                  key={fmt}
                  onClick={() => setSelectedFormat(fmt)}
                  className={cn(
                    'flex flex-col items-start gap-2 p-4 rounded-[10px] border text-left transition-colors',
                    selectedFormat === fmt
                      ? 'border-[#2F6F73] bg-[#2F6F73]/5'
                      : 'border-[var(--color-border)] hover:border-[#2F6F73]/50 hover:bg-[#F4EBDD]',
                  )}
                  aria-pressed={selectedFormat === fmt}
                >
                  <Icon className={cn('w-5 h-5', selectedFormat === fmt ? 'text-[#2F6F73]' : 'text-[#526072]')} />
                  <span className={cn('text-sm font-medium', selectedFormat === fmt ? 'text-[#2F6F73]' : 'text-[#1D2430]')}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-[#526072]">{meta.description}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSubmit}
            disabled={isPending || isRateLimited || !trip}
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Export {FORMAT_META[selectedFormat].label}
          </Button>
          {trip && (
            <span className="text-xs text-[#526072]">
              Trip version {trip.version} will be captured
            </span>
          )}
        </div>

        {/* Undo not available notice */}
        <p className="text-xs text-[#526072]">
          Exports are read-only snapshots. Undo is not available for export operations.
        </p>

        {/* Recent exports */}
        {sessionExports.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#1D2430] mb-3">Recent exports</h2>
            <div className="space-y-2">
              {sessionExports.map((entry) => (
                <ExportStatusRow key={entry.jobId} jobId={entry.jobId} />
              ))}
            </div>
          </section>
        )}

        {sessionExports.length === 0 && (
          <section className="flex flex-col items-center gap-2 py-10 text-center">
            <Download className="w-8 h-8 text-[#526072]/50" />
            <p className="text-sm font-medium text-[#526072]">No exports yet</p>
            <p className="text-xs text-[#526072]/70 max-w-xs">
              Choose a format above and submit an export. Each export is a deterministic snapshot tied to the current trip version.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

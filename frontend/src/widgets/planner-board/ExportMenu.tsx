import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileJson, FileText, Calendar, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  downloadExportContent,
  downloadExportContentAtPath,
  getExport,
  submitExport,
} from '@/entities/export/api'
import { getJob } from '@/entities/job/api'
import { plannerKeys } from '@/entities/planner/queries'
import { isConflict, isRateLimit } from '@/shared/api/client'
import { isJobTerminal, isJobSuccessful } from '@/shared/lib/jobs'
import type { ExportFormat } from '@/shared/api/types'
import type { ReactNode } from 'react'
import { VoyagerLoader } from '@/widgets/app-shell/logo'

interface Props {
  tripId: string
  tripVersion: number
  asMenuItems?: boolean
  trigger?: ReactNode
}

const FORMAT_META: Record<ExportFormat, { label: string; icon: LucideIcon }> = {
  json: { label: 'JSON', icon: FileJson },
  ics: { label: 'Calendar (ICS)', icon: Calendar },
  pdf: { label: 'PDF', icon: FileText },
}

function inferFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  return match?.[1] || fallback
}

export function ExportMenu({ tripId, tripVersion, asMenuItems, trigger }: Props) {
  const [isExporting, setIsExporting] = useState(false)
  const qc = useQueryClient()

  const handleExport = async (format: ExportFormat) => {
    if (isExporting) return
    setIsExporting(true)
    const meta = FORMAT_META[format]

    const idempotencyKey = `export-${tripId}-${format}-${Date.now()}`

    toast.promise(
      async () => {
        // 1. Submit export
        const accepted = await submitExport(tripId, format, tripVersion, idempotencyKey)
        const jobId = accepted.job_id

        // 2. Poll job
        let jobResult: unknown = null
        while (true) {
          const job = await getJob(jobId)
          if (isJobTerminal(job.status)) {
            if (!isJobSuccessful(job.status)) {
              throw new Error(
                job.error && typeof job.error === 'object' && 'message' in job.error
                  ? String(job.error.message)
                  : 'Export failed'
              )
            }
            jobResult = job.result
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }

        // 3. Get export record and download
        const exportId = jobResult && typeof jobResult === 'object' && 'export_id' in jobResult
          ? (jobResult as { export_id?: string }).export_id ?? null
          : null

        if (!exportId) throw new Error('Missing export ID')

        const exportRecord = await getExport(exportId)

        const res = exportRecord?.download_url
          ? await downloadExportContentAtPath(exportRecord.download_url)
          : await downloadExportContent(exportId)
        if (!res.ok) {
          throw new Error('Download unavailable')
        }

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ext = exportRecord?.format ?? 'export'
        a.download = inferFilename(res, `trip-export.${ext}`)
        a.click()
        URL.revokeObjectURL(url)
      },
      {
        loading: `Generating ${meta.label} export...`,
        success: `${meta.label} export downloaded`,
        error: (err) => {
          if (isConflict(err)) {
            qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
            return 'Version conflict. Trip has been updated. Please retry.'
          }
          if (isRateLimit(err)) return 'Too many requests. Please wait 30 seconds.'
          return err instanceof Error ? err.message : 'Export failed'
        },
        finally: () => setIsExporting(false)
      }
    )
  }

  const items = (Object.keys(FORMAT_META) as ExportFormat[]).map((fmt) => {
    const meta = FORMAT_META[fmt]
    const Icon = meta.icon
    return (
      <DropdownMenuItem key={fmt} onClick={() => handleExport(fmt)} disabled={isExporting}>
        <Icon className="mr-2 h-4 w-4" />
        <span>{meta.label}</span>
      </DropdownMenuItem>
    )
  })

  if (asMenuItems) {
    return <>{items}</>
  }

  if (trigger) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting} className="rounded-full shadow-none gap-2">
          {isExporting ? <VoyagerLoader className="w-4 h-4 " /> : <Download className="w-4 h-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

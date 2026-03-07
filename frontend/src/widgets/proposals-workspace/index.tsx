import { useState, useEffect } from 'react'
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useTrip, tripKeys } from '@/entities/trip/queries'
import { useDays } from '@/entities/day/queries'
import { useJob } from '@/entities/job/queries'
import { useOptimizeTrip, useProposals, useApplyProposal, proposalKeys } from '@/entities/proposal/queries'
import { isConflict, isRateLimit } from '@/shared/api/client'
import { isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { useProposalsStore } from '@/shared/stores/proposals.store'
import { formatMoney } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ProposalActivityResponse, ProposalResponse } from '@/shared/api/types'

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; Icon: React.FC<{ className?: string }> }> = {
    PENDING: { label: 'Pending', variant: 'secondary', Icon: Clock },
    RUNNING: { label: 'Generating', variant: 'secondary', Icon: Loader2 },
    SUCCEEDED: { label: 'Ready', variant: 'default', Icon: CheckCircle2 },
    APPLIED: { label: 'Applied', variant: 'outline', Icon: CheckCircle2 },
    FAILED: { label: 'Failed', variant: 'destructive', Icon: XCircle },
    STALE: { label: 'Stale', variant: 'secondary', Icon: AlertCircle },
  }
  const meta = map[status.toUpperCase()] ?? { label: status, variant: 'secondary' as const, Icon: Clock }
  const { Icon, label, variant } = meta
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className={cn('w-3 h-3', status === 'RUNNING' && 'animate-spin')} />
      {label}
    </Badge>
  )
}

function ActivityRow({ activity }: { activity: ProposalActivityResponse }) {
  const costLabel = activity.estimated_cost_amount
    ? formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)
    : null

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="w-6 h-6 flex items-center justify-center rounded-full bg-[#2F6F73]/10 text-[#2F6F73] text-xs font-bold shrink-0 mt-0.5">
        {activity.order_index + 1}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-[#1D2430]">{activity.title}</p>
        {activity.description && (
          <p className="text-xs text-[#526072] line-clamp-2">{activity.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap text-xs text-[#526072]">
          {activity.start_time && <span>{activity.start_time}</span>}
          {activity.duration_min && <span>{activity.duration_min} min</span>}
          {costLabel && <span>{costLabel}</span>}
          {activity.event_snapshot_id && (
            <Badge variant="action" className="text-[10px]">Event</Badge>
          )}
        </div>
      </div>
    </div>
  )
}

function ProposalDetailDrawer({
  proposal,
  tripVersion,
  tripId,
  onClose,
}: {
  proposal: ProposalResponse
  tripVersion: number
  tripId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { mutateAsync: apply, isPending: applying } = useApplyProposal(tripId)
  const [conflictBanner, setConflictBanner] = useState(false)

  const handleApply = async () => {
    const idempotencyKey = `apply-proposal-${proposal.id}-${Date.now()}`
    try {
      await apply({ proposalId: proposal.id, tripVersion, idempotencyKey })
      toast.success('Proposal applied', { description: 'Your planner has been updated.' })
      onClose()
    } catch (err) {
      if (isConflict(err)) {
        setConflictBanner(true)
        await qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
        await qc.invalidateQueries({ queryKey: proposalKeys.detail(proposal.id) })
        toast.error('Version conflict', { description: 'Trip has been updated. Please review and retry.' })
      } else {
        toast.error('Apply failed', { description: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
  }

  const isApplyable = proposal.status === 'SUCCEEDED' || proposal.status === 'succeeded'
  const isAlreadyApplied = proposal.status === 'APPLIED' || proposal.status === 'applied'

  // Group activities by day
  const byDay = proposal.items.reduce<Record<string, ProposalActivityResponse[]>>((acc, item) => {
    if (!acc[item.trip_day_id]) acc[item.trip_day_id] = []
    acc[item.trip_day_id].push(item)
    return acc
  }, {})
  const sortedDayIds = Object.keys(byDay)

  const score = proposal.score as { total?: number; breakdown?: Record<string, number> } | null
  const summary = proposal.summary as { activities_changed?: number; days_affected?: number } | null

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 flex flex-col" aria-label="Proposal review">
        <SheetHeader className="px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <SheetTitle>Proposal Review</SheetTitle>
            {statusBadge(proposal.status)}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-5 py-4 space-y-5">
            {/* Conflict banner */}
            {conflictBanner && (
              <Alert variant="warning">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <span className="font-medium">Version conflict</span> — The trip was updated since this proposal was created. Review the changes and retry.
                </AlertDescription>
              </Alert>
            )}

            {/* Meta */}
            <section>
              <h3 className="text-xs font-semibold text-[#526072] uppercase tracking-wide mb-2">Summary</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-[#526072]">Objective</dt>
                <dd className="text-[#1D2430]">{proposal.objective}</dd>
                <dt className="text-[#526072]">Based on version</dt>
                <dd className="text-[#1D2430]">v{proposal.based_on_trip_version}</dd>
                {summary?.activities_changed != null && (
                  <>
                    <dt className="text-[#526072]">Activities changed</dt>
                    <dd className="text-[#1D2430]">{summary.activities_changed}</dd>
                  </>
                )}
                {summary?.days_affected != null && (
                  <>
                    <dt className="text-[#526072]">Days affected</dt>
                    <dd className="text-[#1D2430]">{summary.days_affected}</dd>
                  </>
                )}
                {score?.total != null && (
                  <>
                    <dt className="text-[#526072]">Score</dt>
                    <dd className="text-[#1D2430]">{(score.total as number).toFixed(2)}</dd>
                  </>
                )}
              </dl>
            </section>

            {/* Proposed activities per day */}
            {sortedDayIds.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-[#526072] uppercase tracking-wide mb-3">Proposed activities</h3>
                <div className="space-y-4">
                  {sortedDayIds.map((dayId) => (
                    <div key={dayId} className="rounded-[10px] border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="px-3 py-2 bg-[#F4EBDD]">
                        <p className="text-xs font-semibold text-[#526072] uppercase tracking-wide">Day — {dayId.slice(0, 8)}</p>
                      </div>
                      <div className="px-3">
                        {byDay[dayId]
                          .sort((a, b) => a.order_index - b.order_index)
                          .map((act) => (
                            <ActivityRow key={act.id} activity={act} />
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Apply notice */}
            {isApplyable && (
              <p className="text-xs text-[#526072] italic">
                Applying this proposal will replace the current planner activities for the scoped days. This action cannot be undone.
              </p>
            )}
            {isAlreadyApplied && (
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>This proposal has already been applied.</AlertDescription>
              </Alert>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        {isApplyable && !isAlreadyApplied && (
          <div className="px-5 py-4 border-t shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3 justify-end">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleApply} disabled={applying}>
                {applying && <Loader2 className="w-4 h-4 animate-spin" />}
                Apply proposal
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

interface Props {
  tripId: string
}

export default function ProposalsWorkspace({ tripId }: Props) {
  const { data: trip } = useTrip(tripId)
  const { data: daysData } = useDays(tripId)
  const days = daysData?.items ?? []

  const { data: proposalsData, isLoading } = useProposals(tripId)
  const proposals = proposalsData?.items ?? []

  const { mutateAsync: submitOptimize, isPending: submitting } = useOptimizeTrip(tripId)
  const { selectedProposalId, setSelectedProposalId, optimizeJobId, setOptimizeJobId } = useProposalsStore()

  const { data: optimizeJob } = useJob(optimizeJobId)
  const optimizeRunning = isJobRunning(optimizeJob?.status)
  const optimizeSucceeded = isJobSuccessful(optimizeJob?.status)
  const optimizeFailed = optimizeJob?.status === 'FAILED'

  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null)
  const isRateLimited = rateLimitedUntil != null && Date.now() < rateLimitedUntil

  const selectedProposal = proposals.find((p) => p.id === selectedProposalId) ?? null

  // Auto-clear optimize job when terminal
  useEffect(() => {
    if (isJobTerminal(optimizeJob?.status) && optimizeJobId) {
      setOptimizeJobId(null)
    }
  }, [optimizeJob?.status, optimizeJobId, setOptimizeJobId])

  const handleOptimize = async () => {
    if (!trip || isRateLimited) return
    const idempotencyKey = `optimize-${tripId}-${Date.now()}`
    try {
      const accepted = await submitOptimize({
        data: {
          objective: 'balanced_flow',
          include_event_candidates: true,
          max_event_candidates_per_day: 2,
        },
        idempotencyKey,
      })
      setOptimizeJobId(accepted.job_id)
      toast.success('Optimization started', { description: 'A new proposal is being generated…' })
    } catch (err) {
      if (isRateLimit(err)) {
        setRateLimitedUntil(Date.now() + 30_000)
        toast.error('Too many requests', { description: 'Please wait before optimizing again.' })
      } else {
        toast.error('Optimization failed', { description: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h1 className="font-display text-xl text-[#1D2430]">Proposals</h1>
        <p className="text-sm text-[#526072] mt-0.5">
          Optimizer creates a reviewable plan without changing your trip until you explicitly apply it.
        </p>
      </div>

      {/* Optimize action bar */}
      <div className="px-6 py-4 border-b space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {isRateLimited && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>Optimization requests are being paced. Please wait before retrying.</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={handleOptimize}
            disabled={submitting || optimizeRunning || isRateLimited || !trip}
          >
            {(submitting || optimizeRunning) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Optimize trip
          </Button>
          {optimizeRunning && (
            <span aria-live="polite" className="text-xs text-[#526072]">Generating proposal…</span>
          )}
          {optimizeSucceeded && (
            <span className="flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Proposal ready — see list below
            </span>
          )}
          {optimizeFailed && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              Optimization failed. Existing data unchanged.
            </span>
          )}
          {trip && (
            <span className="text-xs text-[#526072]">
              {days.length} days · v{trip.version}
            </span>
          )}
        </div>
      </div>

      {/* Proposal list */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-2">
        {isLoading && (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 rounded-[10px] border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </>
        )}

        {!isLoading && proposals.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Sparkles className="w-8 h-8 text-[#526072]/40" />
            <p className="text-sm font-medium text-[#526072]">No proposals yet</p>
            <p className="text-xs text-[#526072]/70 max-w-xs">
              Click "Optimize trip" to generate a reviewable plan. Proposals never change your planner until you explicitly apply them.
            </p>
          </div>
        )}

        {proposals.map((proposal) => {
          const date = new Date(proposal.created_at)
          const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          const score = proposal.score as { total?: number } | null

          return (
            <button
              key={proposal.id}
              onClick={() => setSelectedProposalId(selectedProposalId === proposal.id ? null : proposal.id)}
              className={cn(
                'w-full flex items-center gap-3 p-4 rounded-[10px] border text-left transition-colors',
                selectedProposalId === proposal.id
                  ? 'border-[#2F6F73] bg-[#2F6F73]/5'
                  : 'border-[var(--color-border)] hover:border-[#2F6F73]/40 hover:bg-[#F4EBDD]',
              )}
              style={{ background: selectedProposalId === proposal.id ? undefined : 'var(--color-surface)' }}
              aria-pressed={selectedProposalId === proposal.id}
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusBadge(proposal.status)}
                  <span className="text-xs text-[#526072]">{dateLabel}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-[#526072]">
                  <span>{proposal.items.length} activities</span>
                  <span>v{proposal.based_on_trip_version}</span>
                  {score?.total != null && <span>Score {(score.total as number).toFixed(1)}</span>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#526072] shrink-0" />
            </button>
          )
        })}
      </div>

      {/* Detail drawer */}
      {selectedProposal && trip && (
        <ProposalDetailDrawer
          proposal={selectedProposal}
          tripVersion={trip.version}
          tripId={tripId}
          onClose={() => setSelectedProposalId(null)}
        />
      )}
    </div>
  )
}

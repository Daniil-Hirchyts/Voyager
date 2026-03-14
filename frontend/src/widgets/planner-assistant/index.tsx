import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  useMessage,
} from '@assistant-ui/react'
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bot,
  Check,
  ChevronRight,
  Clock3,
  LayoutList,
  Loader2,
  MapPin,
  Search,
  Send,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { mirrorAssistantJob, streamAssistantMessages } from '@/entities/assistant/api'
import {
  appendAssistantJobProgressEvent,
  upsertAssistantMessages,
} from '@/entities/assistant/cache'
import { assistantKeys, useAssistantThread } from '@/entities/assistant/queries'
import { streamJobProgress } from '@/entities/job/api'
import { plannerKeys } from '@/entities/planner/queries'
import { isApiError } from '@/shared/api/client'
import type {
  AssistantCommandInput,
  AssistantDataPart,
  AssistantMessage,
  AssistantMessagePart,
  AssistantMessageStreamInput,
  AssistantToolCallPart,
  AssistantTextPart,
  JobProgressEvent,
} from '@/shared/api/types'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/lib/cn'
import { usePlannerStore } from '@/shared/stores/planner.store'
import {
  PLANNER_ASSISTANT_COMMANDS,
  formatPlannerAssistantCommandText,
  getPlannerAssistantCommandSuggestions,
  parsePlannerAssistantCommand,
  type PlannerAssistantCommandDefinition,
  type PlannerAssistantDialogCommand,
  type PlannerAssistantDirectCommand,
} from './commands'

type PlannerAssistantContextValue = {
  confirmToolCall: (messageId: string, toolCallId: string, confirmed: boolean) => Promise<void>
}

type PlannerAssistantPanelProps = {
  tripId: string
  destination: string
  hasActivities: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onRequestGenerationDialog: (action: PlannerAssistantDialogCommand) => void
}

type JobTimelineRow =
  | {
      kind: 'step'
      phase: string | null
      eventId: string
      name: string
      detail: string
    }
  | {
      kind: 'tool'
      phase: string | null
      eventId: string
      toolName: string
      callId: string | null
      args: Record<string, unknown>
      result?: Record<string, unknown>
      isError?: boolean
    }
  | {
      kind: 'done'
      phase: string | null
      eventId: string
      status: string
      summary?: Record<string, unknown>
    }

type LauncherPosition = {
  x: number
  y: number
}

const PlannerAssistantContext = createContext<PlannerAssistantContextValue | null>(null)

const LAUNCHER_MARGIN_DESKTOP = 24
const LAUNCHER_MARGIN_MOBILE = 16
const LAUNCHER_WIDTH_DESKTOP = 56
const LAUNCHER_HEIGHT_DESKTOP = 56
const LAUNCHER_WIDTH_MOBILE = 56
const LAUNCHER_HEIGHT_MOBILE = 56
const ASSISTANT_PANEL_WIDTH_DESKTOP = 528
const ASSISTANT_PANEL_HEIGHT_MOBILE = 832

function usePlannerAssistantContext() {
  const ctx = useContext(PlannerAssistantContext)
  if (!ctx) {
    throw new Error('PlannerAssistantContext not found')
  }
  return ctx
}

function statusToAssistantUi(status: AssistantMessage['status']) {
  if (status === 'running') return { type: 'running' as const }
  if (status === 'requires_action') {
    return { type: 'requires-action' as const, reason: 'interrupt' as const }
  }
  if (status === 'incomplete') {
    return { type: 'incomplete' as const, reason: 'error' as const }
  }
  return { type: 'complete' as const, reason: 'stop' as const }
}

function isTextPart(part: AssistantMessagePart): part is AssistantTextPart {
  return typeof part === 'object' && part !== null && part.type === 'text'
}

function isToolPart(part: AssistantMessagePart): part is AssistantToolCallPart {
  return typeof part === 'object' && part !== null && part.type === 'tool-call'
}

function isDataPart(part: AssistantMessagePart): part is AssistantDataPart {
  return typeof part === 'object' && part !== null && part.type === 'data'
}

function isJobProgressPart(part: AssistantMessagePart): part is AssistantDataPart {
  return isDataPart(part) && part.name === 'job-progress'
}

function toThreadMessage(message: AssistantMessage): ThreadMessageLike {
  const content = message.parts
    .map((part) => {
      if (isTextPart(part)) {
        return { type: 'text' as const, text: part.text }
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
        } as ThreadMessageLike['content'][number]
      }
      if (isDataPart(part)) {
        return {
          type: 'data' as const,
          name: part.name,
          data: part.data,
        }
      }
      return null
    })
    .filter(Boolean) as ThreadMessageLike['content']

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
  } satisfies Omit<ThreadMessageLike, 'status'>

  if (message.role === 'assistant') {
    return {
      ...baseMessage,
      status: statusToAssistantUi(message.status),
    }
  }

  return baseMessage
}

function extractAppendText(message: AppendMessage) {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text
      return ''
    })
    .join('\n')
    .trim()
}

function formatToolLabel(toolName: string) {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
}

function toInlineError(error: unknown, fallback = 'Something went wrong.') {
  if (typeof error === 'string') {
    return error
  }
  if (isApiError(error)) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function removeAssistantMessage(
  queryClient: QueryClient,
  tripId: string,
  messageId: string,
) {
  queryClient.setQueryData(assistantKeys.thread(tripId), (current: unknown) => {
    if (!current || typeof current !== 'object') {
      return current
    }
    const thread = current as { messages?: AssistantMessage[] }
    if (!Array.isArray(thread.messages)) {
      return current
    }
    return {
      ...thread,
      messages: thread.messages.filter((message) => message.id !== messageId),
    }
  })
}

function previewJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildTimelineRows(events: unknown[]): JobTimelineRow[] {
  const rows: JobTimelineRow[] = []
  const toolIndexByCallId = new Map<string, number>()

  for (const item of events) {
    if (!item || typeof item !== 'object') continue
    const event = item as Record<string, unknown>
    const phase = typeof event.phase === 'string' ? event.phase : null
    const eventId =
      typeof event.event_id === 'string' && event.event_id
        ? event.event_id
        : crypto.randomUUID()

    if (event.type === 'step') {
      rows.push({
        kind: 'step',
        phase,
        eventId,
        name: String(event.name ?? 'Progress update'),
        detail: String(event.detail ?? ''),
      })
      continue
    }

    if (event.type === 'tool_call') {
      const callId = typeof event.call_id === 'string' ? event.call_id : eventId
      toolIndexByCallId.set(callId, rows.length)
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
      })
      continue
    }

    if (event.type === 'tool_result') {
      const callId = typeof event.call_id === 'string' ? event.call_id : null
      const rowIndex = callId ? toolIndexByCallId.get(callId) : undefined
      if (rowIndex !== undefined) {
        const row = rows[rowIndex]
        if (row.kind === 'tool') {
          row.result =
            event.result && typeof event.result === 'object'
              ? (event.result as Record<string, unknown>)
              : {}
          row.isError = Boolean(event.is_error)
        }
        continue
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
      })
      continue
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
      })
    }
  }

  return rows
}

function buildSummaryEntries(summary: Record<string, unknown> | undefined) {
  if (!summary) return []
  return Object.entries(summary).filter(([, value]) => {
    if (value == null) return false
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
}

function getLauncherDimensions(isMobile: boolean) {
  return {
    width: isMobile ? LAUNCHER_WIDTH_MOBILE : LAUNCHER_WIDTH_DESKTOP,
    height: isMobile ? LAUNCHER_HEIGHT_MOBILE : LAUNCHER_HEIGHT_DESKTOP,
    margin: isMobile ? LAUNCHER_MARGIN_MOBILE : LAUNCHER_MARGIN_DESKTOP,
  }
}

function clampLauncherPosition(
  position: LauncherPosition,
  isMobile: boolean,
): LauncherPosition {
  if (typeof window === 'undefined') {
    return position
  }

  const { width, height, margin } = getLauncherDimensions(isMobile)
  return {
    x: Math.min(
      Math.max(position.x, margin),
      Math.max(margin, window.innerWidth - width - margin),
    ),
    y: Math.min(
      Math.max(position.y, margin),
      Math.max(margin, window.innerHeight - height - margin),
    ),
  }
}

function getDefaultLauncherPosition(isMobile: boolean): LauncherPosition {
  if (typeof window === 'undefined') {
    return { x: 24, y: 24 }
  }

  const { width, height, margin } = getLauncherDimensions(isMobile)
  return clampLauncherPosition(
    {
      x: window.innerWidth - width - margin,
      y:
        window.innerHeight -
        height -
        (isMobile ? margin + 56 : margin),
    },
    isMobile,
  )
}

function resolveLauncherDisplayPosition(
  position: LauncherPosition,
  isMobile: boolean,
  isOpen: boolean,
): LauncherPosition {
  if (typeof window === 'undefined' || !isOpen) {
    return position
  }

  const { width, height, margin } = getLauncherDimensions(isMobile)

  if (isMobile) {
    const sheetHeight = Math.min(window.innerHeight * 0.88, ASSISTANT_PANEL_HEIGHT_MOBILE)
    const visibleBottom = Math.max(margin, window.innerHeight - sheetHeight - 12)
    return {
      x: Math.min(
        Math.max(position.x, margin),
        Math.max(margin, window.innerWidth - width - margin),
      ),
      y: Math.min(
        Math.max(position.y, margin),
        Math.max(margin, visibleBottom - height),
      ),
    }
  }

  const visibleRight = window.innerWidth - ASSISTANT_PANEL_WIDTH_DESKTOP - 12
  return {
    x: Math.min(
      Math.max(position.x, margin),
      Math.max(margin, visibleRight - width),
    ),
    y: Math.min(
      Math.max(position.y, margin),
      Math.max(margin, window.innerHeight - height - margin),
    ),
  }
}

type SubmitPlannerAssistantInputResult = 'sent' | 'dialog' | 'invalid' | 'noop'

type PlannerAssistantCommandActionsOptions = {
  hasActivities: boolean
  focusComposer: () => void
  setStreamError: (error: string | null) => void
  onRequestGenerationDialog: (action: PlannerAssistantDialogCommand) => void
  handleDirectCommand: (
    commandName: PlannerAssistantDirectCommand,
    args: AssistantCommandInput['args'],
    displayText: string,
  ) => Promise<void>
}

function getQuickActionCommands(hasActivities: boolean) {
  return PLANNER_ASSISTANT_COMMANDS.filter((command) => {
    if (!command.chipLabel) return false
    if (command.name === 'regenerate') return false
    if (!hasActivities && command.name === 'reset') return false
    return true
  })
}

function getEmptyStateActions(hasActivities: boolean) {
  return getQuickActionCommands(hasActivities)
    .filter((command) => ['generate', 'snapshot', 'search_places'].includes(command.name))
    .slice(0, 4)
}

function usePlannerAssistantCommandActions({
  hasActivities,
  focusComposer,
  setStreamError,
  onRequestGenerationDialog,
  handleDirectCommand,
}: PlannerAssistantCommandActionsOptions) {
  const aui = useAui()
  const composerText = useAuiState((state) => (state.composer.isEditing ? state.composer.text : ''))

  const setComposerText = useCallback(
    (text: string) => {
      aui.composer().setText(text)
    },
    [aui],
  )

  const commandSuggestions = useMemo(() => {
    return getPlannerAssistantCommandSuggestions(composerText).filter((command) => {
      if (!hasActivities && command.name === 'reset') {
        return false
      }
      return true
    })
  }, [composerText, hasActivities])

  const handleCommandAction = useCallback(
    (command: PlannerAssistantCommandDefinition) => {
      setStreamError(null)
      if (command.kind === 'dialog') {
        setComposerText('')
        onRequestGenerationDialog(command.name as PlannerAssistantDialogCommand)
        return
      }

      if (command.name === 'snapshot') {
        setComposerText('')
        void handleDirectCommand('snapshot', {}, '/snapshot')
        return
      }

      setComposerText(command.template ?? formatPlannerAssistantCommandText(command.name))
      focusComposer()
    },
    [
      focusComposer,
      handleDirectCommand,
      onRequestGenerationDialog,
      setComposerText,
      setStreamError,
    ],
  )

  return {
    composerText,
    commandSuggestions,
    handleCommandAction,
    quickActionCommands: getQuickActionCommands(hasActivities),
    setComposerText,
  }
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white px-4 py-3 text-[0.86rem] leading-6 text-[var(--color-text)] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  )
}

function PlannerResultCard({ part }: { part: AssistantDataPart }) {
  const operation = String(part.data.operation ?? 'tool')
  const activity =
    part.data.activity && typeof part.data.activity === 'object'
      ? (part.data.activity as Record<string, unknown>)
      : null
  const title = typeof activity?.title === 'string' ? activity.title : null
  const place =
    activity?.place && typeof activity.place === 'object'
      ? (activity.place as Record<string, unknown>)
      : null
  const placeName = typeof place?.name === 'string' ? place.name : null
  const jobId = typeof part.data.job_id === 'string' ? part.data.job_id : null

  return (
    <Card
      variant="solid"
      className="overflow-hidden rounded-2xl border-black/8 bg-white"
    >
      <CardHeader className="gap-2 border-b border-black/6 px-4 py-3">
        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
          <WandSparkles className="size-3.5 text-[var(--color-primary)]" />
          <span>{formatToolLabel(operation)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {title ? (
            <CardTitle className="text-[0.95rem]">{title}</CardTitle>
          ) : (
            <CardTitle className="text-[0.95rem]">
              Planner operation completed
            </CardTitle>
          )}
          {placeName ? <Badge variant="secondary">{placeName}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="px-4 py-3">
        {jobId ? (
          <CardDescription className="text-[0.76rem]">
            Job <span className="font-medium text-[var(--color-text)]">{jobId.slice(0, 8)}</span>{' '}
            is mirrored into this thread.
          </CardDescription>
        ) : (
          <CardDescription className="text-[0.76rem]">
            The planner state was updated and the board will refresh automatically.
          </CardDescription>
        )}
      </CardContent>
    </Card>
  )
}

function ToolCard({ part, messageId }: { part: AssistantToolCallPart; messageId: string }) {
  const { confirmToolCall } = usePlannerAssistantContext()
  const pending = Boolean(part.interrupt)
  const resultPreview = part.result ? previewJson(part.result) : null
  const argsPreview =
    part.argsText && part.argsText.trim().length > 0
      ? part.argsText
      : previewJson(part.args ?? {})

  return (
    <Card
      variant="solid"
      className="overflow-hidden rounded-2xl border-black/8 bg-white"
    >
      <CardHeader className="gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 items-center justify-center rounded-xl border border-black/6 bg-[rgba(47,111,115,0.06)] text-[var(--color-primary)]">
            {part.isError ? <XCircle className="size-4" /> : <Sparkles className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-[0.9rem]">{formatToolLabel(part.toolName)}</CardTitle>
            <CardDescription className="mt-1 text-[0.75rem]">
              {pending ? 'Waiting for confirmation.' : 'Tool orchestration record.'}
            </CardDescription>
          </div>
          <Badge variant={pending ? 'warning' : part.isError ? 'danger' : 'neutral'}>
            {pending ? 'Confirm' : part.isError ? 'Error' : part.result ? 'Done' : 'Running'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-3">
        <div className="rounded-xl border border-black/6 bg-[rgba(244,246,248,0.52)] px-3 py-3">
          <p className="text-[0.68rem] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
            Args
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[0.72rem] leading-5 text-[var(--color-text)]">
            {argsPreview}
          </pre>
        </div>
        {resultPreview ? (
          <div className="rounded-xl border border-black/6 bg-[rgba(244,246,248,0.52)] px-3 py-3">
            <p className="text-[0.68rem] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              Result
            </p>
            <pre
              className={cn(
                'mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[0.72rem] leading-5',
                part.isError
                  ? 'text-[rgba(196,95,79,1)]'
                  : 'text-[var(--color-text)]',
              )}
            >
              {resultPreview}
            </pre>
          </div>
        ) : null}
        {pending ? (
          <div className="flex gap-2">
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
      </CardContent>
    </Card>
  )
}

function JobProgressCard({ part }: { part: AssistantDataPart }) {
  const action = String(part.data.action ?? 'generate')
  const requestText = String(part.data.request_text ?? 'Planner job')
  const jobStatus = String(part.data.job_status ?? 'PENDING')
  const rows = buildTimelineRows(Array.isArray(part.data.events) ? part.data.events : [])
  const groupedRows = rows.reduce<Record<string, JobTimelineRow[]>>((accumulator, row) => {
    const key = row.phase ?? 'queued'
    accumulator[key] = [...(accumulator[key] ?? []), row]
    return accumulator
  }, {})
  const summaryEntries = buildSummaryEntries(
    part.data.summary && typeof part.data.summary === 'object'
      ? (part.data.summary as Record<string, unknown>)
      : undefined,
  )
  const latestActiveRow = [...rows].reverse().find((row) => row.kind !== 'done')

  return (
    <Card
      variant="solid"
      className="overflow-hidden rounded-2xl border-black/8 bg-white"
    >
      <CardHeader className="gap-3 border-b border-black/6 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl border border-black/6 bg-[rgba(47,111,115,0.08)] text-[var(--color-primary)]">
            {jobStatus === 'SUCCEEDED' ? (
              <Check className="size-4.5" />
            ) : jobStatus === 'FAILED' ? (
              <XCircle className="size-4.5" />
            ) : (
              <Loader2 className="size-4.5 animate-spin" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                {formatToolLabel(action)}
              </p>
              <Badge
                variant={
                  jobStatus === 'SUCCEEDED'
                    ? 'success'
                    : jobStatus === 'FAILED'
                      ? 'danger'
                      : 'warning'
                }
              >
                {jobStatus}
              </Badge>
            </div>
            <CardTitle className="mt-1 text-[0.98rem]">{requestText}</CardTitle>
            <CardDescription className="mt-1 text-[0.76rem]">
              {latestActiveRow?.kind === 'step'
                ? latestActiveRow.name
                : latestActiveRow?.kind === 'tool'
                  ? `Running ${formatToolLabel(latestActiveRow.toolName)}`
                  : 'Queued and waiting for worker pickup.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4 py-3">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-black/6 bg-[rgba(244,246,248,0.52)] px-3 py-3 text-[0.78rem] text-[var(--color-text-muted)]">
            <Clock3 className="size-3.5" />
            <span>Queued and waiting for worker pickup.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {Object.entries(groupedRows).map(([phase, phaseRows]) => (
              <div key={phase} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-black/6" />
                  <p className="text-[0.66rem] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                    {phase.replace(/_/g, ' ')}
                  </p>
                  <div className="h-px flex-1 bg-black/6" />
                </div>
                <div className="flex flex-col gap-2">
                  {phaseRows.map((row) => {
                    if (row.kind === 'step') {
                      return (
                        <div
                          key={row.eventId}
                          className="flex items-start gap-2 rounded-xl border border-black/6 bg-[rgba(244,246,248,0.42)] px-3 py-3"
                        >
                          <ChevronRight className="mt-[2px] size-3.5 text-[var(--color-primary)]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.82rem] text-[var(--color-text)]">{row.name}</p>
                            {row.detail ? (
                              <p className="mt-1 text-[0.74rem] text-[var(--color-text-muted)]">
                                {row.detail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )
                    }

                    if (row.kind === 'tool') {
                      return (
                        <div
                          key={row.eventId}
                          className="rounded-xl border border-black/6 bg-[rgba(244,246,248,0.42)] px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[0.8rem] font-medium text-[var(--color-text)]">
                              {formatToolLabel(row.toolName)}
                            </p>
                            {row.callId ? (
                              <Badge variant="outline" className="font-mono normal-case tracking-normal">
                                {row.callId.slice(0, 8)}
                              </Badge>
                            ) : null}
                            {row.result ? (
                              <Badge variant={row.isError ? 'danger' : 'success'}>
                                {row.isError ? 'Error' : 'Done'}
                              </Badge>
                            ) : (
                              <Badge variant="warning">Running</Badge>
                            )}
                          </div>
                          {Object.keys(row.args).length > 0 ? (
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[0.7rem] leading-5 text-[var(--color-text-muted)]">
                              {previewJson(row.args)}
                            </pre>
                          ) : null}
                          {row.result ? (
                            <pre
                              className={cn(
                                'mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[0.7rem] leading-5',
                                row.isError
                                  ? 'text-[rgba(196,95,79,1)]'
                                  : 'text-[var(--color-text-muted)]',
                              )}
                            >
                              {previewJson(row.result)}
                            </pre>
                          ) : null}
                        </div>
                      )
                    }

                    return (
                      <div
                        key={row.eventId}
                        className="flex items-center gap-2 rounded-xl border border-black/6 bg-[rgba(244,246,248,0.42)] px-3 py-3 text-[0.8rem] text-[var(--color-text)]"
                      >
                        {row.status === 'SUCCEEDED' ? (
                          <Check className="size-3.5 text-[var(--color-success)]" />
                        ) : (
                          <XCircle className="size-3.5 text-[rgba(196,95,79,1)]" />
                        )}
                        <span>
                          {row.status === 'SUCCEEDED'
                            ? 'Planner updated successfully.'
                            : 'Generation finished with an error.'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {summaryEntries.length > 0 ? (
          <div className="rounded-xl border border-black/6 bg-[rgba(244,246,248,0.42)] px-4 py-3">
            <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Summary
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {summaryEntries.map(([key, value]) => (
                <Badge key={key} variant="secondary" className="normal-case tracking-normal">
                  {formatToolLabel(key)}: {typeof value === 'object' ? previewJson(value) : String(value)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EmptyThreadState({
  destination,
  onRunAction,
  hasActivities,
}: {
  destination: string
  onRunAction: (command: PlannerAssistantCommandDefinition) => void
  hasActivities: boolean
}) {
  const emptyActions = getEmptyStateActions(hasActivities)

  return (
    <div className="flex min-h-[16rem] flex-col justify-center gap-4 pb-4">
      <Card variant="solid" className="overflow-hidden rounded-[24px] border-black/8 bg-white">
        <CardHeader className="gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full border border-black/8 bg-[rgba(47,111,115,0.08)] text-[var(--color-primary)]">
              <Bot className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-[0.98rem]">Planner Assistant</CardTitle>
              <CardDescription className="mt-1 text-[0.78rem]">
                Live planner chat, tool orchestration, and itinerary job progress in one thread.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-5 py-5">
          <div className="rounded-xl border border-black/6 bg-[rgba(244,246,248,0.42)] px-4 py-4">
            <p className="text-[0.8rem] leading-6 text-[var(--color-text)]">
              Ask for itinerary edits, inspect the current plan, or queue generation for{' '}
              <span className="font-medium">{destination || 'this trip'}</span>. Mirrored jobs and
              tool history stay here after reload.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {emptyActions.map((command) => (
              <Button
                key={command.name}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3.5"
                onClick={() => onRunAction(command)}
              >
                {command.name === 'generate' ? <Sparkles data-icon="inline-start" /> : null}
                {command.name === 'snapshot' ? <LayoutList data-icon="inline-start" /> : null}
                {command.name === 'search_places' ? <Search data-icon="inline-start" /> : null}
                {command.chipLabel}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PlannerAssistantEmptyState({
  destination,
  hasActivities,
  focusComposer,
  setStreamError,
  onRequestGenerationDialog,
  handleDirectCommand,
}: {
  destination: string
  hasActivities: boolean
  focusComposer: () => void
  setStreamError: (error: string | null) => void
  onRequestGenerationDialog: (action: PlannerAssistantDialogCommand) => void
  handleDirectCommand: (
    commandName: PlannerAssistantDirectCommand,
    args: AssistantCommandInput['args'],
    displayText: string,
  ) => Promise<void>
}) {
  const { handleCommandAction } = usePlannerAssistantCommandActions({
    hasActivities,
    focusComposer,
    setStreamError,
    onRequestGenerationDialog,
    handleDirectCommand,
  })

  return (
    <EmptyThreadState
      destination={destination}
      onRunAction={handleCommandAction}
      hasActivities={hasActivities}
    />
  )
}

function PlannerAssistantComposer({
  hasActivities,
  isStreaming,
  streamError,
  setStreamError,
  focusComposer,
  textareaRef,
  cancelCurrentStream,
  handleDirectCommand,
  onRequestGenerationDialog,
  onSubmitInput,
}: {
  hasActivities: boolean
  isStreaming: boolean
  streamError: string | null
  setStreamError: (error: string | null) => void
  focusComposer: () => void
  textareaRef: { current: HTMLTextAreaElement | null }
  cancelCurrentStream: () => Promise<void>
  handleDirectCommand: (
    commandName: PlannerAssistantDirectCommand,
    args: AssistantCommandInput['args'],
    displayText: string,
  ) => Promise<void>
  onRequestGenerationDialog: (action: PlannerAssistantDialogCommand) => void
  onSubmitInput: (rawInput: string) => Promise<SubmitPlannerAssistantInputResult>
}) {
  const { composerText, commandSuggestions, handleCommandAction, quickActionCommands, setComposerText } =
    usePlannerAssistantCommandActions({
      hasActivities,
      focusComposer,
      setStreamError,
      onRequestGenerationDialog,
      handleDirectCommand,
    })

  const submitComposer = useCallback(async () => {
    const result = await onSubmitInput(composerText)
    if (result === 'sent' || result === 'dialog') {
      setComposerText('')
    }
  }, [composerText, onSubmitInput, setComposerText])

  return (
    <div className="flex flex-col gap-3 border-t border-black/6 bg-[rgba(252,252,251,0.96)] px-4 py-3 backdrop-blur-sm">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {quickActionCommands.map((command) => (
          <Button
            key={command.name}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 rounded-full px-3.5"
            onClick={() => handleCommandAction(command)}
          >
            {command.name === 'generate' ? <Sparkles data-icon="inline-start" /> : null}
            {command.name === 'reset' ? <Trash2 data-icon="inline-start" /> : null}
            {command.name === 'snapshot' ? <LayoutList data-icon="inline-start" /> : null}
            {command.name === 'search_places' ? <Search data-icon="inline-start" /> : null}
            {command.chipLabel}
          </Button>
        ))}
      </div>

      {streamError ? (
        <div className="rounded-xl border border-[rgba(196,95,79,0.18)] bg-[rgba(196,95,79,0.06)] px-3 py-2 text-[0.76rem] text-[rgba(196,95,79,1)]">
          {streamError}
        </div>
      ) : null}

      <ComposerPrimitive.Root
        className="rounded-2xl border border-black/8 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)]"
        onSubmit={(event) => {
          event.preventDefault()
          void submitComposer()
        }}
      >
        <ComposerPrimitive.Input
          ref={textareaRef}
          submitMode="none"
          minRows={2}
          maxRows={8}
          placeholder="Ask about this trip, type / for commands, or queue itinerary work…"
          className="min-h-[76px] w-full resize-none border-0 bg-transparent px-3.5 py-3 text-[0.88rem] leading-6 outline-none focus-visible:ring-0"
          onChange={() => {
            if (streamError) {
              setStreamError(null)
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return
            }
            if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
              return
            }
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />

        <AnimatePresence>
          {composerText.trimStart().startsWith('/') ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="px-2 pb-2"
            >
              <Command className="overflow-hidden rounded-[18px] border border-black/8 bg-[rgba(252,252,251,0.96)]">
                <CommandList className="max-h-[13rem] p-2">
                  <CommandEmpty>No matching commands.</CommandEmpty>
                  <CommandGroup heading="Commands">
                    {commandSuggestions.map((command) => (
                      <CommandItem
                        key={command.name}
                        value={command.name}
                        onSelect={() => handleCommandAction(command)}
                        className="items-start rounded-[14px] px-3 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--color-text)]">
                              /{command.name}
                            </span>
                            <Badge variant="outline">{command.kind}</Badge>
                          </div>
                          <p className="mt-1 text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
                            {command.description}
                          </p>
                          {command.template ? (
                            <p className="mt-1 truncate font-mono text-[0.68rem] text-[var(--color-text-muted)]">
                              {command.template}
                            </p>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/6 px-3.5 py-2.5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Enter sends. Cmd/Ctrl + Enter or Shift + Enter adds a new line.
          </p>
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3.5"
                onClick={() => void cancelCurrentStream()}
              >
                <X data-icon="inline-start" />
                Cancel
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-full px-3.5"
              disabled={isStreaming || !composerText.trim()}
            >
              {isStreaming ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Send data-icon="inline-start" />
              )}
              Send
            </Button>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  )
}

function UserMessage() {
  const state = useMessage()
  const text = state.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')

  return (
    <MessagePrimitive.Root className="flex justify-end pb-3">
      <div className="max-w-[84%] rounded-2xl rounded-br-[10px] bg-[var(--color-primary)] px-4 py-3 text-white shadow-[0_12px_24px_rgba(47,111,115,0.18)]">
        <p className="whitespace-pre-wrap text-[0.84rem] leading-6">{text}</p>
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessageView() {
  const state = useMessage()
  const parts = state.content as AssistantMessagePart[]
  const messageId = state.id

  return (
    <MessagePrimitive.Root className="pb-3">
      <div className="mb-2 flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
        <span className="flex size-7 items-center justify-center rounded-full border border-black/6 bg-white text-[var(--color-primary)]">
          <Bot className="size-3.5" />
        </span>
        <span>Voyager Assistant</span>
        {state.status?.type === 'running' ? (
          <Loader2 className="size-3 animate-spin text-[var(--color-primary)]" />
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5">
        {parts.map((part, index) => {
          if (isTextPart(part)) {
            return <TextBlock key={`${messageId}-text-${index}`} text={part.text} />
          }
          if (isToolPart(part)) {
            return (
              <ToolCard
                key={`${messageId}-tool-${part.toolCallId}-${index}`}
                part={part}
                messageId={messageId}
              />
            )
          }
          if (isDataPart(part) && part.name === 'planner-result') {
            return <PlannerResultCard key={`${messageId}-result-${index}`} part={part} />
          }
          if (isDataPart(part) && part.name === 'job-progress') {
            return <JobProgressCard key={`${messageId}-job-${index}`} part={part} />
          }
          return null
        })}
      </div>
    </MessagePrimitive.Root>
  )
}

function FloatingAssistantLauncher({
  isMobile,
  isOpen,
  hasLiveActivity,
  position,
  onOpenChange,
  onPositionChange,
}: {
  isMobile: boolean
  isOpen: boolean
  hasLiveActivity: boolean
  position: LauncherPosition
  onOpenChange: (open: boolean) => void
  onPositionChange: (position: LauncherPosition) => void
}) {
  return (
    <motion.button
      type="button"
      drag
      dragMomentum={false}
      dragElastic={0.12}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      initial={{ opacity: 0, y: 12 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className={cn(
        'fixed z-[60] flex size-14 items-center justify-center rounded-full border border-[rgba(28,44,53,0.12)] bg-[linear-gradient(145deg,rgba(255,255,255,0.98)_0%,rgba(241,247,246,0.94)_100%)] text-[var(--color-text)] shadow-[0_26px_60px_-28px_rgba(24,36,42,0.48)] backdrop-blur-xl',
        isOpen && 'shadow-[0_30px_70px_-26px_rgba(47,111,115,0.5)] ring-2 ring-[rgba(47,111,115,0.18)]',
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
      onDragEnd={(_event, info) => {
        onPositionChange(
          clampLauncherPosition(
            {
              x: position.x + info.offset.x,
              y: position.y + info.offset.y,
            },
            isMobile,
          ),
        )
      }}
      onClick={() => onOpenChange(!isOpen)}
      aria-label={isOpen ? 'Close planner assistant' : 'Open planner assistant'}
    >
      <div className="relative flex size-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-primary)_0%,#6d9394_100%)] text-white shadow-[0_18px_40px_-22px_rgba(47,111,115,0.82)]">
        <Bot className="size-5" />
        <AnimatePresence>
          {hasLiveActivity ? (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="absolute -right-1 -top-1 flex size-3.5 rounded-full border-2 border-white bg-[var(--color-success)]"
            />
          ) : null}
        </AnimatePresence>
      </div>
    </motion.button>
  )
}

export function PlannerAssistantPanel({
  tripId,
  destination,
  hasActivities,
  isOpen,
  onOpenChange,
  onRequestGenerationDialog,
}: PlannerAssistantPanelProps) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const { data, isLoading } = useAssistantThread(tripId)
  const assistantLauncherPosition = usePlannerStore((state) => state.assistantLauncherPosition)
  const setAssistantLauncherPosition = usePlannerStore(
    (state) => state.setAssistantLauncherPosition,
  )
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const jobStreamControllersRef = useRef(new Map<string, AbortController>())
  const ignoredJobResumeIdsRef = useRef(new Set<string>())
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const messages = data?.messages ?? []
  const runningJobIds = useMemo(() => {
    return Array.from(
      new Set(
        messages.flatMap((message) => {
          if (
            message.role !== 'assistant' ||
            message.status !== 'running' ||
            !message.source_job_id ||
            !message.parts.some((part) => isJobProgressPart(part))
          ) {
            return []
          }
          return [message.source_job_id]
        }),
      ),
    )
  }, [messages])
  const hasLiveActivity =
    isStreaming ||
    runningJobIds.length > 0 ||
    messages.some(
      (message) => message.role === 'assistant' && message.status === 'running',
    )
  const launcherPosition =
    assistantLauncherPosition ?? getDefaultLauncherPosition(isMobile)
  const launcherDisplayPosition = resolveLauncherDisplayPosition(
    launcherPosition,
    isMobile,
    isOpen,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncLauncherPosition = () => {
      const nextPosition = clampLauncherPosition(
        assistantLauncherPosition ?? getDefaultLauncherPosition(isMobile),
        isMobile,
      )
      if (
        !assistantLauncherPosition ||
        nextPosition.x !== assistantLauncherPosition.x ||
        nextPosition.y !== assistantLauncherPosition.y
      ) {
        setAssistantLauncherPosition(nextPosition)
      }
    }

    syncLauncherPosition()
    window.addEventListener('resize', syncLauncherPosition)
    return () => window.removeEventListener('resize', syncLauncherPosition)
  }, [assistantLauncherPosition, isMobile, setAssistantLauncherPosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 180)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen])

  useEffect(() => {
    const controllerMap = jobStreamControllersRef.current
    const activeJobIds = new Set(runningJobIds)
    for (const ignoredJobId of [...ignoredJobResumeIdsRef.current]) {
      if (!activeJobIds.has(ignoredJobId)) {
        ignoredJobResumeIdsRef.current.delete(ignoredJobId)
      }
    }

    for (const [jobId, controller] of controllerMap.entries()) {
      if (!activeJobIds.has(jobId)) {
        controller.abort()
        controllerMap.delete(jobId)
      }
    }

    for (const jobId of activeJobIds) {
      if (ignoredJobResumeIdsRef.current.has(jobId)) {
        continue
      }
      if (controllerMap.has(jobId)) {
        continue
      }

      const controller = new AbortController()
      controllerMap.set(jobId, controller)

      void streamJobProgress(
        jobId,
        (event: JobProgressEvent) => {
          appendAssistantJobProgressEvent(queryClient, tripId, jobId, event)
          if (event.type === 'done') {
            ignoredJobResumeIdsRef.current.add(jobId)
            controller.abort()
            void queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) })
            void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
          }
        },
        controller.signal,
      )
        .catch((error) => {
          if ((error as Error)?.name === 'AbortError') {
            return
          }
          if (isApiError(error) && error.status === 404) {
            ignoredJobResumeIdsRef.current.add(jobId)
            return
          }
          setStreamError((current) => current ?? toInlineError(error, 'Failed to resume planner job progress.'))
        })
        .finally(() => {
          if (controllerMap.get(jobId) === controller) {
            controllerMap.delete(jobId)
          }
        })
    }
  }, [queryClient, runningJobIds, tripId])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      for (const controller of jobStreamControllersRef.current.values()) {
        controller.abort()
      }
      jobStreamControllersRef.current.clear()
    }
  }, [])

  const focusComposer = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.requestAnimationFrame(() => {
      const element = textareaRef.current
      if (!element) {
        return
      }
      element.focus()
      const end = element.value.length
      element.setSelectionRange(end, end)
    })
  }, [])

  const cancelCurrentStream = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const startStream = useCallback(
    async (
      payload: AssistantMessageStreamInput,
      optimisticMessageId?: string,
    ) => {
      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setStreamError(null)

      try {
        await streamAssistantMessages(
          tripId,
          payload,
          (event) => {
            if (event.type === 'message_upsert') {
              upsertAssistantMessages(queryClient, tripId, [event.message])
              return
            }
            if (event.type === 'error') {
              setStreamError(event.error.message)
            }
          },
          controller.signal,
        )
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) }),
          queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) }),
        ])
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return
        }
        if (optimisticMessageId) {
          removeAssistantMessage(queryClient, tripId, optimisticMessageId)
        }
        setStreamError(toInlineError(error, 'Failed to reach the planner assistant.'))
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setIsStreaming(false)
      }
    },
    [queryClient, tripId],
  )

  const handleTextTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) {
        return
      }

      const clientMessageId = crypto.randomUUID()
      const optimisticMessage: AssistantMessage = {
        id: clientMessageId,
        thread_id: data?.id ?? `thread-${tripId}`,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: trimmed }],
        metadata: { kind: 'chat' },
        source_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      upsertAssistantMessages(queryClient, tripId, [optimisticMessage])
      onOpenChange(true)

      await startStream(
        {
          client_message_id: clientMessageId,
          text: trimmed,
        },
        clientMessageId,
      )
    },
    [data?.id, isStreaming, onOpenChange, queryClient, startStream, tripId],
  )

  const handleDirectCommand = useCallback(
    async (
      commandName: PlannerAssistantDirectCommand,
      args: AssistantCommandInput['args'],
      displayText: string,
    ) => {
      if (isStreaming) {
        return
      }

      const clientMessageId = crypto.randomUUID()
      const optimisticMessage: AssistantMessage = {
        id: clientMessageId,
        thread_id: data?.id ?? `thread-${tripId}`,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: displayText }],
        metadata: {
          kind: 'command',
          command_name: commandName,
          command_args: args,
        },
        source_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      upsertAssistantMessages(queryClient, tripId, [optimisticMessage])
      onOpenChange(true)

      await startStream(
        {
          client_message_id: clientMessageId,
          command: {
            name: commandName,
            args,
          },
        },
        clientMessageId,
      )
    },
    [data?.id, isStreaming, onOpenChange, queryClient, startStream, tripId],
  )

  const handleSubmitInput = useCallback(
    async (rawInput: string): Promise<SubmitPlannerAssistantInputResult> => {
      const trimmed = rawInput.trim()
      if (!trimmed) {
        return 'noop'
      }
      if (isStreaming) {
        return 'noop'
      }

      if (!trimmed.startsWith('/')) {
        await handleTextTurn(trimmed)
        return 'sent'
      }

      const parsed = parsePlannerAssistantCommand(trimmed)
      if (!parsed) {
        return 'noop'
      }

      if (parsed.type === 'invalid') {
        setStreamError(parsed.message)
        return 'invalid'
      }

      if (parsed.type === 'dialog') {
        setStreamError(null)
        onRequestGenerationDialog(parsed.name)
        return 'dialog'
      }

      setStreamError(null)
      await handleDirectCommand(parsed.name, parsed.args, parsed.displayText)
      return 'sent'
    },
    [handleDirectCommand, handleTextTurn, isStreaming, onRequestGenerationDialog],
  )

  const confirmToolCall = useCallback(
    async (messageId: string, toolCallId: string, confirmed: boolean) => {
      if (isStreaming) {
        return
      }
      await startStream({
        confirmation: {
          message_id: messageId,
          tool_call_id: toolCallId,
          confirmed,
        },
      })
    },
    [isStreaming, startStream],
  )

  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages,
    isRunning: isStreaming,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const text = extractAppendText(message)
      await handleSubmitInput(text)
    },
    onCancel: cancelCurrentStream,
  })

  return (
    <PlannerAssistantContext.Provider value={{ confirmToolCall }}>
      <FloatingAssistantLauncher
        isMobile={isMobile}
        isOpen={isOpen}
        hasLiveActivity={hasLiveActivity}
        position={launcherDisplayPosition}
        onOpenChange={onOpenChange}
        onPositionChange={setAssistantLauncherPosition}
      />

      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'flex w-full flex-col gap-0 border-black/8 bg-[#fcfcfb] p-0',
            isMobile
              ? 'h-[min(88vh,52rem)] rounded-t-[28px] border-x-0 border-b-0'
              : 'max-w-[33rem] border-l sm:max-w-[33rem]',
          )}
        >
          <SheetHeader className="border-b border-black/6 px-4 py-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full border border-black/8 bg-[rgba(47,111,115,0.08)] text-[var(--color-primary)]">
                <Bot className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-left text-[0.95rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                  Planner Assistant
                </SheetTitle>
                <SheetDescription className="mt-0.5 flex items-center gap-1.5 text-[0.76rem] text-[var(--color-text-muted)]">
                  <MapPin className="size-3.5" />
                  <span>{destination || 'Current trip'}</span>
                </SheetDescription>
              </div>
              {hasLiveActivity ? (
                <div className="flex items-center gap-2 self-center text-[0.72rem] text-[var(--color-text-muted)]">
                  <span className="size-2 rounded-full bg-[var(--color-success)]" />
                  <span>Live</span>
                </div>
              ) : null}
            </div>
          </SheetHeader>

          <AssistantRuntimeProvider runtime={runtime}>
            <div className="min-h-0 flex flex-1 flex-col">
              {isLoading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-[0.82rem] text-[var(--color-text-muted)]">
                  <Loader2 className="mr-2 size-4 animate-spin text-[var(--color-primary)]" />
                  <span>Loading assistant thread…</span>
                </div>
              ) : (
                <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col">
                  <ThreadPrimitive.Viewport
                    autoScroll
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4"
                  >
                    <ThreadPrimitive.Empty>
                      <PlannerAssistantEmptyState
                        destination={destination}
                        hasActivities={hasActivities}
                        focusComposer={focusComposer}
                        setStreamError={setStreamError}
                        onRequestGenerationDialog={onRequestGenerationDialog}
                        handleDirectCommand={handleDirectCommand}
                      />
                    </ThreadPrimitive.Empty>

                    <ThreadPrimitive.Messages
                      components={{
                        UserMessage,
                        AssistantMessage: AssistantMessageView,
                      }}
                    />

                    <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-[rgba(252,252,251,0.96)] pb-0 pt-3 backdrop-blur-sm">
                      <div className="mb-3 flex justify-center">
                        <ThreadPrimitive.ScrollToBottom asChild>
                          <Button
                            type="button"
                            variant="icon"
                            size="sm"
                            className="size-8 rounded-full"
                            aria-label="Scroll to latest messages"
                          >
                            <ChevronRight className="rotate-90" />
                          </Button>
                        </ThreadPrimitive.ScrollToBottom>
                      </div>

                      <PlannerAssistantComposer
                        hasActivities={hasActivities}
                        isStreaming={isStreaming}
                        streamError={streamError}
                        setStreamError={setStreamError}
                        focusComposer={focusComposer}
                        textareaRef={textareaRef}
                        cancelCurrentStream={cancelCurrentStream}
                        handleDirectCommand={handleDirectCommand}
                        onRequestGenerationDialog={onRequestGenerationDialog}
                        onSubmitInput={handleSubmitInput}
                      />
                    </ThreadPrimitive.ViewportFooter>
                  </ThreadPrimitive.Viewport>
                </ThreadPrimitive.Root>
              )}
            </div>
          </AssistantRuntimeProvider>
        </SheetContent>
      </Sheet>
    </PlannerAssistantContext.Provider>
  )
}

type MirrorPlannerJobOptions = {
  tripId: string
  jobId: string
  requestText: string
  action: string
}

export async function mirrorPlannerJobToAssistant(
  queryClient: QueryClient,
  options: MirrorPlannerJobOptions,
) {
  const messages = await mirrorAssistantJob(options.tripId, {
    job_id: options.jobId,
    request_text: options.requestText,
    action: options.action,
  })
  upsertAssistantMessages(queryClient, options.tripId, messages)
  await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(options.tripId) })
}

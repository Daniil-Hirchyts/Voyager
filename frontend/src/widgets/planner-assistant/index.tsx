import {
  createContext,
  useContext,
  useRef,
  useState,
} from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessage,
} from '@assistant-ui/react'
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { mirrorAssistantJob, streamAssistantMessages } from '@/entities/assistant/api'
import { upsertAssistantMessages } from '@/entities/assistant/cache'
import { assistantKeys, useAssistantThread } from '@/entities/assistant/queries'
import { cn } from '@/shared/lib/cn'
import type {
  AssistantDataPart,
  AssistantMessage,
  AssistantMessagePart,
  AssistantToolCallPart,
  AssistantTextPart,
} from '@/shared/api/types'

type PlannerAssistantContextValue = {
  confirmToolCall: (messageId: string, toolCallId: string, confirmed: boolean) => Promise<void>
}

const PlannerAssistantContext = createContext<PlannerAssistantContextValue | null>(null)

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
        }
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

  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(message.created_at),
    status: statusToAssistantUi(message.status),
    metadata: {
      custom: {
        metadata: message.metadata,
        source_job_id: message.source_job_id,
      },
    },
  }
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

type JobTimelineRow =
  | {
      kind: 'step'
      phase: string | null
      name: string
      detail: string
      eventId: string
    }
  | {
      kind: 'tool'
      phase: string | null
      toolName: string
      args: Record<string, unknown>
      result?: Record<string, unknown>
      isError?: boolean
      eventId: string
    }
  | {
      kind: 'done'
      phase: string | null
      status: string
      summary?: Record<string, unknown>
      eventId: string
    }

function buildTimelineRows(events: unknown[]): JobTimelineRow[] {
  const rows: JobTimelineRow[] = []
  const toolIndexByCallId = new Map<string, number>()

  for (const item of events) {
    if (!item || typeof item !== 'object') continue
    const event = item as Record<string, unknown>
    const phase = typeof event.phase === 'string' ? event.phase : null
    const eventId = typeof event.event_id === 'string' ? event.event_id : crypto.randomUUID()
    if (event.type === 'step') {
      rows.push({
        kind: 'step',
        phase,
        name: String(event.name ?? ''),
        detail: String(event.detail ?? ''),
        eventId,
      })
      continue
    }
    if (event.type === 'tool_call') {
      const callId = typeof event.call_id === 'string' ? event.call_id : eventId
      toolIndexByCallId.set(callId, rows.length)
      rows.push({
        kind: 'tool',
        phase,
        toolName: String(event.tool_name ?? 'Tool'),
        args:
          event.args && typeof event.args === 'object'
            ? (event.args as Record<string, unknown>)
            : {},
        eventId,
      })
      continue
    }
    if (event.type === 'tool_result') {
      const callId = typeof event.call_id === 'string' ? event.call_id : ''
      const rowIndex = toolIndexByCallId.get(callId)
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
        toolName: String(event.tool_name ?? 'Tool'),
        args: {},
        result:
          event.result && typeof event.result === 'object'
            ? (event.result as Record<string, unknown>)
            : {},
        isError: Boolean(event.is_error),
        eventId,
      })
      continue
    }
    if (event.type === 'done') {
      rows.push({
        kind: 'done',
        phase,
        status: String(event.status ?? 'FAILED'),
        summary:
          event.summary && typeof event.summary === 'object'
            ? (event.summary as Record<string, unknown>)
            : undefined,
        eventId,
      })
    }
  }

  return rows
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="rounded-[18px] rounded-tl-[6px] bg-[linear-gradient(140deg,#f5f2ea_0%,#ffffff_72%)] px-4 py-3 text-[0.86rem] leading-6 text-[var(--color-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] ring-1 ring-black/6">
      {text}
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
  const jobId = typeof part.data.job_id === 'string' ? part.data.job_id : null

  return (
    <div className="rounded-[18px] border border-black/6 bg-[#fffdf8] px-4 py-3 shadow-[0_10px_30px_rgba(31,41,55,0.06)]">
      <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        <WandSparkles className="size-3.5 text-[var(--color-primary)]" />
        <span>{formatToolLabel(operation)}</span>
      </div>
      {title && <p className="mt-2 text-[0.9rem] font-medium text-[var(--color-text)]">{title}</p>}
      {!title && jobId && (
        <p className="mt-2 text-[0.82rem] text-[var(--color-text)]">Job {jobId.slice(0, 8)} queued.</p>
      )}
    </div>
  )
}

function ToolCard({ part, messageId }: { part: AssistantToolCallPart; messageId: string }) {
  const { confirmToolCall } = usePlannerAssistantContext()
  const pending = Boolean(part.interrupt)
  const callArgs = part.args ?? {}
  const destination = typeof callArgs.destination === 'string' ? callArgs.destination : null

  return (
    <div className="rounded-[18px] border border-black/8 bg-white px-4 py-3 shadow-[0_14px_36px_rgba(15,23,42,0.07)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 items-center justify-center rounded-[11px] bg-[rgba(47,111,115,0.08)] text-[var(--color-primary)]">
          {part.isError ? <XCircle className="size-4" /> : <Sparkles className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.82rem] font-semibold text-[var(--color-text)]">
            {formatToolLabel(part.toolName)}
          </p>
          {destination && (
            <p className="mt-1 text-[0.74rem] text-[var(--color-text-muted)]">{destination}</p>
          )}
          {!destination && part.argsText && (
            <p className="mt-1 line-clamp-2 text-[0.74rem] text-[var(--color-text-muted)]">
              {part.argsText}
            </p>
          )}
          {part.result && !pending && (
            <p
              className={cn(
                'mt-2 text-[0.76rem]',
                part.isError ? 'text-[rgba(196,95,79,1)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              {part.isError ? 'Tool failed' : 'Tool completed'}
            </p>
          )}
        </div>
      </div>
      {pending && (
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
      )}
    </div>
  )
}

function JobProgressCard({ part }: { part: AssistantDataPart }) {
  const action = String(part.data.action ?? 'generate')
  const requestText = String(part.data.request_text ?? 'Planner job')
  const jobStatus = String(part.data.job_status ?? 'PENDING')
  const rows = buildTimelineRows(Array.isArray(part.data.events) ? part.data.events : [])
  let previousPhase: string | null = null

  return (
    <div className="overflow-hidden rounded-[22px] border border-black/8 bg-[linear-gradient(180deg,#fffef9_0%,#f4f8f8_100%)] shadow-[0_20px_48px_rgba(15,23,42,0.09)]">
      <div className="border-b border-black/6 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-[13px] bg-[var(--color-primary)] text-white shadow-[0_10px_24px_rgba(47,111,115,0.28)]">
            {jobStatus === 'SUCCEEDED' ? (
              <Check className="size-4.5" />
            ) : jobStatus === 'FAILED' ? (
              <XCircle className="size-4.5" />
            ) : (
              <Loader2 className="size-4.5 animate-spin" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              {formatToolLabel(action)}
            </p>
            <p className="mt-1 text-[0.9rem] font-semibold text-[var(--color-text)]">
              {requestText}
            </p>
          </div>
          <div className="rounded-full bg-white/80 px-3 py-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)] ring-1 ring-black/6">
            {jobStatus}
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-[0.78rem] text-[var(--color-text-muted)]">
            <Clock3 className="size-3.5" />
            <span>Queued and waiting for worker pickup.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const showPhase = row.phase && row.phase !== previousPhase
              previousPhase = row.phase
              return (
                <div key={row.eventId} className="space-y-2">
                  {showPhase && (
                    <div className="text-[0.66rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                      {row.phase?.replace(/_/g, ' ')}
                    </div>
                  )}
                  {row.kind === 'step' && (
                    <div className="flex items-start gap-2 text-[0.8rem]">
                      <ChevronRight className="mt-[2px] size-3.5 text-[var(--color-primary)]" />
                      <div>
                        <p className="text-[var(--color-text)]">{row.name}</p>
                        {row.detail && (
                          <p className="text-[0.74rem] text-[var(--color-text-muted)]">{row.detail}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {row.kind === 'tool' && (
                    <div className="rounded-[16px] bg-white/80 px-3 py-2 ring-1 ring-black/5">
                      <p className="text-[0.78rem] font-medium text-[var(--color-text)]">
                        {formatToolLabel(row.toolName)}
                      </p>
                      {row.result && (
                        <p
                          className={cn(
                            'mt-1 text-[0.72rem]',
                            row.isError
                              ? 'text-[rgba(196,95,79,1)]'
                              : 'text-[var(--color-text-muted)]',
                          )}
                        >
                          {row.isError ? 'Returned an error.' : 'Completed.'}
                        </p>
                      )}
                    </div>
                  )}
                  {row.kind === 'done' && (
                    <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-text)]">
                      {row.status === 'SUCCEEDED' ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="size-3.5 text-[rgba(196,95,79,1)]" />
                      )}
                      <span>{row.status === 'SUCCEEDED' ? 'Planner updated.' : 'Generation failed.'}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
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
    <div className="flex justify-end pb-4">
      <div className="max-w-[85%] rounded-[20px] rounded-br-[8px] bg-[linear-gradient(135deg,var(--color-primary)_0%,#5f8f90_100%)] px-4 py-3 text-white shadow-[0_18px_40px_rgba(47,111,115,0.28)]">
        <p className="text-[0.84rem] leading-6">{text}</p>
      </div>
    </div>
  )
}

function AssistantMessageView() {
  const state = useMessage()
  const parts = state.content as AssistantMessagePart[]
  const messageId = state.id

  return (
    <div className="pb-4">
      <div className="mb-2 flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        <span className="flex size-7 items-center justify-center rounded-full bg-[rgba(47,111,115,0.08)] text-[var(--color-primary)]">
          <Bot className="size-3.5" />
        </span>
        <span>Voyager Assistant</span>
        {state.status?.type === 'running' && <Loader2 className="size-3 animate-spin text-[var(--color-primary)]" />}
      </div>
      <div className="space-y-3">
        {parts.map((part, index) => {
          if (isTextPart(part)) {
            return <TextBlock key={`${messageId}-text-${index}`} text={part.text} />
          }
          if (isToolPart(part)) {
            return <ToolCard key={`${messageId}-tool-${part.toolCallId}-${index}`} part={part} messageId={messageId} />
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
    </div>
  )
}

interface PlannerAssistantPanelProps {
  tripId: string
  destination: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function PlannerAssistantPanel({
  tripId,
  destination,
  isOpen,
  onOpenChange,
}: PlannerAssistantPanelProps) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useAssistantThread(tripId)
  const [draft, setDraft] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const messages = data?.messages ?? []

  const cancelCurrentStream = async () => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }

  const startStream = async (payload: { text?: string; confirmation?: { message_id: string; tool_call_id: string; confirmed: boolean } }) => {
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)
    setStreamError(null)

    try {
      await streamAssistantMessages(
        tripId,
        payload.text
          ? { client_message_id: crypto.randomUUID(), text: payload.text }
          : { confirmation: payload.confirmation },
        (event) => {
          if (event.type === 'message_upsert') {
            upsertAssistantMessages(queryClient, tripId, [event.message])
          } else if (event.type === 'error') {
            setStreamError(event.error.message)
            toast.error(event.error.message)
          }
        },
        controller.signal,
      )
      await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const message = (error as Error).message || 'Failed to reach the planner assistant'
        setStreamError(message)
        toast.error(message)
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setIsStreaming(false)
    }
  }

  const handleSend = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    const optimisticMessage: AssistantMessage = {
      id: crypto.randomUUID(),
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
    setDraft('')
    onOpenChange(true)
    await startStream({ text: trimmed })
  }

  const confirmToolCall = async (messageId: string, toolCallId: string, confirmed: boolean) => {
    if (isStreaming) return
    await startStream({
      confirmation: {
        message_id: messageId,
        tool_call_id: toolCallId,
        confirmed,
      },
    })
  }

  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages,
    isRunning: isStreaming,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const text = extractAppendText(message)
      await handleSend(text)
    },
    onCancel: cancelCurrentStream,
  })

  return (
    <PlannerAssistantContext.Provider value={{ confirmToolCall }}>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full max-w-[31rem] flex-col gap-0 border-l border-black/8 bg-[radial-gradient(circle_at_top,#ffffff_0%,#fbfaf6_44%,#f2f5f5_100%)] p-0 sm:max-w-[31rem]"
        >
          <SheetHeader className="border-b border-black/6 px-5 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-11 items-center justify-center rounded-[14px] bg-[var(--color-primary)] text-white shadow-[0_18px_40px_rgba(47,111,115,0.24)]">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-left text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                  Planner Assistant
                </SheetTitle>
                <SheetDescription className="mt-1 flex items-center gap-1.5 text-[0.8rem] text-[var(--color-text-muted)]">
                  <MapPin className="size-3.5" />
                  <span>{destination || 'Current trip'}</span>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <AssistantRuntimeProvider runtime={runtime}>
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full px-5 py-5">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-[0.82rem] text-[var(--color-text-muted)]">
                    <Loader2 className="size-4 animate-spin text-[var(--color-primary)]" />
                    <span>Loading assistant thread…</span>
                  </div>
                ) : (
                  <ThreadPrimitive.Root className="flex flex-col gap-0">
                    <ThreadPrimitive.Viewport className="flex flex-col">
                      <ThreadPrimitive.Messages
                        components={{
                          UserMessage,
                          AssistantMessage: AssistantMessageView,
                        }}
                      />
                    </ThreadPrimitive.Viewport>
                  </ThreadPrimitive.Root>
                )}
              </ScrollArea>
            </div>
          </AssistantRuntimeProvider>

          <div className="border-t border-black/6 bg-white/75 px-5 py-4 backdrop-blur-sm">
            {streamError && (
              <div className="mb-3 rounded-[14px] border border-[rgba(196,95,79,0.18)] bg-[rgba(196,95,79,0.06)] px-3 py-2 text-[0.76rem] text-[rgba(196,95,79,1)]">
                {streamError}
              </div>
            )}
            <div className="rounded-[22px] border border-black/8 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask about this trip, edit the plan, or queue itinerary work…"
                className="min-h-[96px] resize-none border-0 bg-transparent px-3 py-2 text-[0.88rem] shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void handleSend(draft)
                  }
                }}
              />
              <div className="flex items-center justify-between px-2 pb-1 pt-2">
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Cmd/Ctrl + Enter to send
                </p>
                <div className="flex items-center gap-2">
                  {isStreaming && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-full px-4"
                      onClick={() => void cancelCurrentStream()}
                    >
                      <X className="mr-1.5 size-3.5" />
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 rounded-full px-4"
                    onClick={() => void handleSend(draft)}
                    disabled={isStreaming || !draft.trim()}
                  >
                    {isStreaming ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 size-3.5" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
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

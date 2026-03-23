import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  History,
  Loader2,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  clearAssistantThreadMessages as clearAssistantThreadMessagesRequest,
  mirrorAssistantJob,
  streamAssistantMessages,
} from '@/entities/assistant/api';
import {
  appendAssistantJobProgressEvent,
  replaceAssistantMessages,
  upsertAssistantMessages,
} from '@/entities/assistant/cache';
import { assistantKeys, useAssistantThread } from '@/entities/assistant/queries';
import { streamJobProgress } from '@/entities/job/api';
import { plannerKeys } from '@/entities/planner/queries';
import { isApiError } from '@/shared/api/client';
import type {
  AssistantMessage,
  AssistantMessageStreamInput,
  JobProgressEvent,
} from '@/shared/api/types';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { cn } from '@/shared/lib/cn';
import { parsePlannerAssistantCommand } from './commands';
import {
  PlannerGenerationInlineCard,
  type PlannerGenerationAction,
  type PlannerGenerationFormValues,
} from '@/widgets/planner-board/GenerationControls';
import type {
  PlannerAssistantPanelProps,
  PlannerAssistantSuggestedPlace,
  SavedConversation,
  SubmitPlannerAssistantInputResult,
} from './assistant.types';
export type { PlannerAssistantSuggestedPlace };
import { PlannerAssistantContext } from './assistant.context';
import {
  MAX_INPUT_LENGTH,
  SUBMIT_COOLDOWN_MS,
  loadSavedConversations,
  persistSavedConversations,
  loadHiddenIds,
  persistHiddenIds,
} from './assistant.storage';
import {
  stripControlCharacters,
  isJobProgressPart,
  toThreadMessage,
  extractAppendText,
  toInlineError,
} from './assistant.utils';
import {
  PlannerAssistantEmptyState,
  PlannerAssistantComposer,
  UserMessage,
  AssistantMessageView,
} from './AssistantComposer';

function removeAssistantMessage(queryClient: QueryClient, tripId: string, messageId: string) {
  queryClient.setQueryData(assistantKeys.thread(tripId), (current: unknown) => {
    if (!current || typeof current !== 'object') {
      return current;
    }
    const thread = current as { messages?: AssistantMessage[] };
    if (!Array.isArray(thread.messages)) {
      return current;
    }
    return {
      ...thread,
      messages: thread.messages.filter((message) => message.id !== messageId),
    };
  });
}

export function PlannerAssistantPanel({
  tripId,
  destination,
  days,
  hasActivities,
  isOpen,
  requestedInlineAction,
  onRequestedInlineActionHandled,
  onSubmitInlineAction,
  isPlannerActionPending,
  onOpenChange,
  onSelectSuggestedPlace,
}: PlannerAssistantPanelProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { data, isLoading } = useAssistantThread(tripId);
  const [inlineAction, setInlineAction] = useState<PlannerGenerationAction | null>(null);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobStreamControllersRef = useRef(new Map<string, AbortController>());
  const ignoredJobResumeIdsRef = useRef(new Set<string>());
  const handledRequestedInlineActionRef = useRef<PlannerGenerationAction | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSubmitTimeRef = useRef(0);
  const [discussionName, setDiscussionName] = useState(
    () => localStorage.getItem(`assistant-discussion-${tripId}`) ?? '',
  );
  const [isRenamingDiscussion, setIsRenamingDiscussion] = useState(false);
  const [renameInputValue, setRenameInputValue] = useState('');
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>(() =>
    loadSavedConversations(tripId),
  );
  const [viewingConvId, setViewingConvId] = useState<string | null>(null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() =>
    loadHiddenIds(tripId),
  );

  const liveMessages = data?.messages ?? [];
  // Filter out messages that belong to a previously archived conversation.
  // We cannot clear the React Query cache (staleTime: 0 causes immediate refetch
  // from the backend), so we track hidden IDs in localStorage instead.
  const currentLiveMessages = useMemo(
    () => liveMessages.filter((m) => !hiddenMessageIds.has(m.id)),
    [liveMessages, hiddenMessageIds],
  );
  const displayMessages =
    viewingConvId !== null
      ? (savedConversations.find((c) => c.id === viewingConvId)?.messages ?? [])
      : currentLiveMessages;
  const runningJobIds = useMemo(() => {
    return Array.from(
      new Set(
        currentLiveMessages.flatMap((message) => {
          if (
            message.role !== 'assistant' ||
            message.status !== 'running' ||
            !message.source_job_id ||
            !message.parts.some((part) => isJobProgressPart(part))
          ) {
            return [];
          }
          return [message.source_job_id];
        }),
      ),
    );
  }, [currentLiveMessages]);

  useEffect(() => {
    if (!requestedInlineAction) {
      handledRequestedInlineActionRef.current = null;
      return;
    }
    if (handledRequestedInlineActionRef.current === requestedInlineAction) {
      return;
    }
    handledRequestedInlineActionRef.current = requestedInlineAction;
    setInlineAction(requestedInlineAction);
    if (!isOpen) {
      onOpenChange(true);
    }
    onRequestedInlineActionHandled();
  }, [isOpen, onOpenChange, onRequestedInlineActionHandled, requestedInlineAction]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (isMobile || !isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, isOpen, onOpenChange]);

  useEffect(() => {
    const controllerMap = jobStreamControllersRef.current;
    const activeJobIds = new Set(runningJobIds);
    // Note: intentionally NOT cleaning up ignoredJobResumeIdsRef here.
    // After a 'done' event, invalidateQueries causes the thread to refetch
    // which may temporarily restore 'running' status from the backend before
    // the server-side update propagates. Cleaning up the ignored set during
    // this window causes the stream to restart, creating an infinite loop.

    for (const [jobId, controller] of controllerMap.entries()) {
      if (!activeJobIds.has(jobId)) {
        controller.abort();
        controllerMap.delete(jobId);
      }
    }

    for (const jobId of activeJobIds) {
      if (ignoredJobResumeIdsRef.current.has(jobId)) {
        continue;
      }
      if (controllerMap.has(jobId)) {
        continue;
      }

      const controller = new AbortController();
      controllerMap.set(jobId, controller);

      void streamJobProgress(
        jobId,
        (event: JobProgressEvent) => {
          appendAssistantJobProgressEvent(queryClient, tripId, jobId, event);
          if (event.type === 'done') {
            ignoredJobResumeIdsRef.current.add(jobId);
            controller.abort();
            // Invalidate planner immediately to show new activities
            void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
            // Delay thread invalidation: the backend may not have committed the
            // updated message status yet, so an immediate refetch would overwrite
            // the local 'complete' status we just applied above and make the card
            // appear frozen (spinner never stops). Give the backend a few seconds.
            window.setTimeout(() => {
              void queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) });
            }, 4000);
          }
        },
        controller.signal,
      )
        .catch((error) => {
          if ((error as Error)?.name === 'AbortError') {
            return;
          }
          if (isApiError(error) && error.status === 404) {
            ignoredJobResumeIdsRef.current.add(jobId);
            return;
          }
          setStreamError(
            (current) => current ?? toInlineError(error, 'Failed to resume planner job progress.'),
          );
        })
        .finally(() => {
          if (controllerMap.get(jobId) === controller) {
            controllerMap.delete(jobId);
          }
        });
    }
  }, [queryClient, runningJobIds, tripId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      for (const controller of jobStreamControllersRef.current.values()) {
        controller.abort();
      }
      jobStreamControllersRef.current.clear();
    };
  }, []);

  const cancelCurrentStream = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const resetAssistantConversation = useCallback(async () => {
    await cancelCurrentStream();
    for (const controller of jobStreamControllersRef.current.values()) {
      controller.abort();
    }
    jobStreamControllersRef.current.clear();
    ignoredJobResumeIdsRef.current.clear();
    await clearAssistantThreadMessagesRequest(tripId);
    replaceAssistantMessages(queryClient, tripId, []);
    const clearedHiddenIds = new Set<string>();
    setHiddenMessageIds(clearedHiddenIds);
    persistHiddenIds(tripId, clearedHiddenIds);
    setStreamError(null);
    await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) });
  }, [cancelCurrentStream, queryClient, tripId]);

  const startStream = useCallback(
    async (payload: AssistantMessageStreamInput, optimisticMessageId?: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStreamError(null);

      try {
        await streamAssistantMessages(
          tripId,
          payload,
          (event) => {
            if (event.type === 'message_upsert') {
              upsertAssistantMessages(queryClient, tripId, [event.message]);
              return;
            }
            if (event.type === 'error') {
              setStreamError(event.error.message);
            }
          },
          controller.signal,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) }),
          queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) }),
        ]);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return;
        }
        if (optimisticMessageId) {
          removeAssistantMessage(queryClient, tripId, optimisticMessageId);
        }
        setStreamError(toInlineError(error, 'Failed to reach the planner assistant.'));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [queryClient, tripId],
  );

  const handleTextTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) {
        return;
      }

      // Rate limit: prevent rapid successive messages
      const now = Date.now();
      if (now - lastSubmitTimeRef.current < SUBMIT_COOLDOWN_MS) {
        setStreamError('Please wait a moment before sending another message.');
        return;
      }

      // Length limit
      if (trimmed.length > MAX_INPUT_LENGTH) {
        setStreamError(`Message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`);
        return;
      }

      // Strip null bytes and dangerous control characters (basic injection protection)
      const sanitized = stripControlCharacters(trimmed).trim();
      if (!sanitized) {
        return;
      }

      // Warn on obvious prompt injection patterns
      const injectionPatterns = [
        /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
        /you\s+are\s+now\s+a/i,
        /disregard\s+(all\s+)?(previous|prior)/i,
        /system\s*:\s*[^\n]{0,100}/i,
      ];
      if (injectionPatterns.some((p) => p.test(sanitized))) {
        setStreamError(
          'This message contains patterns that are not allowed. Please rephrase your request.',
        );
        return;
      }

      lastSubmitTimeRef.current = now;
      const clientMessageId = crypto.randomUUID();
      const optimisticMessage: AssistantMessage = {
        id: clientMessageId,
        thread_id: data?.id ?? `thread-${tripId}`,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: sanitized }],
        metadata: { kind: 'chat' },
        source_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      upsertAssistantMessages(queryClient, tripId, [optimisticMessage]);
      onOpenChange(true);

      await startStream(
        {
          client_message_id: clientMessageId,
          text: sanitized,
        },
        clientMessageId,
      );
    },
    [data?.id, isStreaming, onOpenChange, queryClient, startStream, tripId],
  );

  const handleSubmitInput = useCallback(
    async (rawInput: string): Promise<SubmitPlannerAssistantInputResult> => {
      const trimmed = rawInput.trim();
      if (!trimmed) {
        return 'noop';
      }
      if (isStreaming) {
        return 'noop';
      }

      if (!trimmed.startsWith('/')) {
        await handleTextTurn(trimmed);
        return 'sent';
      }

      const parsed = parsePlannerAssistantCommand(trimmed);
      if (!parsed) {
        return 'noop';
      }

      if (parsed.type === 'invalid') {
        setStreamError(parsed.message);
        return 'invalid';
      }

      if (parsed.type === 'inline') {
        setStreamError(null);
        setInlineAction(parsed.name);
        onOpenChange(true);
        return 'inline';
      }

      return 'noop';
    },
    [handleTextTurn, isStreaming, onOpenChange],
  );

  const handleCancelInlineAction = useCallback(() => {
    setInlineAction(null);
  }, []);

  const handleSubmitInlineAction = useCallback(
    async (
      action: PlannerGenerationAction,
      values: PlannerGenerationFormValues,
      idempotencyKey: string,
    ) => {
      try {
        await onSubmitInlineAction(action, values, idempotencyKey);
        setInlineAction(null);
      } catch {
        // planner mutations already surface toast errors upstream
      }
    },
    [onSubmitInlineAction],
  );

  const confirmToolCall = useCallback(
    async (messageId: string, toolCallId: string, confirmed: boolean) => {
      if (isStreaming) {
        return;
      }
      await startStream({
        confirmation: {
          message_id: messageId,
          tool_call_id: toolCallId,
          confirmed,
        },
      });
    },
    [isStreaming, startStream],
  );

  const selectSuggestedPlace = useCallback(
    (place: PlannerAssistantSuggestedPlace) => {
      onSelectSuggestedPlace?.(place);
    },
    [onSelectSuggestedPlace],
  );

  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages: displayMessages,
    isRunning: isStreaming && viewingConvId === null,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const text = extractAppendText(message);
      await handleSubmitInput(text);
    },
    onCancel: cancelCurrentStream,
  });

  const handleRenameDiscussion = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      setDiscussionName(trimmedName);
      if (trimmedName) {
        localStorage.setItem(`assistant-discussion-${tripId}`, trimmedName);
      } else {
        localStorage.removeItem(`assistant-discussion-${tripId}`);
      }
      setIsRenamingDiscussion(false);
    },
    [tripId],
  );

  const handleClearConversation = useCallback(async () => {
    try {
      await resetAssistantConversation();
    } catch (error) {
      setStreamError(toInlineError(error, 'Failed to clear this conversation.'));
    }
  }, [resetAssistantConversation]);

  const handleNewConversation = useCallback(async () => {
    if (currentLiveMessages.length > 0) {
      const conv: SavedConversation = {
        id: crypto.randomUUID(),
        name:
          discussionName ||
          new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        messages: currentLiveMessages,
        savedAt: new Date().toISOString(),
      };
      const updated = [conv, ...savedConversations];
      setSavedConversations(updated);
      persistSavedConversations(tripId, updated);
    }
    try {
      await resetAssistantConversation();
    } catch (error) {
      setStreamError(toInlineError(error, 'Failed to start a new conversation.'));
      return;
    }
    setViewingConvId(null);
    setDiscussionName('');
    localStorage.removeItem(`assistant-discussion-${tripId}`);
  }, [currentLiveMessages, discussionName, resetAssistantConversation, savedConversations, tripId]);

  const handleSwitchConversation = useCallback((convId: string | null) => {
    setViewingConvId(convId);
  }, []);

  const handleDeleteSavedConversation = useCallback(
    (convId: string) => {
      const updated = savedConversations.filter((c) => c.id !== convId);
      setSavedConversations(updated);
      persistSavedConversations(tripId, updated);
      if (viewingConvId === convId) {
        setViewingConvId(null);
      }
    },
    [savedConversations, viewingConvId, tripId],
  );

  const assistantSurface = (
    <>
      <div className="border-b border-[var(--color-border)] px-3 py-3 text-left">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            {viewingConvId !== null ? (
              <h2 className="text-left text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text-muted)]">
                {savedConversations.find((c) => c.id === viewingConvId)?.name ?? 'Archived'}
              </h2>
            ) : isRenamingDiscussion ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRenameDiscussion(renameInputValue);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  value={renameInputValue}
                  onChange={(e) => setRenameInputValue(e.target.value)}
                  onBlur={() => handleRenameDiscussion(renameInputValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsRenamingDiscussion(false);
                    }
                  }}
                  placeholder="Conversation name…"
                  className="min-w-0 flex-1 rounded-[12px] border border-[var(--color-border)] bg-white px-2 py-0.5 text-[0.84rem] font-semibold tracking-[-0.02em] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                />
              </form>
            ) : (
              <h2 className="text-left text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                {discussionName || 'Planner Assistant'}
              </h2>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.74rem] text-[var(--color-text-muted)]">
              <MapPin className="size-3.5" />
              <span>{destination || 'Current trip'}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-full border-[var(--color-border)] bg-white/78 text-[var(--color-text-muted)]"
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Conversation options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[210px]">
                <DropdownMenuItem onClick={() => void handleNewConversation()}>
                  <MessageSquarePlus className="mr-2 size-3.5" />
                  New conversation
                </DropdownMenuItem>

                {savedConversations.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <p className="px-2 py-1.5 text-[0.67rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Saved
                    </p>
                    {savedConversations.map((conv) => (
                      <DropdownMenuItem
                        key={conv.id}
                        onClick={() => handleSwitchConversation(conv.id)}
                        className={cn(
                          'flex items-center',
                          viewingConvId === conv.id && 'text-[var(--color-primary)]',
                        )}
                      >
                        <History className="mr-2 size-3.5 shrink-0" />
                        <span className="flex-1 truncate">{conv.name}</span>
                        {viewingConvId === conv.id ? (
                          <Check className="ml-2 size-3.5 shrink-0" />
                        ) : (
                          <button
                            type="button"
                            className="ml-2 shrink-0 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[rgba(255,81,14,1)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSavedConversation(conv.id);
                            }}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setRenameInputValue(discussionName);
                    setIsRenamingDiscussion(true);
                  }}
                  disabled={viewingConvId !== null}
                >
                  <Pencil className="mr-2 size-3.5" />
                  Rename conversation
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-[rgba(255,81,14,1)] focus:text-[rgba(255,81,14,1)]"
                  onClick={() => void handleClearConversation()}
                  disabled={viewingConvId !== null}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  Clear messages
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-full border-[var(--color-border)] bg-white/78 text-[var(--color-text-muted)]"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
              <span className="sr-only">Close assistant</span>
            </Button>
          </div>
        </div>
      </div>

      {viewingConvId !== null ? (
        <div className="flex items-center justify-between border-b border-[var(--color-gold)]/20 bg-[var(--color-gold)]/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[0.73rem] text-[var(--color-warning)]/90">
            <History className="size-3.5" />
            <span>Viewing archived conversation</span>
          </div>
          <button
            type="button"
            className="text-[0.73rem] font-medium text-[var(--color-primary)] hover:underline"
            onClick={() => handleSwitchConversation(null)}
          >
            Return to live
          </button>
        </div>
      ) : null}

      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">
              <Loader2 className="mr-2 size-4 animate-spin text-[var(--color-primary)]" />
              <span>Loading assistant thread…</span>
            </div>
          ) : (
            <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <ThreadPrimitive.Viewport
                autoScroll
                className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pt-3"
              >
                <ThreadPrimitive.Empty>
                  <PlannerAssistantEmptyState
                    destination={destination}
                    hasActivities={hasActivities}
                  />
                </ThreadPrimitive.Empty>

                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage: AssistantMessageView,
                  }}
                />

                {inlineAction ? (
                  <div className="pb-2.5">
                    <PlannerGenerationInlineCard
                      key={inlineAction}
                      action={inlineAction}
                      days={days}
                      isSubmitting={isPlannerActionPending}
                      onCancel={handleCancelInlineAction}
                      onSubmit={handleSubmitInlineAction}
                    />
                  </div>
                ) : null}
              </ThreadPrimitive.Viewport>
              {viewingConvId !== null ? (
                <div className="border-t border-[var(--color-border)] bg-[#fcfcfb] px-3 py-3">
                  <button
                    type="button"
                    className="w-full rounded-[24px] border border-[var(--color-border)] bg-white px-4 py-3 text-[0.84rem] text-[var(--color-text-muted)] transition-colors hover:bg-[#faf8f4]"
                    onClick={() => handleSwitchConversation(null)}
                  >
                    Return to live thread to send messages
                  </button>
                </div>
              ) : (
                <PlannerAssistantComposer
                  hasActivities={hasActivities}
                  draft={draft}
                  setDraft={setDraft}
                  isStreaming={isStreaming}
                  streamError={streamError}
                  setStreamError={setStreamError}
                  textareaRef={textareaRef}
                  onRequestInlineAction={(action) => {
                    setInlineAction(action);
                    onOpenChange(true);
                  }}
                  onSubmitInput={handleSubmitInput}
                />
              )}
            </ThreadPrimitive.Root>
          )}
        </div>
      </AssistantRuntimeProvider>
    </>
  );

  return (
    <PlannerAssistantContext.Provider value={{ confirmToolCall, selectSuggestedPlace }}>
      {isMobile ? (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            hideCloseButton={true}
            className="flex h-[min(88vh,48rem)] w-full flex-col gap-0 overflow-hidden rounded-t-[28px] border-x-0 border-b-0 border-[var(--color-border)] bg-[#fcfcfb] p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Planner Assistant</SheetTitle>
              <SheetDescription>{destination || 'Current trip'}</SheetDescription>
            </SheetHeader>
            {assistantSurface}
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {isOpen ? (
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
              className="absolute inset-y-0 left-0 z-40 flex w-full lg:w-[clamp(380px,46vw,500px)] max-w-full flex-col overflow-hidden border-r border-[var(--color-border)] bg-[#fcfcfb]"
            >
              {assistantSurface}
            </motion.aside>
          ) : null}
        </AnimatePresence>
      )}
    </PlannerAssistantContext.Provider>
  );
}

type MirrorPlannerJobOptions = {
  tripId: string;
  jobId: string;
  requestText: string;
  action: string;
};

export async function mirrorPlannerJobToAssistant(
  queryClient: QueryClient,
  options: MirrorPlannerJobOptions,
) {
  const messages = await mirrorAssistantJob(options.tripId, {
    job_id: options.jobId,
    request_text: options.requestText,
    action: options.action,
  });
  upsertAssistantMessages(queryClient, options.tripId, messages);
  await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(options.tripId) });
}

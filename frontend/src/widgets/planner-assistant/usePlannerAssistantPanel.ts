import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  clearAssistantThreadMessages as clearAssistantThreadMessagesRequest,
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
import type {
  PlannerAssistantPanelProps,
  PlannerAssistantSuggestedPlace,
  SubmitPlannerAssistantInputResult,
} from './assistant.types';
import { loadHiddenIds, persistHiddenIds } from './assistant.storage';
import { parsePlannerAssistantCommand } from './commands';
import {
  extractAppendText,
  isJobProgressPart,
  toInlineError,
  toThreadMessage,
} from './assistant.utils';
import {
  getAssistantInputError,
  removeAssistantMessage,
  sanitizeAssistantInput,
  scheduleAssistantThreadRefresh,
} from './planner-assistant-panel.utils';
import { usePlannerAssistantConversations } from './usePlannerAssistantConversations';

type UsePlannerAssistantPanelOptions = Pick<
  PlannerAssistantPanelProps,
  | 'tripId'
  | 'isOpen'
  | 'requestedInlineAction'
  | 'onRequestedInlineActionHandled'
  | 'onSubmitInlineAction'
  | 'onOpenChange'
  | 'onSelectSuggestedPlace'
>;

export function usePlannerAssistantPanel({
  tripId,
  isOpen,
  requestedInlineAction,
  onRequestedInlineActionHandled,
  onSubmitInlineAction,
  onOpenChange,
  onSelectSuggestedPlace,
}: UsePlannerAssistantPanelOptions) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useAssistantThread(tripId);
  const [inlineAction, setInlineAction] = useState<PlannerAssistantPanelProps['requestedInlineAction']>(null);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobStreamControllersRef = useRef(new Map<string, AbortController>());
  const settledJobResumeIdsRef = useRef(new Set<string>());
  const handledRequestedInlineActionRef = useRef<PlannerAssistantPanelProps['requestedInlineAction']>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSubmitTimeRef = useRef(0);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() =>
    loadHiddenIds(tripId),
  );

  const liveMessages = data?.messages ?? [];
  const visibleLiveMessages = useMemo(
    () => liveMessages.filter((message) => !hiddenMessageIds.has(message.id)),
    [hiddenMessageIds, liveMessages],
  );
  const runningJobIds = useMemo(
    () =>
      Array.from(
        new Set(
          visibleLiveMessages.flatMap((message) => {
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
      ),
    [visibleLiveMessages],
  );

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
    settledJobResumeIdsRef.current.clear();
    await clearAssistantThreadMessagesRequest(tripId);
    replaceAssistantMessages(queryClient, tripId, []);
    const clearedHiddenIds = new Set<string>();
    setHiddenMessageIds(clearedHiddenIds);
    persistHiddenIds(tripId, clearedHiddenIds);
    setStreamError(null);
    await queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) });
  }, [cancelCurrentStream, queryClient, tripId]);

  const {
    currentArchivedConversation,
    discussionName,
    displayMessages,
    handleClearConversation,
    handleDeleteSavedConversation,
    handleNewConversation,
    handleRenameDiscussion,
    handleStartRenamingDiscussion,
    handleSwitchConversation,
    isRenamingDiscussion,
    renameInputValue,
    savedConversations,
    setIsRenamingDiscussion,
    setRenameInputValue,
    viewingConvId,
  } = usePlannerAssistantConversations({
    tripId,
    visibleLiveMessages,
    resetAssistantConversation,
    setStreamError,
  });

  const handleResumedJobCompletion = useCallback(
    (jobId: string, controller: AbortController) => {
      settledJobResumeIdsRef.current.add(jobId);
      controller.abort();
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      scheduleAssistantThreadRefresh(queryClient, tripId);
    },
    [queryClient, tripId],
  );

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
    const controllerMap = jobStreamControllersRef.current;
    const activeJobIds = new Set(runningJobIds);

    for (const [jobId, controller] of controllerMap.entries()) {
      if (!activeJobIds.has(jobId)) {
        controller.abort();
        controllerMap.delete(jobId);
      }
    }

    for (const jobId of activeJobIds) {
      if (settledJobResumeIdsRef.current.has(jobId) || controllerMap.has(jobId)) {
        continue;
      }

      const controller = new AbortController();
      controllerMap.set(jobId, controller);

      void streamJobProgress(
        jobId,
        (event: JobProgressEvent) => {
          appendAssistantJobProgressEvent(queryClient, tripId, jobId, event);
          if (event.type === 'done') {
            handleResumedJobCompletion(jobId, controller);
          }
        },
        controller.signal,
      )
        .catch((error) => {
          if ((error as Error)?.name === 'AbortError') {
            return;
          }
          if (isApiError(error) && error.status === 404) {
            settledJobResumeIdsRef.current.add(jobId);
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
  }, [handleResumedJobCompletion, queryClient, runningJobIds, tripId]);

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

      const now = Date.now();
      const sanitized = sanitizeAssistantInput(trimmed);
      if (!sanitized) {
        return;
      }

      const validationError = getAssistantInputError(
        trimmed,
        sanitized,
        now,
        lastSubmitTimeRef.current,
      );
      if (validationError) {
        setStreamError(validationError);
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
      if (!trimmed || isStreaming) {
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
      action: NonNullable<PlannerAssistantPanelProps['requestedInlineAction']>,
      values: Parameters<PlannerAssistantPanelProps['onSubmitInlineAction']>[1],
      idempotencyKey: string,
    ) => {
      try {
        await onSubmitInlineAction(action, values, idempotencyKey);
        setInlineAction(null);
      } catch {}
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

  const handleCloseAssistant = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleRequestInlineAction = useCallback(
    (action: NonNullable<PlannerAssistantPanelProps['requestedInlineAction']>) => {
      setInlineAction(action);
      onOpenChange(true);
    },
    [onOpenChange],
  );

  return {
    contextValue: {
      confirmToolCall,
      selectSuggestedPlace,
    },
    currentArchivedConversation,
    discussionName,
    draft,
    handleCancelInlineAction,
    handleClearConversation,
    handleCloseAssistant,
    handleDeleteSavedConversation,
    handleNewConversation,
    handleRenameDiscussion,
    handleRequestInlineAction,
    handleStartRenamingDiscussion,
    handleSubmitInlineAction,
    handleSubmitInput,
    handleSwitchConversation,
    inlineAction,
    isLoading,
    isRenamingDiscussion,
    isStreaming,
    renameInputValue,
    runtime,
    savedConversations,
    setDraft,
    setIsRenamingDiscussion,
    setRenameInputValue,
    setStreamError,
    streamError,
    textareaRef,
    viewingConvId,
  };
}

import { useCallback, useMemo, useState } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Loader2, Slash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/ui/prompt-input';
import type { AssistantMessagePart } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import type {
  PlannerAssistantCommandDefinition,
  PlannerAssistantInlineCommand,
} from './commands';
import type { SubmitPlannerAssistantInputResult } from './assistant.types';
import {
  getAvailableCommandSuggestions,
  isDataPart,
  isPlannerMutationOperation,
  isTextPart,
  isToolPart,
} from './assistant.utils';
import { MAX_INPUT_LENGTH } from './assistant.storage';
import { TextBlock, ToolCard, PlannerResultCard } from './AssistantMessageParts';
import { JobProgressCard } from './JobProgressCard';

export function EmptyThreadState({
  destination,
  hasActivities,
}: {
  destination: string;
  hasActivities: boolean;
}) {
  return (
    <div className="flex min-h-[12rem] flex-col justify-center px-1 pt-1 pb-3">
      <div className="flex gap-2 pb-2.5">
        <div className="min-w-0 flex-1 mt-3">
          <div className="rounded-[18px] rounded-tl-[8px] bg-white px-3 py-2.5 border border-[var(--color-border)]">
            <p className="text-[0.84rem] leading-7 text-[var(--color-text)]">
              I can help shape <span className="font-semibold">{destination || 'this trip'}</span>.
              Ask me to add places, rebalance a day, or use{' '}
              <span className="font-medium">/generate</span>
              {hasActivities ? ' or /reset' : ''}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlannerAssistantEmptyState({
  destination,
  hasActivities,
}: {
  destination: string;
  hasActivities: boolean;
}) {
  return <EmptyThreadState destination={destination} hasActivities={hasActivities} />;
}

export function PlannerAssistantComposer({
  hasActivities,
  draft,
  setDraft,
  isStreaming,
  streamError,
  setStreamError,
  textareaRef,
  onRequestInlineAction,
  onSubmitInput,
}: {
  hasActivities: boolean;
  draft: string;
  setDraft: (value: string) => void;
  isStreaming: boolean;
  streamError: string | null;
  setStreamError: (error: string | null) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  onRequestInlineAction: (action: PlannerAssistantInlineCommand) => void;
  onSubmitInput: (rawInput: string) => Promise<SubmitPlannerAssistantInputResult>;
}) {
  const [commandMenuForcedOpen, setCommandMenuForcedOpen] = useState(false);
  const commandSuggestions = useMemo(
    () =>
      getAvailableCommandSuggestions(
        draft.trimStart().startsWith('/') ? draft : '/',
        hasActivities,
      ),
    [draft, hasActivities],
  );

  const isCommandMenuVisible = commandMenuForcedOpen || draft.trimStart().startsWith('/');

  const handleCommandAction = useCallback(
    (command: PlannerAssistantCommandDefinition) => {
      setStreamError(null);
      setCommandMenuForcedOpen(false);
      setDraft('');
      onRequestInlineAction(command.name as PlannerAssistantInlineCommand);
    },
    [onRequestInlineAction, setDraft, setStreamError],
  );

  const submitComposer = useCallback(async () => {
    const submission = draft;
    if (!submission.trim()) {
      return;
    }

    setDraft('');
    setCommandMenuForcedOpen(false);
    setStreamError(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    const result = await onSubmitInput(submission);

    if (result === 'invalid' || result === 'noop') {
      setDraft(submission);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [draft, onSubmitInput, setDraft, setStreamError, textareaRef]);

  return (
    <div className="border-t border-[var(--color-border)] bg-[#fcfcfb] px-3 py-3">
      {streamError ? (
        <div className="mb-2 rounded-[14px] border border-[rgba(255,81,14,0.18)] bg-[rgba(255,81,14,0.06)] px-3 py-2 text-[0.75rem] text-[rgba(255,81,14,1)]">
          {streamError}
        </div>
      ) : null}

      <div className="relative">
        <AnimatePresence>
          {isCommandMenuVisible ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute inset-x-0 bottom-full z-10 mb-2"
            >
              <Command className="overflow-hidden rounded-[20px] border border-[var(--color-border)] bg-white">
                <CommandList className="max-h-[13rem] p-1.5">
                  <CommandEmpty>No matching commands.</CommandEmpty>
                  <CommandGroup heading="Commands">
                    {commandSuggestions.map((command) => (
                      <CommandItem
                        key={command.name}
                        value={command.name}
                        onSelect={() => handleCommandAction(command)}
                        className="items-start rounded-[14px] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-[0.8rem] font-medium text-[var(--color-text)]">
                            /{command.name}
                          </span>
                          <p className="mt-1 text-[0.73rem] leading-5 text-[var(--color-text-muted)]">
                            {command.description}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <PromptInput
          value={draft}
          onValueChange={(value) => {
            if (streamError) {
              setStreamError(null);
            }
            if (!value.trimStart().startsWith('/')) {
              setCommandMenuForcedOpen(false);
            }
            setDraft(value);
          }}
          onSubmit={() => void submitComposer()}
          textareaRef={textareaRef}
          className="rounded-[24px] border-[var(--color-border)] bg-white p-0"
        >
          <PromptInputTextarea
            placeholder="Ask about this trip or type /generate…"
            className="min-h-[104px] px-4 py-3 text-[0.9rem] leading-7"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <PromptInputActions className="gap-1.5">
              <PromptInputAction tooltip="Commands">
                <Button
                  type="button"
                  size="icon"
                  className="size-8 rounded-full border border-[var(--color-border)] bg-[rgba(15,23,42,0.05)] text-[var(--color-text)] hover:bg-[rgba(15,23,42,0.09)]"
                  onClick={() => {
                    setCommandMenuForcedOpen(true);
                    textareaRef.current?.focus();
                  }}
                >
                  <Slash className="size-4" />
                </Button>
              </PromptInputAction>
            </PromptInputActions>
            <div className="flex items-center gap-2">
              {draft.length > MAX_INPUT_LENGTH * 0.8 ? (
                <span
                  className={cn(
                    'text-[0.68rem] tabular-nums',
                    draft.length > MAX_INPUT_LENGTH
                      ? 'text-[rgba(255,81,14,1)]'
                      : 'text-[var(--color-text-muted)]',
                  )}
                >
                  {draft.length}/{MAX_INPUT_LENGTH}
                </span>
              ) : null}
              <PromptInputActions className="gap-1.5">
                <PromptInputAction tooltip={isStreaming ? 'Sending' : 'Send'}>
                  <Button
                    type="button"
                    size="icon"
                    className="size-8 rounded-full bg-[#111827] text-white hover:bg-[#0f172a]"
                    disabled={isStreaming || !draft.trim() || draft.length > MAX_INPUT_LENGTH}
                    onClick={() => void submitComposer()}
                  >
                    {isStreaming ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </div>
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

export function UserMessage() {
  const state = useAuiState((s) => s.message);
  const text = state.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  return (
    <MessagePrimitive.Root className="flex justify-end pb-3">
      <div className="max-w-[85%] rounded-[20px] rounded-br-[8px] bg-[#1a1a1a] px-3.5 py-2.5 text-white">
        <p className="text-[0.85rem] leading-[1.4rem] whitespace-pre-wrap">{text}</p>
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessageView() {
  const state = useAuiState((s) => s.message);
  const parts = state.content as AssistantMessagePart[];
  const messageId = state.id;

  return (
    <MessagePrimitive.Root className="flex gap-2.5 pb-3">
      <div className="min-w-0 flex-1 space-y-2">
        {parts.map((part, index) => {
          if (isTextPart(part)) {
            return <TextBlock key={`${messageId}-text-${index}`} text={part.text} />;
          }
          if (isToolPart(part)) {
            return (
              <ToolCard
                key={`${messageId}-tool-${part.toolCallId}-${index}`}
                part={part}
                messageId={messageId}
              />
            );
          }
          if (isDataPart(part) && part.name === 'planner-result') {
            if (!isPlannerMutationOperation(part.data.operation)) {
              return null;
            }
            return <PlannerResultCard key={`${messageId}-result-${index}`} part={part} />;
          }
          if (isDataPart(part) && part.name === 'job-progress') {
            return <JobProgressCard key={`${messageId}-job-${index}`} part={part} />;
          }
          return null;
        })}
      </div>
    </MessagePrimitive.Root>
  );
}

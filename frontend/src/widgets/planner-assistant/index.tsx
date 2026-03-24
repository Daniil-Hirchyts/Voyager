import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react';
import { type QueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { mirrorAssistantJob } from '@/entities/assistant/api';
import { upsertAssistantMessages } from '@/entities/assistant/cache';
import { assistantKeys } from '@/entities/assistant/queries';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import {
  PlannerGenerationInlineCard,
} from '@/widgets/planner-board/GenerationControls';
import type { PlannerAssistantPanelProps, PlannerAssistantSuggestedPlace } from './assistant.types';
export type { PlannerAssistantSuggestedPlace };
import { PlannerAssistantContext } from './assistant.context';
import {
  PlannerAssistantEmptyState,
  PlannerAssistantComposer,
  UserMessage,
  AssistantMessageView,
} from './AssistantComposer';
import { PlannerAssistantPanelHeader } from './PlannerAssistantPanelHeader';
import { usePlannerAssistantPanel } from './usePlannerAssistantPanel';

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
  const isMobile = useIsMobile();
  const {
    contextValue,
    currentArchivedConversation,
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
    discussionName,
  } = usePlannerAssistantPanel({
    tripId,
    isOpen,
    requestedInlineAction,
    onRequestedInlineActionHandled,
    onSubmitInlineAction,
    onOpenChange,
    onSelectSuggestedPlace,
  });

  const assistantSurface = (
    <>
      <PlannerAssistantPanelHeader
        destination={destination}
        discussionName={discussionName}
        renameInputValue={renameInputValue}
        isRenamingDiscussion={isRenamingDiscussion}
        savedConversations={savedConversations}
        viewingConvId={viewingConvId}
        currentArchivedConversationName={currentArchivedConversation?.name ?? null}
        onRenameInputValueChange={setRenameInputValue}
        onRenameDiscussion={handleRenameDiscussion}
        onCancelRename={() => setIsRenamingDiscussion(false)}
        onStartRename={handleStartRenamingDiscussion}
        onNewConversation={handleNewConversation}
        onDeleteSavedConversation={handleDeleteSavedConversation}
        onSwitchConversation={handleSwitchConversation}
        onClearConversation={handleClearConversation}
        onClose={handleCloseAssistant}
      />

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
                  onRequestInlineAction={handleRequestInlineAction}
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
    <PlannerAssistantContext.Provider value={contextValue}>
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
              className="absolute inset-y-0 left-0 z-40 flex w-full max-w-full flex-col overflow-hidden border-r border-[var(--color-border)] bg-[#fcfcfb] lg:w-[clamp(380px,46vw,500px)]"
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

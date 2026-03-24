import { useCallback, useMemo, useState } from 'react';
import type { AssistantMessage } from '@/shared/api/types';
import type { SavedConversation } from './assistant.types';
import { loadSavedConversations, persistSavedConversations } from './assistant.storage';
import { toInlineError } from './assistant.utils';

type UsePlannerAssistantConversationsOptions = {
  tripId: string;
  visibleLiveMessages: AssistantMessage[];
  resetAssistantConversation: () => Promise<void>;
  setStreamError: (error: string | null) => void;
};

export function usePlannerAssistantConversations({
  tripId,
  visibleLiveMessages,
  resetAssistantConversation,
  setStreamError,
}: UsePlannerAssistantConversationsOptions) {
  const [discussionName, setDiscussionName] = useState(
    () => localStorage.getItem(`assistant-discussion-${tripId}`) ?? '',
  );
  const [isRenamingDiscussion, setIsRenamingDiscussion] = useState(false);
  const [renameInputValue, setRenameInputValue] = useState('');
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>(() =>
    loadSavedConversations(tripId),
  );
  const [viewingConvId, setViewingConvId] = useState<string | null>(null);

  const currentArchivedConversation = useMemo(
    () =>
      viewingConvId !== null
        ? (savedConversations.find((conversation) => conversation.id === viewingConvId) ?? null)
        : null,
    [savedConversations, viewingConvId],
  );
  const displayMessages = currentArchivedConversation?.messages ?? visibleLiveMessages;

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
  }, [resetAssistantConversation, setStreamError]);

  const handleNewConversation = useCallback(async () => {
    if (visibleLiveMessages.length > 0) {
      const nextConversation: SavedConversation = {
        id: crypto.randomUUID(),
        name:
          discussionName ||
          new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        messages: visibleLiveMessages,
        savedAt: new Date().toISOString(),
      };
      const updatedConversations = [nextConversation, ...savedConversations];
      setSavedConversations(updatedConversations);
      persistSavedConversations(tripId, updatedConversations);
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
  }, [discussionName, resetAssistantConversation, savedConversations, setStreamError, tripId, visibleLiveMessages]);

  const handleSwitchConversation = useCallback((convId: string | null) => {
    setViewingConvId(convId);
  }, []);

  const handleDeleteSavedConversation = useCallback(
    (convId: string) => {
      const updatedConversations = savedConversations.filter(
        (conversation) => conversation.id !== convId,
      );
      setSavedConversations(updatedConversations);
      persistSavedConversations(tripId, updatedConversations);
      if (viewingConvId === convId) {
        setViewingConvId(null);
      }
    },
    [savedConversations, tripId, viewingConvId],
  );

  const handleStartRenamingDiscussion = useCallback(() => {
    setRenameInputValue(discussionName);
    setIsRenamingDiscussion(true);
  }, [discussionName]);

  return {
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
  };
}

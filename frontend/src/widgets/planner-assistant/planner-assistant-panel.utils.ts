import { type QueryClient } from '@tanstack/react-query';
import { assistantKeys } from '@/entities/assistant/queries';
import type { AssistantMessage } from '@/shared/api/types';
import { MAX_INPUT_LENGTH, SUBMIT_COOLDOWN_MS } from './assistant.storage';
import { stripControlCharacters } from './assistant.utils';

const ASSISTANT_THREAD_INVALIDATION_DELAY_MS = 4_000;
const ASSISTANT_INPUT_BLOCK_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(all\s+)?(previous|prior)/i,
  /system\s*:\s*[^\n]{0,100}/i,
];

export function removeAssistantMessage(
  queryClient: QueryClient,
  tripId: string,
  messageId: string,
) {
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

export function sanitizeAssistantInput(text: string) {
  return stripControlCharacters(text).trim();
}

export function getAssistantInputError(
  originalText: string,
  sanitizedText: string,
  now: number,
  lastSubmittedAt: number,
) {
  if (now - lastSubmittedAt < SUBMIT_COOLDOWN_MS) {
    return 'Please wait a moment before sending another message.';
  }
  if (originalText.length > MAX_INPUT_LENGTH) {
    return `Message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`;
  }
  if (ASSISTANT_INPUT_BLOCK_PATTERNS.some((pattern) => pattern.test(sanitizedText))) {
    return 'This message contains patterns that are not allowed. Please rephrase your request.';
  }
  return null;
}

export function scheduleAssistantThreadRefresh(queryClient: QueryClient, tripId: string) {
  window.setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.thread(tripId) });
  }, ASSISTANT_THREAD_INVALIDATION_DELAY_MS);
}

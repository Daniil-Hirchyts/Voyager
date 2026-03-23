import type { AssistantMessage, Day } from '@/shared/api/types';
import type { PlannerGenerationAction, PlannerGenerationFormValues } from '@/widgets/planner-board/GenerationControls';

export type PlannerAssistantContextValue = {
  confirmToolCall: (messageId: string, toolCallId: string, confirmed: boolean) => Promise<void>;
  selectSuggestedPlace: (place: PlannerAssistantSuggestedPlace) => void;
};

export type PlannerAssistantPanelProps = {
  tripId: string;
  destination: string;
  days: Day[];
  hasActivities: boolean;
  isOpen: boolean;
  requestedInlineAction: PlannerGenerationAction | null;
  onRequestedInlineActionHandled: () => void;
  onSubmitInlineAction: (
    action: PlannerGenerationAction,
    values: PlannerGenerationFormValues,
    idempotencyKey: string,
  ) => Promise<void>;
  isPlannerActionPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSuggestedPlace?: (place: PlannerAssistantSuggestedPlace) => void;
};

export type PlannerAssistantSuggestedPlace = {
  placeId: string;
  name: string;
  label: string | null;
  addressText: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
};

export type SavedConversation = {
  id: string;
  name: string;
  messages: AssistantMessage[];
  savedAt: string;
};

export type JobTimelineRow =
  | {
      kind: 'step';
      phase: string | null;
      eventId: string;
      name: string;
      detail: string;
    }
  | {
      kind: 'tool';
      phase: string | null;
      eventId: string;
      toolName: string;
      callId: string | null;
      args: Record<string, unknown>;
      result?: Record<string, unknown>;
      isError?: boolean;
    }
  | {
      kind: 'done';
      phase: string | null;
      eventId: string;
      status: string;
      summary?: Record<string, unknown>;
    };

export type SubmitPlannerAssistantInputResult = 'sent' | 'inline' | 'invalid' | 'noop';

import {
  Check,
  History,
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
import { cn } from '@/shared/lib/cn';
import type { SavedConversation } from './assistant.types';

type PlannerAssistantPanelHeaderProps = {
  destination: string;
  discussionName: string;
  renameInputValue: string;
  isRenamingDiscussion: boolean;
  savedConversations: SavedConversation[];
  viewingConvId: string | null;
  currentArchivedConversationName: string | null;
  onRenameInputValueChange: (value: string) => void;
  onRenameDiscussion: (name: string) => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onNewConversation: () => void | Promise<void>;
  onDeleteSavedConversation: (convId: string) => void;
  onSwitchConversation: (convId: string | null) => void;
  onClearConversation: () => void | Promise<void>;
  onClose: () => void;
};

export function PlannerAssistantPanelHeader({
  destination,
  discussionName,
  renameInputValue,
  isRenamingDiscussion,
  savedConversations,
  viewingConvId,
  currentArchivedConversationName,
  onRenameInputValueChange,
  onRenameDiscussion,
  onCancelRename,
  onStartRename,
  onNewConversation,
  onDeleteSavedConversation,
  onSwitchConversation,
  onClearConversation,
  onClose,
}: PlannerAssistantPanelHeaderProps) {
  return (
    <>
      <div className="border-b border-[var(--color-border)] px-3 py-3 text-left">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(47,111,115,0.09)] text-[var(--color-primary)]">
            <Sparkles className="size-4" />
          </div>

          <div className="min-w-0 flex-1">
            {viewingConvId !== null ? (
              <h2 className="text-left text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text-muted)]">
                {currentArchivedConversationName ?? 'Archived'}
              </h2>
            ) : isRenamingDiscussion ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameDiscussion(renameInputValue);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  value={renameInputValue}
                  onChange={(event) => onRenameInputValueChange(event.target.value)}
                  onBlur={() => onRenameDiscussion(renameInputValue)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      onCancelRename();
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
                <DropdownMenuItem onClick={() => void onNewConversation()}>
                  <MessageSquarePlus className="mr-2 size-3.5" />
                  New conversation
                </DropdownMenuItem>

                {savedConversations.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <p className="px-2 py-1.5 text-[0.67rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Saved
                    </p>
                    {savedConversations.map((conversation) => (
                      <DropdownMenuItem
                        key={conversation.id}
                        onClick={() => onSwitchConversation(conversation.id)}
                        className={cn(
                          'flex items-center',
                          viewingConvId === conversation.id && 'text-[var(--color-primary)]',
                        )}
                      >
                        <History className="mr-2 size-3.5 shrink-0" />
                        <span className="flex-1 truncate">{conversation.name}</span>
                        {viewingConvId === conversation.id ? (
                          <Check className="ml-2 size-3.5 shrink-0" />
                        ) : (
                          <button
                            type="button"
                            className="ml-2 shrink-0 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[rgba(255,81,14,1)]"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteSavedConversation(conversation.id);
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
                <DropdownMenuItem onClick={onStartRename} disabled={viewingConvId !== null}>
                  <Pencil className="mr-2 size-3.5" />
                  Rename conversation
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-[rgba(255,81,14,1)] focus:text-[rgba(255,81,14,1)]"
                  onClick={() => void onClearConversation()}
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
              onClick={onClose}
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
            onClick={() => onSwitchConversation(null)}
          >
            Return to live
          </button>
        </div>
      ) : null}
    </>
  );
}

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PlannerAssistantPanel } from './index'
import { renderWithQueryClient } from '@/test/utils'
import type { AssistantMessage, AssistantThread } from '@/shared/api/types'
import {
  getAssistantThread,
  streamAssistantMessages,
} from '@/entities/assistant/api'

vi.mock('@/entities/assistant/api', () => ({
  getAssistantThread: vi.fn(),
  mirrorAssistantJob: vi.fn(),
  streamAssistantMessages: vi.fn(),
}))

function buildAssistantMessage(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: 'assistant-message-1',
    thread_id: 'assistant-thread-1',
    role: 'assistant',
    status: 'complete',
    parts: [{ type: 'text', text: 'Assistant response' }],
    metadata: {},
    source_job_id: null,
    created_at: '2026-03-13T10:00:00.000Z',
    updated_at: '2026-03-13T10:00:00.000Z',
    ...overrides,
  }
}

function buildAssistantThread(
  messages: AssistantMessage[] = [],
): AssistantThread {
  return {
    id: 'assistant-thread-1',
    trip_id: 'trip-1',
    user_id: 'user-1',
    messages,
  }
}

describe('PlannerAssistantPanel', () => {
  beforeEach(() => {
    vi.mocked(getAssistantThread).mockReset()
    vi.mocked(streamAssistantMessages).mockReset()
  })

  it('renders persisted job progress from the assistant thread', async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(
      buildAssistantThread([
        buildAssistantMessage({
          parts: [
            {
              type: 'data',
              name: 'job-progress',
              data: {
                action: 'generate',
                request_text: 'Generate · replace · 2 days',
                job_status: 'RUNNING',
                events: [],
              },
            },
          ],
        }),
      ]),
    )

    renderWithQueryClient(
      <PlannerAssistantPanel
        tripId="trip-1"
        destination="Paris, France"
        isOpen
        onOpenChange={() => {}}
      />,
    )

    expect(await screen.findByText('Planner Assistant')).toBeInTheDocument()
    expect(await screen.findByText('Generate · replace · 2 days')).toBeInTheDocument()
    expect(screen.getByText('Queued and waiting for worker pickup.')).toBeInTheDocument()
  })

  it('streams a new assistant reply when the user sends a message', async () => {
    const user = userEvent.setup()
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(buildAssistantThread())
      .mockResolvedValue(
        buildAssistantThread([
          buildAssistantMessage({
            id: 'assistant-message-streamed',
            parts: [{ type: 'text', text: 'I moved the museum to the afternoon.' }],
          }),
        ]),
      )

    vi.mocked(streamAssistantMessages).mockImplementation(
      async (_tripId, _payload, onEvent) => {
        onEvent({
          type: 'message_upsert',
          message: buildAssistantMessage({
            id: 'assistant-message-streamed',
            parts: [{ type: 'text', text: 'I moved the museum to the afternoon.' }],
          }),
        })
      },
    )

    renderWithQueryClient(
      <PlannerAssistantPanel
        tripId="trip-1"
        destination="Paris, France"
        isOpen
        onOpenChange={() => {}}
      />,
    )

    await screen.findByText('Planner Assistant')
    await user.type(screen.getByPlaceholderText(/ask about this trip/i), 'Move the museum to the afternoon')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(streamAssistantMessages).toHaveBeenCalled()
    })
    expect(await screen.findByText('I moved the museum to the afternoon.')).toBeInTheDocument()
  })

  it('sends a confirmation payload for interrupting tool calls', async () => {
    const user = userEvent.setup()
    vi.mocked(getAssistantThread).mockResolvedValue(
      buildAssistantThread([
        buildAssistantMessage({
          id: 'assistant-message-confirm',
          status: 'requires_action',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-call-1',
              toolName: 'delete_activity',
              args: { destination: 'Delete Louvre slot' },
              argsText: 'Delete Louvre slot',
              interrupt: true,
            },
          ],
        }),
      ]),
    )
    vi.mocked(streamAssistantMessages).mockResolvedValue()

    renderWithQueryClient(
      <PlannerAssistantPanel
        tripId="trip-1"
        destination="Paris, France"
        isOpen
        onOpenChange={() => {}}
      />,
    )

    await screen.findByText('Delete Activity')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(streamAssistantMessages).toHaveBeenCalledWith(
        'trip-1',
        {
          confirmation: {
            message_id: 'assistant-message-confirm',
            tool_call_id: 'tool-call-1',
            confirmed: true,
          },
        },
        expect.any(Function),
        undefined,
      )
    })
  })
})

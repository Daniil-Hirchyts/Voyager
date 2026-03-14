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
import { streamJobProgress } from '@/entities/job/api'

const defaultDays = [
  {
    id: 'day-1',
    trip_id: 'trip-1',
    day_index: 0,
    date: '2026-03-14',
    notes: null,
    created_at: '2026-03-14T08:00:00.000Z',
    updated_at: '2026-03-14T08:00:00.000Z',
  },
]

vi.mock('@/entities/assistant/api', () => ({
  getAssistantThread: vi.fn(),
  mirrorAssistantJob: vi.fn(),
  streamAssistantMessages: vi.fn(),
}))

vi.mock('@/entities/job/api', () => ({
  streamJobProgress: vi.fn(),
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

function renderPlannerAssistantPanel(overrides: Partial<React.ComponentProps<typeof PlannerAssistantPanel>> = {}) {
  return renderWithQueryClient(
    <PlannerAssistantPanel
      tripId="trip-1"
      destination="Paris, France"
      days={defaultDays}
      hasActivities
      isOpen
      requestedInlineAction={null}
      onRequestedInlineActionHandled={() => {}}
      onSubmitInlineAction={vi.fn().mockResolvedValue(undefined)}
      isPlannerActionPending={false}
      onOpenChange={() => {}}
      {...overrides}
    />,
  )
}

describe('PlannerAssistantPanel', () => {
  beforeEach(() => {
    vi.mocked(getAssistantThread).mockReset()
    vi.mocked(streamAssistantMessages).mockReset()
    vi.mocked(streamJobProgress).mockReset()
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

    renderPlannerAssistantPanel()

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

    renderPlannerAssistantPanel()

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

    renderPlannerAssistantPanel()

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

  it('renders user messages without triggering assistant status errors', async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(
      buildAssistantThread([
        buildAssistantMessage({
          id: 'user-message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Move the museum to day two' }],
        }),
      ]),
    )

    renderPlannerAssistantPanel()

    expect(await screen.findByText('Move the museum to day two')).toBeInTheDocument()
  })

  it('sends on Enter and keeps Cmd+Enter as a newline', async () => {
    const user = userEvent.setup()
    vi.mocked(getAssistantThread).mockResolvedValue(buildAssistantThread())
    vi.mocked(streamAssistantMessages).mockResolvedValue()

    renderPlannerAssistantPanel()

    const composer = await screen.findByPlaceholderText(/ask about this trip/i)
    await user.type(composer, 'Move the museum')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(streamAssistantMessages).toHaveBeenCalledWith(
        'trip-1',
        expect.objectContaining({ text: 'Move the museum' }),
        expect.any(Function),
        undefined,
      )
    })

    vi.mocked(streamAssistantMessages).mockClear()

    await user.type(composer, 'Line one')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(composer).toHaveValue('Line one\n')
    expect(streamAssistantMessages).not.toHaveBeenCalled()
  })

  it('opens the inline generation form for slash generate instead of streaming', async () => {
    const user = userEvent.setup()
    vi.mocked(getAssistantThread).mockResolvedValue(buildAssistantThread())
    const onSubmitInlineAction = vi.fn().mockResolvedValue(undefined)

    renderPlannerAssistantPanel({ onSubmitInlineAction })

    const composer = await screen.findByPlaceholderText(/ask about this trip/i)
    await user.type(composer, '/generate')
    await user.keyboard('{Enter}')

    expect(await screen.findByText(/choose how the assistant should build the itinerary/i)).toBeInTheDocument()
    expect(streamAssistantMessages).not.toHaveBeenCalled()
  })

  it('resumes mirrored job progress streams on reload', async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(
      buildAssistantThread([
        buildAssistantMessage({
          id: 'assistant-message-job',
          status: 'running',
          source_job_id: 'job-1',
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
    vi.mocked(streamJobProgress).mockResolvedValue()

    renderPlannerAssistantPanel()

    await screen.findByText('Generate · replace · 2 days')

    await waitFor(() => {
      expect(streamJobProgress).toHaveBeenCalledWith(
        'job-1',
        expect.any(Function),
        expect.any(AbortSignal),
      )
    })
  })
})

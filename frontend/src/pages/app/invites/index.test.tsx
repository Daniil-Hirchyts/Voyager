import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import TripInvitePage from './index'
import { buildTrip, buildTripInvitationPreview } from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

function renderInvitePage(token = 'token-1') {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[`/app/invites/${token}`]}>
      <Routes>
        <Route path="/app/invites/:token" element={<TripInvitePage />} />
        <Route path="/app/trips/:tripId/plan" element={<div>Accepted Plan</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TripInvitePage', () => {
  it('accepts a valid invitation and opens the shared trip', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('http://localhost:8000/trip-invitations/token-1', () =>
        HttpResponse.json(buildTripInvitationPreview()),
      ),
      http.post('http://localhost:8000/trip-invitations/token-1/accept', () =>
        HttpResponse.json(buildTrip({ id: 'trip-shared-1', current_user_role: 'editor', collaborator_count: 1 })),
      ),
    )

    renderInvitePage()

    expect(await screen.findByRole('heading', { name: /paris atlas/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /accept and open trip/i }))

    await waitFor(() => {
      expect(screen.getByText('Accepted Plan')).toBeInTheDocument()
    })
  })

  it('shows the API error when the invite is no longer valid', async () => {
    server.use(
      http.get('http://localhost:8000/trip-invitations/token-invalid', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_INVALID',
              message: 'This invite has already been used.',
            },
          },
          { status: 409 },
        ),
      ),
    )

    renderInvitePage('token-invalid')

    expect(await screen.findByText('This invite has already been used.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept and open trip/i })).not.toBeInTheDocument()
  })
})

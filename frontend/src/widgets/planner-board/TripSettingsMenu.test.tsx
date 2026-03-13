import { MemoryRouter } from 'react-router-dom'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { TripSettingsMenu } from './TripSettingsMenu'
import {
  buildTrip,
  buildTripAsset,
  buildTripInvitation,
  buildTripSharingResponse,
} from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

vi.mock('@/entities/trip/useTripCoverPhotoManager', () => ({
  useTripCoverPhotoManager: () => ({
    coverPreference: null,
    coverPhotoCandidates: [],
    selectedCoverPhoto: null,
    photoAttributionLabel: null,
    photoAttributionText: null,
    coverPhotoUrl: null,
    isCoverPhotoBusy: false,
    coverPhotoEmptyMessage: 'No cover photo',
    coverPhotosLoading: false,
    coverPhotoRefreshError: null,
    resolvedPlaceId: null,
    handlePhotoSelection: vi.fn(),
    commitPhotoSelection: vi.fn(),
    handleCoverPhotoRefresh: vi.fn(),
  }),
}))

describe('TripSettingsMenu', () => {
  it('renders the trip uploads section', async () => {
    let assets = [buildTripAsset()]

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(buildTrip())),
      http.get('http://localhost:8000/trips/:tripId/sharing', () =>
        HttpResponse.json(buildTripSharingResponse()),
      ),
      http.get('http://localhost:8000/trips/:tripId/assets', ({ request }) => {
        const activityId = new URL(request.url).searchParams.get('activity_id')
        return HttpResponse.json({
          total: activityId ? 0 : assets.length,
          items: activityId ? [] : assets,
        })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <TripSettingsMenu tripId="trip-1" open onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Trip uploads')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload cover photo' })).toBeInTheDocument()
    expect(screen.getByText('boarding-pass.pdf')).toBeInTheDocument()
  })

  it('saves the selected travel time mode with trip settings', async () => {
    let routeTravelMode: 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' = 'WALK'
    let patchBody: Record<string, unknown> | null = null
    let patchVersion: string | null = null

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () =>
        HttpResponse.json(buildTrip({ route_travel_mode: routeTravelMode })),
      ),
      http.get('http://localhost:8000/trips/:tripId/sharing', () =>
        HttpResponse.json(buildTripSharingResponse()),
      ),
      http.get('http://localhost:8000/trips/:tripId/assets', () =>
        HttpResponse.json({ total: 0, items: [] }),
      ),
      http.patch('http://localhost:8000/trips/trip-1', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        patchVersion = request.headers.get('If-Match')
        routeTravelMode = patchBody.route_travel_mode as typeof routeTravelMode
        return HttpResponse.json(buildTrip({ version: 4, route_travel_mode: routeTravelMode }))
      }),
    )

    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithQueryClient(
      <MemoryRouter>
        <TripSettingsMenu tripId="trip-1" open onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    const travelModeTrigger = await screen.findByRole('combobox', { name: 'Travel time mode' })
    expect(travelModeTrigger).toHaveTextContent('Walking')

    await user.click(travelModeTrigger)
    await user.click(await screen.findByRole('option', { name: 'Driving' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patchBody).toMatchObject({ route_travel_mode: 'DRIVE' })
    })
    expect(patchVersion).toBe('3')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lets the owner create, revoke, and remove trip access from the sharing panel', async () => {
    const user = userEvent.setup()
    let createdInvites = 0
    let revokedInvitationId: string | null = null
    let removedCollaboratorId: string | null = null
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    let sharing = buildTripSharingResponse({
      collaborators: buildTripSharingResponse().collaborators,
      pending_invitations: [
        buildTripInvitation({
          id: 'invite-1',
          invite_path: '/app/invites/token-1',
        }),
      ],
    })

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWrite,
      },
    })

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () =>
        HttpResponse.json(buildTrip({ current_user_role: 'owner', collaborator_count: 1 })),
      ),
      http.get('http://localhost:8000/trips/:tripId/sharing', () => HttpResponse.json(sharing)),
      http.get('http://localhost:8000/trips/:tripId/assets', () =>
        HttpResponse.json({ total: 0, items: [] }),
      ),
      http.post('http://localhost:8000/trips/trip-1/invites', () => {
        createdInvites += 1
        const createdInvitation = buildTripInvitation({
          id: `invite-created-${createdInvites}`,
          invite_path: `/app/invites/token-created-${createdInvites}`,
        })
        sharing = {
          ...sharing,
          pending_invitations: [createdInvitation, ...sharing.pending_invitations],
        }
        return HttpResponse.json({ invitation: createdInvitation }, { status: 201 })
      }),
      http.delete('http://localhost:8000/trips/trip-1/invites/:invitationId', ({ params }) => {
        revokedInvitationId = String(params.invitationId)
        sharing = {
          ...sharing,
          pending_invitations: sharing.pending_invitations.filter((item) => item.id !== revokedInvitationId),
        }
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('http://localhost:8000/trips/trip-1/collaborators/:collaboratorUserId', ({ params }) => {
        removedCollaboratorId = String(params.collaboratorUserId)
        sharing = {
          ...sharing,
          collaborators: sharing.collaborators.filter((item) => item.user_id !== removedCollaboratorId),
        }
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <TripSettingsMenu tripId="trip-1" open onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /create invite link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /create invite link/i }))

    await waitFor(() => {
      expect(createdInvites).toBe(1)
    })
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('/app/invites/token-created-1'))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /revoke/i })).toHaveLength(2)
    })
    await user.click(screen.getAllByRole('button', { name: /revoke/i })[0])
    await waitFor(() => {
      expect(revokedInvitationId).toBe('invite-created-1')
    })

    await user.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => {
      expect(removedCollaboratorId).toBe('user-2')
    })
  })

  it('renders editor sharing state as read-only', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () =>
        HttpResponse.json(buildTrip({ current_user_role: 'editor', collaborator_count: 1 })),
      ),
      http.get('http://localhost:8000/trips/:tripId/sharing', () =>
        HttpResponse.json(
          buildTripSharingResponse({
            current_user_role: 'editor',
            pending_invitations: [],
          }),
        ),
      ),
      http.get('http://localhost:8000/trips/:tripId/assets', () =>
        HttpResponse.json({ total: 0, items: [] }),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <TripSettingsMenu tripId="trip-1" open onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Editor access')).toBeInTheDocument()
    expect(screen.getByText(/only the owner can manage invites and access/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create invite link/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete trip permanently/i })).not.toBeInTheDocument()
  })
})

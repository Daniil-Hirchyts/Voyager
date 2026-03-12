import { MemoryRouter } from 'react-router-dom'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { TripSettingsMenu } from './TripSettingsMenu'
import { buildTrip, buildTripAsset } from '@/test/fixtures/api'
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
    handleCoverPhotoRefresh: vi.fn(),
  }),
}))

describe('TripSettingsMenu', () => {
  it('renders the trip uploads section', async () => {
    let assets = [buildTripAsset()]

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(buildTrip())),
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
})

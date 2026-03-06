import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { forwardRef, type ReactNode } from 'react'
import MapWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { buildPlace, listResponse } from '@/test/fixtures/api'

vi.mock('react-map-gl/maplibre', () => ({
  default: forwardRef<HTMLDivElement, { children?: ReactNode }>(function MapStub(
    { children },
    ref,
  ) {
    return (
      <div ref={ref} data-testid="map-stub">
        {children}
      </div>
    )
  }),
  Marker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  NavigationControl: () => <div />,
}))

describe('MapWorkspace', () => {
  it('restores planner context from the deep link and assigns the selected place back to the planner', async () => {
    const place = buildPlace()
    let patchBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/places', () => HttpResponse.json(listResponse([place]))),
      http.get('http://localhost:8000/places/:placeId', () => HttpResponse.json(place)),
      http.patch('http://localhost:8000/activities/:activityId', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'activity-1',
          trip_day_id: 'day-1',
          order_index: 0,
          title: 'Museum visit',
          description: null,
          start_time: null,
          duration_min: null,
          tags: [],
          estimated_cost_amount: null,
          estimated_cost_currency: null,
          place_id: place.id,
          event_snapshot_id: null,
          notes: null,
          is_favorite: false,
          source: 'manual',
          created_at: '2026-03-06T09:00:00.000Z',
          updated_at: '2026-03-06T09:00:00.000Z',
        })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter
        initialEntries={[
          `/app/trips/trip-1/map?activityId=activity-1&placeId=${place.id}&returnTo=/app/trips/trip-1/plan`,
        ]}
      >
        <Routes>
          <Route path="/app/trips/:tripId/map" element={<MapWorkspace tripId="trip-1" />} />
          <Route path="/app/trips/:tripId/plan" element={<div>Planner return</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findAllByText(place.name)).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /use for planner activity/i }))

    expect(await screen.findByText('Planner return')).toBeInTheDocument()
    expect(patchBody).toEqual({ place_id: place.id })
  })
})

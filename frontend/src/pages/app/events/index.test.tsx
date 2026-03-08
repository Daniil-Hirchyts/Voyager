import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { screen } from '@testing-library/react'
import EventsPage from './index'
import { renderWithQueryClient } from '@/test/utils'

function ActivityRouteEcho() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}`}</div>
}

describe('EventsPage', () => {
  it('redirects the legacy events route to activities', async () => {
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events?dayId=day-1']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsPage />} />
          <Route path="/app/trips/:tripId/activities" element={<ActivityRouteEcho />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('/app/trips/trip-1/activities?dayId=day-1')).toBeInTheDocument()
  })
})

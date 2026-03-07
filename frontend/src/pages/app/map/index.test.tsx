import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import MapPage from './index'

function LocationProbe() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}`}</div>
}

describe('MapPage redirect', () => {
  it('redirects legacy map routes into planner map view', async () => {
    render(
      <MemoryRouter initialEntries={['/app/trips/trip-123/map?activityId=act-1&placeId=place-9']}>
        <Routes>
          <Route path="/app/trips/:tripId/map" element={<MapPage />} />
          <Route path="/app/trips/:tripId/plan" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('/app/trips/trip-123/plan?activityId=act-1&placeId=place-9&view=map'),
    ).toBeInTheDocument()
  })
})

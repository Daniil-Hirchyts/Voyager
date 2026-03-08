import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { screen } from '@testing-library/react'
import ProposalsPage from './index'
import { renderWithQueryClient } from '@/test/utils'

function ActivityRouteEcho() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}`}</div>
}

describe('ProposalsPage', () => {
  it('redirects the legacy proposals route to activities proposal mode', async () => {
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals?dayId=day-1']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsPage />} />
          <Route path="/app/trips/:tripId/activities" element={<ActivityRouteEcho />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('/app/trips/trip-1/activities?dayId=day-1&ai=proposal'),
    ).toBeInTheDocument()
  })
})

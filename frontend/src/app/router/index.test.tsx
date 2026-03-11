import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { screen } from '@testing-library/react'
import { FeatureRouteGate, LegacyActivitiesRedirect } from './index'
import { renderWithQueryClient } from '@/test/utils'

describe('FeatureRouteGate', () => {
  it('redirects to the trip overview when the feature is disabled', async () => {
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-123/map']}>
        <Routes>
          <Route
            path="/app/trips/:tripId/map"
            element={(
              <FeatureRouteGate enabled={false}>
                <div>Map Workspace</div>
              </FeatureRouteGate>
            )}
          />
          <Route path="/app/trips/:tripId" element={<div>Trip Overview</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Trip Overview')).toBeInTheDocument()
    expect(screen.queryByText('Map Workspace')).not.toBeInTheDocument()
  })

  it('renders feature content when the route is enabled', async () => {
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-123/map']}>
        <Routes>
          <Route
            path="/app/trips/:tripId/map"
            element={(
              <FeatureRouteGate enabled>
                <div>Map Workspace</div>
              </FeatureRouteGate>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Map Workspace')).toBeInTheDocument()
  })

  it('redirects the legacy activities route into planner', async () => {
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-123/activities']}>
        <Routes>
          <Route path="/app/trips/:tripId/activities" element={<LegacyActivitiesRedirect />} />
          <Route path="/app/trips/:tripId/plan" element={<div>Planner Workspace</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Planner Workspace')).toBeInTheDocument()
  })
})

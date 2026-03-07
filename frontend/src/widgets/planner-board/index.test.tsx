import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import PlannerBoard from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildOffer,
  buildPlannerActivity,
  buildPlannerDay,
  buildPlannerResponse,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

describe('PlannerBoard', () => {
  it('shows real planner activities and attached offer chips in kanban view', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity()
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })
    const offer = buildOffer({ trip_day_id: day.id, title: 'Morning arrival flight' })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(activity.title)).toBeInTheDocument()
    expect(await screen.findByText('Morning arrival flight')).toBeInTheDocument()
    expect(screen.getByText('Generated')).toBeInTheDocument()
  })

  it('renders the calendar view when the query param selects it', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity({ title: 'Pantheon morning visit' })
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/?view=calendar&date=2026-04-10']}>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Pantheon morning visit')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /calendar/i })).toHaveAttribute('aria-selected', 'true')
  })
})

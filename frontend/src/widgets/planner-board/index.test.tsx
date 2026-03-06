import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import PlannerBoard from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildDay,
  buildOffer,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

describe('PlannerBoard', () => {
  it('shows attached offer chips inside the planner day columns', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const offer = buildOffer({ trip_day_id: day.id, title: 'Morning arrival flight' })

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([day])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
      http.get('http://localhost:8000/days/:dayId/activities', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Morning arrival flight')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /morning arrival flight/i }),
    ).toHaveAttribute('href', `/app/trips/${trip.id}/offers?dayId=${day.id}`)
  })
})

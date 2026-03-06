import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TripDetailPage from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { buildDay, buildOffer, buildTrip, listResponse } from '@/test/fixtures/api'

describe('TripDetailPage', () => {
  it('shows attached day-level offers on the overview', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const offer = buildOffer({ trip_day_id: day.id, kind: 'lodging', title: 'Hotel du Louvre' })

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([day])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={[`/app/trips/${trip.id}`]}>
        <Routes>
          <Route path="/app/trips/:tripId" element={<TripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Hotel du Louvre')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /hotel du louvre/i }),
    ).toHaveAttribute('href', `/app/trips/${trip.id}/offers?dayId=${day.id}`)
  })
})

import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OffersWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { apiError, buildDay, buildOffer, listResponse } from '@/test/fixtures/api'

describe('OffersWorkspace', () => {
  it('shows an inline provider-unavailable state for transport search 503s', async () => {
    server.use(
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([buildDay()])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.post('http://localhost:8000/offers/transport/search', () => {
        const error = apiError(503, 'INTEGRATION_NOT_CONFIGURED', 'Provider disabled')
        return HttpResponse.json(error.body, { status: error.status })
      }),
    )

    const { container } = renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/offers']}>
        <Routes>
          <Route path="/app/trips/:tripId/offers" element={<OffersWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.type(screen.getByPlaceholderText('CDG'), 'cdg')
    await userEvent.type(screen.getByPlaceholderText('MAD'), 'mad')
    const dateInputs = container.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0] as HTMLInputElement, { target: { value: '2026-04-10' } })

    await userEvent.click(screen.getByRole('button', { name: /search flights/i }))

    expect(
      await screen.findByText('Provider integrations are not configured for this environment.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Offers are unavailable because the provider integrations are not configured.',
      ),
    ).toBeInTheDocument()
  })

  it('attaches an offer to a day and refreshes the attached label after invalidation', async () => {
    const day = buildDay()
    let offer = buildOffer()
    let attachPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([day])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
      http.post('http://localhost:8000/trips/:tripId/offers/:offerId/attach-day', async ({ request }) => {
        attachPayload = (await request.json()) as Record<string, unknown>
        offer = { ...offer, trip_day_id: day.id }
        return HttpResponse.json(offer)
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/offers']}>
        <Routes>
          <Route path="/app/trips/:tripId/offers" element={<OffersWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findAllByText(offer.title)).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /attach to day/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), day.id)
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/Attached to Day 1/i)[0]).toBeInTheDocument()
    })
    expect(attachPayload).toEqual({ offer_kind: offer.kind, trip_day_id: day.id })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TripDetailPage from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { buildDay, buildJob, buildOffer, buildPlace, buildTrip, listResponse } from '@/test/fixtures/api'

const { mockReadTripCoverPhotoPreference, mockMergeTripCoverPhotoPreference } = vi.hoisted(() => ({
  mockReadTripCoverPhotoPreference: vi.fn(),
  mockMergeTripCoverPhotoPreference: vi.fn(),
}))

vi.mock('@/entities/trip/cover-photo', () => ({
  readTripCoverPhotoPreference: (...args: unknown[]) => mockReadTripCoverPhotoPreference(...args),
  mergeTripCoverPhotoPreference: (...args: unknown[]) => mockMergeTripCoverPhotoPreference(...args),
}))

describe('TripDetailPage', () => {
  beforeEach(() => {
    mockReadTripCoverPhotoPreference.mockReset()
    mockMergeTripCoverPhotoPreference.mockReset()
    mockReadTripCoverPhotoPreference.mockReturnValue(null)
  })

  it('shows attached day-level offers on the overview', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const offer = buildOffer({ trip_day_id: day.id, kind: 'lodging', title: 'Hotel du Louvre' })
    const place = buildPlace({
      id: 'place-paris',
      name: 'Paris',
      address_text: 'Paris, France',
      primary_photo: {
        id: 'photo-paris-1',
        source: 'seed',
        image_url: 'https://images.example.com/paris-cover.jpg',
        thumbnail_url: 'https://images.example.com/paris-cover-thumb.jpg',
        license_code: null,
        license_url: null,
        attribution_text: 'Paris, France',
      },
    })
    const placePhotos = {
      total: 2,
      items: [
        {
          id: 'photo-paris-1',
          place_id: place.id,
          source: 'seed',
          source_media_ref: 'photo-paris-1',
          image_url: 'https://images.example.com/paris-cover.jpg',
          thumbnail_url: 'https://images.example.com/paris-cover-thumb.jpg',
          width: 1600,
          height: 1000,
          license_code: null,
          license_url: null,
          author_name: null,
          author_url: null,
          attribution_text: 'Paris, France',
          rank: 0,
          is_primary: true,
          created_at: '2026-03-06T09:00:00.000Z',
          updated_at: '2026-03-06T09:00:00.000Z',
        },
        {
          id: 'photo-paris-2',
          place_id: place.id,
          source: 'seed',
          source_media_ref: 'photo-paris-2',
          image_url: 'https://images.example.com/paris-alt.jpg',
          thumbnail_url: 'https://images.example.com/paris-alt-thumb.jpg',
          width: 1600,
          height: 1000,
          license_code: null,
          license_url: null,
          author_name: null,
          author_url: null,
          attribution_text: 'Paris skyline',
          rank: 1,
          is_primary: false,
          created_at: '2026-03-06T09:00:00.000Z',
          updated_at: '2026-03-06T09:00:00.000Z',
        },
      ],
    }

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([day])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
      http.get('http://localhost:8000/places/autocomplete', () =>
        HttpResponse.json({
          total: 1,
          limit: 4,
          offset: 0,
          items: [{ id: place.id, label: 'Paris, France' }],
        }),
      ),
      http.get('http://localhost:8000/places/:placeId', () => HttpResponse.json(place)),
      http.get('http://localhost:8000/places/:placeId/photos', () =>
        HttpResponse.json(placePhotos),
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
    expect(await screen.findByRole('button', { name: /change photo/i })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /hotel du louvre/i }),
    ).toHaveAttribute('href', `/app/trips/${trip.id}/offers?dayId=${day.id}`)
  })

  it('stops the cover photo loader when the backend photo refresh fails', async () => {
    const trip = buildTrip({
      id: 'trip-prague',
      destination_text: 'Prague, Czechia',
      title: 'Prague test',
    })
    const place = buildPlace({
      id: 'place-prague',
      name: 'Prague',
      address_text: 'Prague, Czechia',
      photo_count: 0,
      primary_photo: null,
    })

    mockReadTripCoverPhotoPreference.mockReturnValue({
      placeId: place.id,
      placeLabel: 'Prague, Czechia',
      photoId: null,
    })

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () =>
        HttpResponse.json(listResponse([buildDay({ trip_id: trip.id })])),
      ),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.get('http://localhost:8000/places/:placeId', () => HttpResponse.json(place)),
      http.get('http://localhost:8000/places/:placeId/photos', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.post('http://localhost:8000/places/:placeId/photos/refresh', () =>
        HttpResponse.json({ job_id: 'job-photo-refresh' }),
      ),
      http.get('http://localhost:8000/jobs/:jobId', () =>
        HttpResponse.json(
          buildJob({
            id: 'job-photo-refresh',
            job_type: 'places.photos.refresh',
            status: 'FAILED',
            error: {
              code: 'NO_PLACE_PHOTOS_FOUND',
              message: 'No licensed place photos found',
            },
          }),
        ),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={[`/app/trips/${trip.id}`]}>
        <Routes>
          <Route path="/app/trips/:tripId" element={<TripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('No licensed city photos are available for this destination yet.'),
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})

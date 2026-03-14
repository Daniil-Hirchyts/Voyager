import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TripsPage from './index'
import { buildTrip, listResponse } from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import type { Trip } from '@/shared/api/types'

vi.mock('@/components/ui/animated-number', () => ({
  AnimatedNumber: ({ value }: { value: number | null | undefined }) => <>{value ?? null}</>,
}))

function toTripPayload(trip: Trip) {
  const { coverPreference, coverPhoto, ...rest } = trip

  return {
    ...rest,
    cover_preference: coverPreference
      ? {
          place_id: coverPreference.placeId,
          place_label: coverPreference.placeLabel,
          place_lat: coverPreference.placeLat,
          place_lng: coverPreference.placeLng,
          photo_id: coverPreference.photoId,
          asset_id: coverPreference.assetId,
          fallback_image_url: coverPreference.fallbackImageUrl,
        }
      : null,
    cover_photo: coverPhoto
      ? {
          source: coverPhoto.source,
          url: coverPhoto.url,
          thumbnail_url: coverPhoto.thumbnailUrl,
          asset_id: coverPhoto.assetId,
          photo_id: coverPhoto.photoId,
          place_id: coverPhoto.placeId,
          attribution_text: coverPhoto.attributionText,
          is_fallback: coverPhoto.isFallback,
        }
      : null,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/trips']}>
        <TripsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TripsPage cover regressions', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders API-provided public cover assets without extra place lookups', async () => {
    const trip = buildTrip({
      id: 'trip-kyoto',
      title: 'Trip to Kyoto',
      destination_text: 'Kyoto, Japan',
      coverPreference: {
        placeId: '11111111-1111-4111-8111-111111111111',
        placeLabel: 'Kyoto, Japan',
        placeLat: 35.0116,
        placeLng: 135.7681,
        photoId: null,
        assetId: null,
        fallbackImageUrl: '/images/trips/kyoto-lantern-week.jpg',
      },
      coverPhoto: {
        source: 'fallback',
        url: '/images/trips/kyoto-lantern-week.jpg',
        thumbnailUrl: null,
        assetId: null,
        photoId: null,
        placeId: '11111111-1111-4111-8111-111111111111',
        attributionText: 'Kyoto, Japan',
        isFallback: true,
      },
    })
    let autocompleteRequests = 0
    let googleDetailRequests = 0

    server.use(
      http.get('http://localhost:8000/trips', () =>
        HttpResponse.json(listResponse([toTripPayload(trip)])),
      ),
      http.get('http://localhost:8000/places/autocomplete', () => {
        autocompleteRequests += 1
        return HttpResponse.json({
          total: 0,
          limit: 4,
          offset: 0,
          items: [],
        })
      }),
      http.get('http://localhost:8000/places/google/:placeId/detail', () => {
        googleDetailRequests += 1
        return HttpResponse.json({
          id: 'google-detail',
          photos: [],
        })
      }),
    )

    renderPage()

    const tripCover = await screen.findByRole('img', { name: 'Kyoto, Japan' })

    expect(tripCover.getAttribute('src')).toBe('/images/trips/kyoto-lantern-week.jpg')
    expect(autocompleteRequests).toBe(0)
    expect(googleDetailRequests).toBe(0)
  })

  it('migrates legacy cover preferences to the backend and renders the refreshed card image', async () => {
    const tripId = 'trip-legacy-kyoto'
    let patchCount = 0
    let patchBody: Record<string, unknown> | null = null
    let currentTrip = buildTrip({
      id: tripId,
      title: 'Trip to Kyoto',
      destination_text: 'Kyoto, Japan',
      coverPreference: null,
      coverPhoto: null,
    })

    window.localStorage.setItem(
      `voyager.trip-cover:${tripId}`,
      JSON.stringify({
        placeLabel: 'Kyoto, Japan',
        placeLat: 35.0116,
        placeLng: 135.7681,
        googlePhotoUrl: '/images/trips/kyoto-lantern-week.jpg',
      }),
    )

    server.use(
      http.get('http://localhost:8000/trips', () =>
        HttpResponse.json(listResponse([toTripPayload(currentTrip)])),
      ),
      http.patch('http://localhost:8000/trips/:tripId/cover-preference', async ({ params, request }) => {
        patchCount += 1
        patchBody = (await request.json()) as Record<string, unknown>
        currentTrip = buildTrip({
          ...currentTrip,
          id: String(params.tripId),
          coverPreference: {
            placeId: null,
            placeLabel: 'Kyoto, Japan',
            placeLat: 35.0116,
            placeLng: 135.7681,
            photoId: null,
            assetId: null,
            fallbackImageUrl: '/images/trips/kyoto-lantern-week.jpg',
          },
          coverPhoto: {
            source: 'fallback',
            url: '/images/trips/kyoto-lantern-week.jpg',
            thumbnailUrl: '/images/trips/kyoto-lantern-week.jpg',
            assetId: null,
            photoId: null,
            placeId: null,
            attributionText: 'Kyoto, Japan',
            isFallback: true,
          },
        })

        return HttpResponse.json(toTripPayload(currentTrip))
      }),
    )

    renderPage()

    await waitFor(() => {
      expect(patchCount).toBe(1)
    })

    expect(patchBody).toMatchObject({
      place_id: null,
      place_label: 'Kyoto, Japan',
      place_lat: 35.0116,
      place_lng: 135.7681,
      photo_id: null,
      asset_id: null,
      fallback_image_url: '/images/trips/kyoto-lantern-week.jpg',
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Kyoto, Japan' }).getAttribute('src')).toBe(
        '/images/trips/kyoto-lantern-week.jpg',
      )
    })
  })
})

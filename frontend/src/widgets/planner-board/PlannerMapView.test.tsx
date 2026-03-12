import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { config } from '@/app/config'
import { DEFAULT_VOYAGER_PREFERENCES } from '@/entities/user/preferences'
import type { RoutePreviewInput } from '@/shared/api/types'
import { ActivityMapDetailSheet, PlannerMapView } from './PlannerMapView'
import type { PlannerRecommendationsController } from './usePlannerRecommendations'
import {
  buildPlace,
  buildPlannerActivity,
  buildPlannerDay,
  buildTrip,
  buildTripAsset,
} from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

describe('ActivityMapDetailSheet', () => {
  it('renders activity attachments in the live detail sheet', async () => {
    const activity = buildPlannerActivity({
      id: 'activity-99',
      place_id: null,
      place: null,
    })
    const assets = [
      buildTripAsset({
        id: 'asset-activity-1',
        activity_id: activity.id,
        original_filename: 'museum-ticket.pdf',
      }),
    ]

    server.use(
      http.get('http://localhost:8000/trips/:tripId/assets', ({ request }) => {
        const activityId = new URL(request.url).searchParams.get('activity_id')
        const items = assets.filter((item) => item.activity_id === activityId)
        return HttpResponse.json({
          total: items.length,
          items,
        })
      }),
    )

    const user = userEvent.setup()

    renderWithQueryClient(
      <ActivityMapDetailSheet
        open
        tripId="trip-1"
        activity={activity}
        dayLabel="Day 1"
        onClose={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('Attachments')).toBeInTheDocument()
    expect(screen.getByText('museum-ticket.pdf')).toBeInTheDocument()
  })
})

function buildRecommendationsController(): PlannerRecommendationsController {
  return {
    enabled: false,
    preferences: DEFAULT_VOYAGER_PREFERENCES,
    targetDayId: 'day-1',
    setTargetDayId: () => {},
    dayOptions: [],
    destinations: [],
    discoverEntries: [],
    isLoadingDiscover: false,
    isRefreshing: false,
    addingKey: null,
    refresh: async () => {},
    addEntryToDestination: async () => null,
  }
}

describe('PlannerMapView', () => {
  it('requests routed geometry for every visible day route', async () => {
    const originalApiKey = config.map.apiKey
    config.map.apiKey = 'test-google-maps-key'

    const routePreviewBodies: RoutePreviewInput[] = []

    server.use(
      http.post('http://localhost:8000/routes/preview', async ({ request }) => {
        const body = (await request.json()) as RoutePreviewInput
        routePreviewBodies.push(body)
        return HttpResponse.json({
          routes: [
            {
              summary: 'Preview route',
              distance_m: 1200,
              duration_min: 18,
              static_duration_min: 18,
              path: [body.origin, ...body.waypoints, body.destination],
            },
          ],
        })
      }),
    )

    const day1Start = buildPlace({ id: 'place-day1-start', name: 'Day 1 Start', lat: 48.8566, lon: 2.3522 })
    const day1End = buildPlace({ id: 'place-day1-end', name: 'Day 1 End', lat: 48.8601, lon: 2.3412 })
    const day2Start = buildPlace({ id: 'place-day2-start', name: 'Day 2 Start', lat: 48.8738, lon: 2.2950 })
    const day2End = buildPlace({ id: 'place-day2-end', name: 'Day 2 End', lat: 48.8867, lon: 2.3431 })

    const days = [
      buildPlannerDay({
        id: 'day-1',
        day_index: 0,
        date: '2026-04-10',
        activities: [
          buildPlannerActivity({
            id: 'activity-day1-1',
            trip_day_id: 'day-1',
            order_index: 0,
            title: 'Day 1 Start',
            place_id: day1Start.id,
            place: {
              id: day1Start.id,
              name: day1Start.name,
              category: day1Start.category,
              address_text: day1Start.address_text,
              lat: day1Start.lat,
              lon: day1Start.lon,
              photo_count: day1Start.photo_count ?? 0,
              primary_photo: day1Start.primary_photo,
            },
          }),
          buildPlannerActivity({
            id: 'activity-day1-2',
            trip_day_id: 'day-1',
            order_index: 1,
            title: 'Day 1 End',
            place_id: day1End.id,
            place: {
              id: day1End.id,
              name: day1End.name,
              category: day1End.category,
              address_text: day1End.address_text,
              lat: day1End.lat,
              lon: day1End.lon,
              photo_count: day1End.photo_count ?? 0,
              primary_photo: day1End.primary_photo,
            },
          }),
        ],
      }),
      buildPlannerDay({
        id: 'day-2',
        day_index: 1,
        date: '2026-04-11',
        activities: [
          buildPlannerActivity({
            id: 'activity-day2-1',
            trip_day_id: 'day-2',
            order_index: 0,
            title: 'Day 2 Start',
            place_id: day2Start.id,
            place: {
              id: day2Start.id,
              name: day2Start.name,
              category: day2Start.category,
              address_text: day2Start.address_text,
              lat: day2Start.lat,
              lon: day2Start.lon,
              photo_count: day2Start.photo_count ?? 0,
              primary_photo: day2Start.primary_photo,
            },
          }),
          buildPlannerActivity({
            id: 'activity-day2-2',
            trip_day_id: 'day-2',
            order_index: 1,
            title: 'Day 2 End',
            place_id: day2End.id,
            place: {
              id: day2End.id,
              name: day2End.name,
              category: day2End.category,
              address_text: day2End.address_text,
              lat: day2End.lat,
              lon: day2End.lon,
              photo_count: day2End.photo_count ?? 0,
              primary_photo: day2End.primary_photo,
            },
          }),
        ],
      }),
    ]

    try {
      renderWithQueryClient(
        <MemoryRouter>
          <PlannerMapView
            tripId="trip-1"
            tripVersion={3}
            days={days}
            inboxActivities={[]}
            selectedActivityId={null}
            selectedPlaceId={null}
            recommendations={buildRecommendationsController()}
            selectedRecommendation={null}
            trip={buildTrip()}
            onAddActivity={() => {}}
            onSelectActivityId={() => {}}
            onSelectPlaceId={() => {}}
            onSelectRecommendation={() => {}}
            onClearMapSelection={() => {}}
          />
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(routePreviewBodies).toHaveLength(2)
      })

      expect(routePreviewBodies).toEqual([
        {
          origin: { lat: day1Start.lat!, lng: day1Start.lon! },
          destination: { lat: day1End.lat!, lng: day1End.lon! },
          waypoints: [],
          travel_mode: 'WALK',
          compute_alternatives: false,
        },
        {
          origin: { lat: day2Start.lat!, lng: day2Start.lon! },
          destination: { lat: day2End.lat!, lng: day2End.lon! },
          waypoints: [],
          travel_mode: 'WALK',
          compute_alternatives: false,
        },
      ])
    } finally {
      config.map.apiKey = originalApiKey
    }
  })
})

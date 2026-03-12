import { describe, expect, it } from 'vitest'
import type { PlannerDay, RouteLegEstimateItem } from '@/shared/api/types'
import { buildDay, buildPlannerActivity } from '@/test/fixtures/api'
import {
  buildPlannerMapDayMetrics,
  buildPlannerMapMetricsForActivities,
  buildPlannerMapLegPayload,
  buildPlannerMapSections,
  filterVisibleStops,
  optimizePlannerDayStops,
} from './planner-map-utils'

function buildPlannerDay(dayIndex: number, overrides: Partial<PlannerDay> = {}): PlannerDay {
  return {
    ...buildDay({
      id: `day-${dayIndex + 1}`,
      day_index: dayIndex,
      date: `2026-04-${String(dayIndex + 10).padStart(2, '0')}`,
    }),
    activities: [],
    ...overrides,
  }
}

describe('planner-map-utils', () => {
  it('builds stop-based sections with hotel coordinates from planner category details', () => {
    const day = buildPlannerDay(0, {
      activities: [
        buildPlannerActivity({
          id: 'hotel-1',
          trip_day_id: 'day-1',
          order_index: 0,
          category: 'hotel',
          title: 'Domus Giulia',
          place_id: null,
          place: null,
          category_details: {
            hotel_name: 'Domus Giulia',
            address_text: 'Via Example 1',
            latitude: 41.8986,
            longitude: 12.4768,
          },
        }),
        buildPlannerActivity({
          id: 'visit-1',
          trip_day_id: 'day-1',
          order_index: 1,
          category: 'visit',
          title: 'Vatican City',
          place_id: 'place-vatican',
          place: {
            id: 'place-vatican',
            name: 'Vatican City',
            category: 'landmark',
            address_text: 'Vatican City',
            lat: 41.9022,
            lon: 12.4539,
            photo_count: 0,
            primary_photo: null,
          },
        }),
        buildPlannerActivity({
          id: 'eat-1',
          trip_day_id: 'day-1',
          order_index: 2,
          category: 'eat',
          title: 'Lunch stop',
          place_id: 'place-lunch',
          place: {
            id: 'place-lunch',
            name: 'Lunch stop',
            category: 'restaurant',
            address_text: 'Via Lunch 2',
            lat: 41.9064,
            lon: 12.4534,
            photo_count: 0,
            primary_photo: null,
          },
        }),
      ],
    })

    const section = buildPlannerMapSections([day], []).find((item) => item.dayId === 'day-1')!

    expect(section.title).toBe('Day 1')
    expect(section.stops).toHaveLength(3)
    expect(section.stops[0]).toMatchObject({
      isHotel: true,
      lat: 41.8986,
      lon: 12.4768,
      markerNumber: null,
    })
    expect(section.stops[1]?.markerNumber).toBe(1)
    expect(section.stops[2]?.markerNumber).toBe(2)
  })

  it('builds route leg payloads and day metrics from stop occurrences', () => {
    const day = buildPlannerDay(0, {
      activities: [
        buildPlannerActivity({
          id: 'hotel-1',
          trip_day_id: 'day-1',
          order_index: 0,
          category: 'hotel',
          place_id: null,
          place: null,
          category_details: {
            hotel_name: 'Hotel',
            latitude: 41.8986,
            longitude: 12.4768,
          },
        }),
        buildPlannerActivity({
          id: 'visit-1',
          trip_day_id: 'day-1',
          order_index: 1,
          category: 'visit',
          place_id: 'place-visit-1',
          place: {
            id: 'place-visit-1',
            name: 'Stop 1',
            category: 'landmark',
            address_text: 'Rome',
            lat: 41.9022,
            lon: 12.4539,
            photo_count: 0,
            primary_photo: null,
          },
        }),
        buildPlannerActivity({
          id: 'visit-2',
          trip_day_id: 'day-1',
          order_index: 2,
          category: 'visit',
          place_id: 'place-visit-2',
          place: {
            id: 'place-visit-2',
            name: 'Stop 2',
            category: 'landmark',
            address_text: 'Rome',
            lat: 41.9064,
            lon: 12.4534,
            photo_count: 0,
            primary_photo: null,
          },
        }),
      ],
    })

    const sections = buildPlannerMapSections([day], [])
    const legPayload = buildPlannerMapLegPayload(sections)

    expect(legPayload?.legs).toEqual([
      {
        from_activity_id: 'hotel-1',
        to_activity_id: 'visit-1',
        origin: { lat: 41.8986, lng: 12.4768 },
        destination: { lat: 41.9022, lng: 12.4539 },
      },
      {
        from_activity_id: 'visit-1',
        to_activity_id: 'visit-2',
        origin: { lat: 41.9022, lng: 12.4539 },
        destination: { lat: 41.9064, lng: 12.4534 },
      },
    ])

    const metrics = buildPlannerMapDayMetrics(sections, [
      {
        from_activity_id: 'hotel-1',
        to_activity_id: 'visit-1',
        distance_km: 2.1,
        duration_min: 26,
      },
      {
        from_activity_id: 'visit-1',
        to_activity_id: 'visit-2',
        distance_km: 0.4,
        duration_min: 5,
      },
    ])

    expect(metrics['day-1']).toMatchObject({
      distanceKm: 2.5,
      durationMin: 31,
      estimatedLegCount: 2,
    })
    expect(metrics['day-1']?.legs).toHaveLength(2)
  })

  it('matches preview metrics by route leg instead of destination alone', () => {
    const origin = buildPlannerActivity({
      id: 'origin',
      trip_day_id: 'day-1',
      order_index: 0,
      title: 'Origin',
      place_id: 'place-origin',
      place: {
        id: 'place-origin',
        name: 'Origin',
        category: 'landmark',
        address_text: 'A',
        lat: 0,
        lon: 0,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const middle = buildPlannerActivity({
      id: 'middle',
      trip_day_id: 'day-1',
      order_index: 1,
      title: 'Middle',
      place_id: 'place-middle',
      place: {
        id: 'place-middle',
        name: 'Middle',
        category: 'landmark',
        address_text: 'B',
        lat: 0,
        lon: 1,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const destination = buildPlannerActivity({
      id: 'destination',
      trip_day_id: 'day-1',
      order_index: 2,
      title: 'Destination',
      place_id: 'place-destination',
      place: {
        id: 'place-destination',
        name: 'Destination',
        category: 'landmark',
        address_text: 'C',
        lat: 0,
        lon: 2,
        photo_count: 0,
        primary_photo: null,
      },
    })

    const metrics = buildPlannerMapMetricsForActivities(
      [origin, middle, destination],
      [
        {
          from_activity_id: 'origin',
          to_activity_id: 'middle',
          distance_km: 1,
          duration_min: 12,
        },
        {
          from_activity_id: 'origin',
          to_activity_id: 'destination',
          distance_km: 2,
          duration_min: 24,
        },
        {
          from_activity_id: 'middle',
          to_activity_id: 'destination',
          distance_km: 0.5,
          duration_min: 6,
        },
      ],
    )

    expect(metrics.legs).toMatchObject([
      {
        fromActivityId: 'origin',
        toActivityId: 'middle',
        distanceKm: 1,
        durationMin: 12,
      },
      {
        fromActivityId: 'middle',
        toActivityId: 'destination',
        distanceKm: 0.5,
        durationMin: 6,
      },
    ])
  })

  it('filters visible stops by day and planner layer groups', () => {
    const days = [
      buildPlannerDay(0, {
        activities: [
          buildPlannerActivity({
            id: 'day-1-visit',
            trip_day_id: 'day-1',
            order_index: 0,
            category: 'visit',
          }),
          buildPlannerActivity({
            id: 'day-1-hotel',
            trip_day_id: 'day-1',
            order_index: 1,
            category: 'hotel',
            place_id: null,
            place: null,
            category_details: {
              hotel_name: 'Stay',
              latitude: 41.89,
              longitude: 12.49,
            },
          }),
        ],
      }),
      buildPlannerDay(1, {
        activities: [
          buildPlannerActivity({
            id: 'day-2-eat',
            trip_day_id: 'day-2',
            order_index: 0,
            category: 'eat',
          }),
        ],
      }),
    ]

    const sections = buildPlannerMapSections(days, [])
    const visibleStops = filterVisibleStops(
      sections,
      new Set(['day-1']),
      new Set(['visit', 'hotel']),
    )

    expect(visibleStops.map((stop) => stop.activity.id)).toEqual(['day-1-visit', 'day-1-hotel'])
  })

  it('optimizes a day with deterministic nearest-neighbor plus refinement', () => {
    const day = buildPlannerDay(0, {
      activities: [
        buildPlannerActivity({
          id: 'a',
          trip_day_id: 'day-1',
          order_index: 0,
          title: 'Start',
          place_id: 'place-a',
          place: {
            id: 'place-a',
            name: 'Start',
            category: 'landmark',
            address_text: 'A',
            lat: 0,
            lon: 0,
            photo_count: 0,
            primary_photo: null,
          },
        }),
        buildPlannerActivity({
          id: 'b',
          trip_day_id: 'day-1',
          order_index: 1,
          title: 'B',
          place_id: 'place-b',
          place: {
            id: 'place-b',
            name: 'B',
            category: 'landmark',
            address_text: 'B',
            lat: 0,
            lon: 2,
            photo_count: 0,
            primary_photo: null,
          },
        }),
        buildPlannerActivity({
          id: 'c',
          trip_day_id: 'day-1',
          order_index: 2,
          title: 'C',
          place_id: 'place-c',
          place: {
            id: 'place-c',
            name: 'C',
            category: 'landmark',
            address_text: 'C',
            lat: 0,
            lon: 1,
            photo_count: 0,
            primary_photo: null,
          },
        }),
        buildPlannerActivity({
          id: 'd',
          trip_day_id: 'day-1',
          order_index: 3,
          title: 'D',
          place_id: 'place-d',
          place: {
            id: 'place-d',
            name: 'D',
            category: 'landmark',
            address_text: 'D',
            lat: 0,
            lon: 1.1,
            photo_count: 0,
            primary_photo: null,
          },
        }),
      ],
    })

    const section = buildPlannerMapSections([day], []).find((item) => item.dayId === 'day-1')!
    const estimateTuples: Array<[string, string, number]> = [
      ['a', 'b', 9],
      ['a', 'c', 1],
      ['a', 'd', 1.1],
      ['b', 'c', 8],
      ['b', 'd', 6],
      ['c', 'b', 5],
      ['c', 'd', 0.1],
      ['d', 'b', 0.9],
      ['d', 'c', 0.1],
    ]
    const estimates: RouteLegEstimateItem[] = [
      ...estimateTuples.map(([from, to, distance]) => ({
      from_activity_id: from,
      to_activity_id: to,
      distance_km: distance,
      duration_min: Math.round(distance * 10),
      })),
    ]

    expect(optimizePlannerDayStops(section, estimates)).toEqual(['a', 'c', 'd', 'b'])
  })
})

import { describe, expect, it } from 'vitest'
import { buildPlannerActivity } from '@/test/fixtures/api'
import { plannerCategoryDescription, plannerPrimaryPlace, plannerTravelRoute } from './categories'

describe('planner board category helpers', () => {
  it('returns safe empty values for missing activities', () => {
    expect(plannerCategoryDescription(undefined)).toBeNull()
    expect(plannerPrimaryPlace(undefined)).toBeNull()
    expect(plannerTravelRoute(undefined)).toEqual([])
  })

  it('derives a hotel place from category details', () => {
    const activity = buildPlannerActivity({
      category: 'hotel',
      place: null,
      place_id: null,
      category_details: {
        hotel_name: 'Domus Giulia',
        address_text: 'Via Example 1',
        latitude: 41.8986,
        longitude: 12.4768,
      },
    })

    expect(plannerPrimaryPlace(activity)).toMatchObject({
      name: 'Domus Giulia',
      address_text: 'Via Example 1',
      lat: 41.8986,
      lon: 12.4768,
    })
    expect(plannerCategoryDescription(activity)).toBe('Domus Giulia')
  })
})

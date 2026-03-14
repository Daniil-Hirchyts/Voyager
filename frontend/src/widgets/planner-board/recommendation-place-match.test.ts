import { describe, expect, it } from 'vitest'
import type { GooglePlaceCandidate } from '@/shared/api/types'
import {
  buildRecommendationPlaceQueries,
  selectBestRecommendationPlaceMatch,
} from './recommendation-place-match'

function buildGoogleCandidate(
  overrides: Partial<GooglePlaceCandidate> = {},
): GooglePlaceCandidate {
  return {
    place_id: 'google-place-1',
    label: 'Basilica de la Sagrada Familia, Barcelona, Spain',
    name: 'Basilica de la Sagrada Familia',
    address_text: "C/ de Mallorca, 401, L'Eixample, 08013 Barcelona, Spain",
    category: 'church',
    country: 'Spain',
    region: 'Catalonia',
    lat: 41.4036,
    lon: 2.1744,
    timezone: 'Europe/Madrid',
    metadata: {},
    ...overrides,
  }
}

describe('recommendation place matching', () => {
  it('builds distinct queries from the recommendation and destination text', () => {
    expect(
      buildRecommendationPlaceQueries({
        title: 'Casa Batllo',
        addressText: 'Eixample',
        destinationText: 'Barcelona, Spain',
        lat: null,
        lon: null,
      }),
    ).toEqual([
      'Casa Batllo, Eixample, Barcelona, Spain',
      'Casa Batllo, Barcelona, Spain',
      'Casa Batllo',
    ])
  })

  it('prefers the canonical Google place when the title and location line up', () => {
    const match = selectBestRecommendationPlaceMatch(
      {
        title: 'Basilica de la Sagrada Familia',
        addressText: 'Eixample',
        destinationText: 'Barcelona, Spain',
        lat: 41.4037,
        lon: 2.1743,
      },
      [
        buildGoogleCandidate({
          place_id: 'wrong-place',
          name: 'Barcelona Cathedral',
          address_text: 'Pla de la Seu, s/n, Ciutat Vella, 08002 Barcelona, Spain',
          lat: 41.3839,
          lon: 2.1763,
        }),
        buildGoogleCandidate(),
      ],
    )

    expect(match?.place_id).toBe('google-place-1')
  })

  it('rejects weak Google matches instead of snapping to the wrong place', () => {
    const match = selectBestRecommendationPlaceMatch(
      {
        title: 'Local sunset walk',
        addressText: 'Waterfront',
        destinationText: 'Barcelona, Spain',
        lat: null,
        lon: null,
      },
      [
        buildGoogleCandidate({
          name: 'Sushi Barcelona',
          address_text: 'Carrer de la Marina, 19, Barcelona, Spain',
        }),
      ],
    )

    expect(match).toBeNull()
  })
})

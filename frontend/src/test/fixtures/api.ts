import type {
  Activity,
  Day,
  Job,
  Offer,
  Place,
  Trip,
} from '@/shared/api/types'

const NOW = '2026-03-06T09:00:00.000Z'

export function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    user_id: 'user-1',
    title: 'Paris Atlas',
    destination_text: 'Paris, France',
    start_date: '2026-04-10',
    end_date: '2026-04-12',
    budget_amount: '1600.00',
    budget_currency: 'EUR',
    trip_type: 'city_break',
    preferences: ['museums', 'cafes'],
    version: 3,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildDay(overrides: Partial<Day> = {}): Day {
  return {
    id: 'day-1',
    trip_id: 'trip-1',
    day_index: 0,
    date: '2026-04-10',
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    trip_day_id: 'day-1',
    order_index: 0,
    title: 'Morning walk',
    description: 'Start in the Marais.',
    start_time: '09:00',
    duration_min: 90,
    tags: ['walking'],
    estimated_cost_amount: '0.00',
    estimated_cost_currency: 'EUR',
    place_id: null,
    event_snapshot_id: null,
    notes: null,
    is_favorite: false,
    source: 'manual',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'place-1',
    source: 'seed',
    external_id: 'seed-place-1',
    name: 'Louvre Museum',
    category: 'museum',
    address_text: 'Rue de Rivoli, Paris',
    lat: 48.8606,
    lon: 2.3376,
    metadata: {},
    canonical_place_id: null,
    is_canonical: true,
    dedup_confidence: 1,
    merged_at: null,
    photo_count: 1,
    primary_photo: {
      id: 'photo-1',
      source: 'seed',
      image_url: 'https://images.example.com/louvre.jpg',
      thumbnail_url: 'https://images.example.com/louvre-thumb.jpg',
      license_code: null,
      license_url: null,
      attribution_text: null,
    },
    distance_m: 120,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    kind: 'transport',
    trip_id: 'trip-1',
    trip_day_id: null,
    provider: 'Amadeus',
    title: 'CDG to BCN nonstop',
    price_amount: '189.90',
    currency: 'EUR',
    deep_link: 'https://provider.example.com/offer-1',
    expires_at: '2026-03-06T18:00:00.000Z',
    is_current: true,
    superseded_by_offer_id: null,
    created_at: NOW,
    updated_at: NOW,
    transport_mode: 'flight',
    origin_text: 'CDG',
    destination_text: 'BCN',
    depart_at: '2026-04-10T07:00:00.000Z',
    arrive_at: '2026-04-10T08:55:00.000Z',
    location_text: null,
    lodging_type: null,
    room_type: null,
    checkin_date: null,
    checkout_date: null,
    nights: null,
    ...overrides,
  }
}

export function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'offers.transport.search',
    status: 'SUCCEEDED',
    payload: {},
    result: {},
    error: null,
    attempts: 1,
    max_attempts: 3,
    available_at: NOW,
    dead_lettered_at: null,
    created_at: NOW,
    started_at: NOW,
    finished_at: NOW,
    ...overrides,
  }
}

export function listResponse<T>(items: T[]) {
  return {
    total: items.length,
    limit: items.length || 50,
    offset: 0,
    items,
  }
}

export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return {
    status,
    body: {
      error: {
        code,
        message,
        details,
        trace_id: 'trace-test',
      },
    },
  }
}

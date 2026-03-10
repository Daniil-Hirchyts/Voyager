import type {
  Activity,
  ActivityDiscoveryDetail,
  ActivityDiscoveryItem,
  ActivityRecommendationItem,
  Day,
  ExportResponse,
  Job,
  Offer,
  Place,
  PlacePhoto,
  PlannerActivity,
  PlannerDay,
  PlannerResponse,
  ProposalActivityResponse,
  ProposalResponse,
  Trip,
  TripMapLayer,
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

export function buildPlannerActivity(overrides: Partial<PlannerActivity> = {}): PlannerActivity {
  const place = buildPlace()
  return {
    id: 'planner-activity-1',
    trip_day_id: 'day-1',
    order_index: 0,
    title: 'Louvre opening hour circuit',
    description: 'Start at the museum before the heaviest crowds.',
    start_time: '09:00',
    end_time: '11:00',
    duration_min: 120,
    tags: ['museum', 'art', 'morning'],
    estimated_cost_amount: '22.00',
    estimated_cost_currency: 'EUR',
    place_id: place.id,
    place: {
      id: place.id,
      name: place.name,
      category: place.category,
      address_text: place.address_text,
      lat: place.lat,
      lon: place.lon,
      photo_count: place.photo_count ?? 0,
      primary_photo: place.primary_photo,
    },
    event_snapshot_id: null,
    notes: null,
    is_favorite: false,
    source: 'generated',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildPlannerDay(overrides: Partial<PlannerDay> = {}): PlannerDay {
  return {
    ...buildDay(),
    activities: [buildPlannerActivity()],
    ...overrides,
  }
}

export function buildPlannerResponse(overrides: Partial<PlannerResponse> = {}): PlannerResponse {
  return {
    trip: buildTrip(),
    inbox_activities: [],
    days: [buildPlannerDay()],
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

export function buildTripMapLayer(overrides: Partial<TripMapLayer> = {}): TripMapLayer {
  return {
    id: 'layer-1',
    trip_id: 'trip-1',
    name: 'Primary walking corridor',
    source: 'manual_draw',
    renderer: 'native',
    feature_collection: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            source: 'manual_draw',
            mode: 'linestring',
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [2.3376, 48.8606],
              [2.3333, 48.86],
            ],
          },
        },
      ],
    },
    style: {
      strokeColor: '#2F6F73',
      strokeWeight: 4,
      strokeOpacity: 0.9,
    },
    metadata: {
      distance_m: 420,
    },
    is_visible: true,
    is_locked: false,
    order_index: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildOffer(overrides: Partial<Offer> = {}): Offer {
  const kind = overrides.kind ?? 'transport'

  const baseOffer: Offer = {
    id: 'offer-1',
    kind,
    trip_id: 'trip-1',
    trip_day_id: null,
    provider: 'Amadeus',
    title: kind === 'lodging' ? 'Hotel Louvre Palace' : 'CDG to BCN nonstop',
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
    transport_details: kind === 'transport'
      ? {
        segments: [
          {
            itinerary_index: 0,
            sequence: 1,
            airline_code: 'AF',
            airline_name: 'Air France',
            operating_airline_code: 'AF',
            operating_airline_name: 'Air France',
            flight_number: '1148',
            departure_iata: 'CDG',
            departure_at: '2026-04-10T07:00:00.000Z',
            departure_terminal: '2F',
            arrival_iata: 'BCN',
            arrival_at: '2026-04-10T08:55:00.000Z',
            arrival_terminal: '1',
            duration_min: 115,
            cabin: 'ECONOMY',
            fare_basis: 'LITE',
            branded_fare: 'Light',
            baggage_summary: '1 checked bag',
          },
        ],
        layovers: [],
        stops_count: 0,
        total_duration_min: 115,
        cabin: 'ECONOMY',
        baggage_summary: '1 checked bag',
        validating_airline_codes: ['AF'],
        bookable_seats: 4,
        additional_baggage_price: '35.00',
        additional_baggage_currency: 'EUR',
        emissions_kg: '115',
        emissions_description: '+8% emissions',
        origin_geo: { latitude: 49.0097, longitude: 2.5479 },
        destination_geo: { latitude: 41.2974, longitude: 2.0833 },
      }
      : null,
    lodging_details: kind === 'lodging'
      ? {
        hotel_id: 'H1',
        hotel_name: 'Hotel Louvre Palace',
        chain_code: 'HL',
        brand: 'Voyager Collection',
        star_rating: 4.6,
        sentiment_rating: 86.2,
        amenities: ['wifi', 'breakfast', 'pool'],
        address_text: '12 Rue de Rivoli, Paris',
        latitude: 48.8606,
        longitude: 2.3376,
        distance_km: 0.8,
        room_description: 'Deluxe king room with courtyard view',
        payment_type: 'Guarantee required',
        cancellation_summary: 'Free cancellation before Apr 8',
        nightly_rate_amount: '94.95',
        taxes_amount: '18.00',
        place_id: 'place-1',
        photo_count: 1,
        primary_photo: {
          id: 'photo-1',
          source: 'seed',
          image_url: 'https://images.example.com/hotel-1.jpg',
          thumbnail_url: 'https://images.example.com/hotel-1-thumb.jpg',
          license_code: null,
          license_url: null,
          attribution_text: null,
        },
      }
      : null,
  }

  if (kind === 'lodging') {
    baseOffer.transport_mode = null
    baseOffer.origin_text = null
    baseOffer.destination_text = null
    baseOffer.depart_at = null
    baseOffer.arrive_at = null
    baseOffer.location_text = 'Paris'
    baseOffer.lodging_type = 'hotel'
    baseOffer.room_type = 'Deluxe king room'
    baseOffer.checkin_date = '2026-04-10'
    baseOffer.checkout_date = '2026-04-12'
    baseOffer.nights = 2
  }

  return {
    ...baseOffer,
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

export function buildActivityDiscoveryItem(
  overrides: Partial<ActivityDiscoveryItem> = {},
): ActivityDiscoveryItem {
  return {
    id: 'activity-discovery-1',
    snapshot_id: null,
    trip_id: 'trip-1',
    trip_day_id: null,
    place_id: null,
    entity_type: 'attraction',
    provider: 'tripadvisor',
    provider_ref: 'tripadvisor-ref-1',
    title: 'Louvre Museum',
    summary: 'A shortlist-worthy art and history anchor in central Paris.',
    rating: 4.8,
    review_count: 18342,
    price_label: '$$',
    image_url: 'https://images.example.com/louvre.jpg',
    detail_url: 'https://tripadvisor.com/louvre',
    address_text: 'Rue de Rivoli, Paris, France',
    lat: 48.8606,
    lon: 2.3376,
    tags: ['museum', 'culture'],
    status_text: 'Open now',
    is_attachable: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildActivityDiscoveryDetail(
  overrides: Partial<ActivityDiscoveryDetail> = {},
): ActivityDiscoveryDetail {
  return {
    ...buildActivityDiscoveryItem(),
    photos: [
      {
        image_url: 'https://images.example.com/louvre-detail.jpg',
        thumbnail_url: 'https://images.example.com/louvre-detail-thumb.jpg',
        width: 1200,
        height: 800,
        caption: 'Glass pyramid at dusk',
      },
    ],
    reviews: [
      {
        review_id: 'review-1',
        title: 'Excellent curation',
        text: 'Give yourself a full morning if you want to cover the highlights.',
        rating: 5,
        published_at: '2026-02-14',
        reviewer_name: 'Alex',
        reviewer_username: 'alex-travels',
        review_url: 'https://tripadvisor.com/review-1',
      },
    ],
    hours: [
      {
        day: 'Monday',
        times: [{ open: '09:00', close: '18:00' }],
      },
    ],
    booking_links: [
      {
        label: 'Tickets',
        url: 'https://tripadvisor.com/louvre/tickets',
      },
    ],
    provider_payload: { source: 'fixture' },
    ...overrides,
  }
}

export function buildActivityRecommendationItem(
  overrides: Partial<ActivityRecommendationItem> = {},
): ActivityRecommendationItem {
  return {
    snapshot_id: 'snapshot-1',
    trip_day_id: 'day-1',
    score: 0.91,
    rationale: 'High rating, central location, and a strong cultural match for the day.',
    item: buildActivityDiscoveryItem({
      snapshot_id: 'snapshot-1',
      id: 'snapshot-1',
    }),
    ...overrides,
  }
}

export function buildPlacePhoto(overrides: Partial<PlacePhoto> = {}): PlacePhoto {
  return {
    id: 'photo-1',
    place_id: 'place-1',
    source: 'unsplash',
    source_media_ref: 'unsplash-abc',
    image_url: 'https://images.example.com/photo-1.jpg',
    thumbnail_url: 'https://images.example.com/photo-1-thumb.jpg',
    width: 1920,
    height: 1280,
    license_code: 'unsplash',
    license_url: 'https://unsplash.com/license',
    author_name: 'Test Photographer',
    author_url: null,
    attribution_text: 'Photo by Test Photographer on Unsplash',
    rank: 0,
    is_primary: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildProposalActivity(overrides: Partial<ProposalActivityResponse> = {}): ProposalActivityResponse {
  return {
    id: 'prop-act-1',
    proposal_id: 'proposal-1',
    trip_day_id: 'day-1',
    source_activity_id: null,
    event_snapshot_id: null,
    place_id: null,
    order_index: 0,
    title: 'Morning museum visit',
    description: 'Start the day at the Louvre.',
    start_time: '09:00',
    duration_min: 120,
    estimated_cost_amount: '17.00',
    estimated_cost_currency: 'EUR',
    tags: ['culture'],
    rationale: { reason: 'High visitor rating and central location.' },
    score: { total: 0.87 },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildProposal(overrides: Partial<ProposalResponse> = {}): ProposalResponse {
  const act = buildProposalActivity()
  return {
    id: 'proposal-1',
    trip_id: 'trip-1',
    user_id: 'user-1',
    job_id: 'job-proposal-1',
    based_on_trip_version: 3,
    objective: 'balanced_flow',
    scope_day_ids: ['day-1'],
    status: 'SUCCEEDED',
    summary: { activities_changed: 2, days_affected: 1 },
    score: { total: 0.87 },
    items: [act],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildExport(overrides: Partial<ExportResponse> = {}): ExportResponse {
  return {
    id: 'export-1',
    job_id: 'job-export-1',
    user_id: 'user-1',
    trip_id: 'trip-1',
    format: 'json',
    status: 'SUCCEEDED',
    trip_version: 3,
    content_type: 'application/json',
    size_bytes: 2048,
    sha256: 'abc123',
    error: null,
    created_at: NOW,
    finished_at: NOW,
    expires_at: null,
    deleted_at: null,
    download_url: null,
    ...overrides,
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

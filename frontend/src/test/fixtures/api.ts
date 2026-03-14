import type {
  Activity,
  ActivityDiscoveryDetail,
  ActivityDiscoveryItem,
  ActivityRecommendationItem,
  Day,
  ExportResponse,
  Job,
  Place,
  PlacePhoto,
  TripAssetResponse,
  PlannerActivity,
  PlannerDay,
  PlannerResponse,
  ProposalActivityResponse,
  ProposalResponse,
  Trip,
  TripCollaborator,
  TripInvitation,
  TripInvitationPreview,
  TripMapLayer,
  TripSharingResponse,
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
    route_travel_mode: 'WALK',
    current_user_role: 'owner',
    collaborator_count: 0,
    version: 3,
    coverPreference: null,
    coverPhoto: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildTripCollaborator(overrides: Partial<TripCollaborator> = {}): TripCollaborator {
  return {
    id: 'collaborator-1',
    trip_id: 'trip-1',
    user_id: 'user-2',
    role: 'editor',
    email: 'collaborator@example.com',
    display_name: 'Alex Traveler',
    invited_by_user_id: 'user-1',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildTripInvitation(overrides: Partial<TripInvitation> = {}): TripInvitation {
  return {
    id: 'invitation-1',
    trip_id: 'trip-1',
    created_by_user_id: 'user-1',
    role: 'editor',
    invite_path: '/app/invites/token-1',
    accepted_at: null,
    revoked_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function buildTripSharingResponse(overrides: Partial<TripSharingResponse> = {}): TripSharingResponse {
  return {
    trip_id: 'trip-1',
    current_user_role: 'owner',
    collaborators: [
      buildTripCollaborator({
        id: null,
        user_id: 'user-1',
        role: 'owner',
        email: 'owner@example.com',
        display_name: 'Voyager Owner',
        invited_by_user_id: null,
      }),
      buildTripCollaborator(),
    ],
    pending_invitations: [buildTripInvitation()],
    ...overrides,
  }
}

export function buildTripInvitationPreview(
  overrides: Partial<TripInvitationPreview> = {},
): TripInvitationPreview {
  return {
    invitation_id: 'invitation-1',
    trip_id: 'trip-1',
    trip_title: 'Paris Atlas',
    destination_text: 'Paris, France',
    inviter_display_name: 'Voyager Owner',
    inviter_email: 'owner@example.com',
    role: 'editor',
    created_at: NOW,
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
    category: 'visit',
    category_details: {},
    title: 'Morning walk',
    description: 'Start in the Marais.',
    start_time: '09:00',
    duration_min: 90,
    estimated_cost_amount: '0.00',
    estimated_cost_currency: 'EUR',
    place_id: null,
    event_snapshot_id: null,
    notes: null,
    is_favorite: false,
    visited_at: null,
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
    category: 'visit',
    category_details: {},
    title: 'Louvre opening hour circuit',
    description: 'Start at the museum before the heaviest crowds.',
    start_time: '09:00',
    duration_min: 120,
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
    visited_at: null,
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

export function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'itinerary.generate',
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

export function buildTripAsset(overrides: Partial<TripAssetResponse> = {}): TripAssetResponse {
  return {
    id: 'asset-1',
    user_id: 'user-1',
    trip_id: 'trip-1',
    activity_id: null,
    kind: 'file',
    original_filename: 'boarding-pass.pdf',
    content_type: 'application/pdf',
    size_bytes: 185024,
    sha256: 'abc123',
    image_width: null,
    image_height: null,
    preview_url: 'http://localhost:9000/voyager-media/asset-1-preview?signature=test',
    download_url: 'http://localhost:9000/voyager-media/asset-1?signature=test',
    created_at: NOW,
    updated_at: NOW,
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
    category: 'visit',
    start_time: '09:00',
    duration_min: 120,
    estimated_cost_amount: '17.00',
    estimated_cost_currency: 'EUR',
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

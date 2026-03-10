import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type { components } from './generated/schema'

export type UserProfile = components['schemas']['UserProfileResponse']
export type UserProfilePatchInput = components['schemas']['UserProfilePatchRequest']

export type Trip = components['schemas']['TripResponse']
export type TripListResponse = components['schemas']['TripListResponse']
export type TripCreateInput = components['schemas']['TripCreateRequest']
export type TripUpdateInput = components['schemas']['TripPatchRequest']
export type GenerationMode = components['schemas']['GenerationMode']
export type TripGenerateInput = components['schemas']['TripGenerateRequest']
export type TripRegenerateInput = components['schemas']['TripRegenerateRequest']
export type TripResetInput = components['schemas']['TripResetItineraryRequest']

export type Day = components['schemas']['DayResponse']
export type DayListResponse = components['schemas']['DayListResponse']
export type DayUpdateInput = components['schemas']['DayPatchRequest']

export type ActivityReorderInput = components['schemas']['ActivityReorderRequest']
export type ActivityMoveInput = components['schemas']['ActivityMoveRequest']
export type ActivityCategory = 'visit' | 'eat' | 'activity' | 'hotel' | 'travel'

export type PlannerPlaceSummary = {
  id: string
  name: string
  category: string | null
  address_text: string | null
  lat: number | null
  lon: number | null
  photo_count: number
  primary_photo: Place['primary_photo'] | null
}

export type PlannerLinkedOfferSummary = {
  kind: OfferKind
  offer_id: string
  title: string
  deep_link: string | null
  price_amount: string | null
  currency: string | null
}

export interface Activity {
  id: string
  trip_day_id: string | null
  order_index: number
  category: ActivityCategory
  category_details: Record<string, unknown>
  title: string
  description: string | null
  start_time: string | null
  duration_min: number | null
  estimated_cost_amount: string | null
  estimated_cost_currency: string | null
  place_id: string | null
  event_snapshot_id: string | null
  notes: string | null
  is_favorite: boolean
  source: string
  linked_offer_kind: OfferKind | null
  linked_offer_id: string | null
  created_at: string
  updated_at: string
}

export interface ActivityListResponse {
  total: number
  limit: number
  offset: number
  items: Activity[]
}

export interface ActivityCreateInput {
  trip_day_id?: string | null
  category: ActivityCategory
  category_details?: Record<string, unknown>
  title: string
  description?: string | null
  start_time?: string | null
  duration_min?: number | null
  estimated_cost_amount?: number | string | null
  estimated_cost_currency?: string | null
  place_id?: string | null
  notes?: string | null
  is_favorite?: boolean
  source?: string
}

export interface ActivityUpdateInput {
  category?: ActivityCategory | null
  category_details?: Record<string, unknown> | null
  title?: string | null
  description?: string | null
  start_time?: string | null
  duration_min?: number | null
  estimated_cost_amount?: number | string | null
  estimated_cost_currency?: string | null
  place_id?: string | null
  notes?: string | null
  is_favorite?: boolean | null
  source?: string | null
}

export interface PlannerActivity extends Activity {
  place: PlannerPlaceSummary | null
  linked_offer_summary?: PlannerLinkedOfferSummary | null
  legacy_source_day_id?: string | null
  legacy_inbox_item?: boolean
}

export type PlannerDay = Day & {
  activities: PlannerActivity[]
}

export type PlannerResponse = {
  trip: Trip
  inbox_activities: PlannerActivity[]
  days: PlannerDay[]
  legacy_inbox_mode?: boolean
}

export type PlannerGenerationReport = {
  jobId: string
  status: string
  result: Record<string, unknown> | null
  error: Record<string, unknown> | null
}

export type MapLayerRenderer = 'native' | 'deckgl' | 'dds-boundary' | 'dds-dataset'
export type MapLayerSource = 'manual_draw' | 'routes' | 'places' | 'analytics'
export type TripMapFeatureCollection = FeatureCollection<Geometry, GeoJsonProperties>

export interface TripMapLayer {
  id: string
  trip_id: string
  name: string
  source: MapLayerSource
  renderer: MapLayerRenderer
  feature_collection: TripMapFeatureCollection
  style: Record<string, unknown>
  metadata: Record<string, unknown>
  is_visible: boolean
  is_locked: boolean
  order_index: number
  created_at: string
  updated_at: string
}

export interface TripMapLayerListResponse {
  total: number
  limit: number
  offset: number
  items: TripMapLayer[]
}

export interface TripMapLayerCreateRequest {
  name: string
  source: MapLayerSource
  renderer: MapLayerRenderer
  feature_collection: TripMapFeatureCollection
  style?: Record<string, unknown>
  metadata?: Record<string, unknown>
  is_visible?: boolean
  is_locked?: boolean
  order_index?: number | null
}

export interface TripMapLayerPatchRequest {
  name?: string
  source?: MapLayerSource
  renderer?: MapLayerRenderer
  feature_collection?: TripMapFeatureCollection
  style?: Record<string, unknown>
  metadata?: Record<string, unknown>
  is_visible?: boolean
  is_locked?: boolean
  order_index?: number
}

export type Job = components['schemas']['JobResponse']
export type JobListResponse = components['schemas']['JobListResponse']
export type JobAcceptedResponse = components['schemas']['JobAcceptedResponse']

export type Place = components['schemas']['PlaceResponse']
export type PlaceListResponse = components['schemas']['PlaceListResponse']
export type PlaceCreateInput = components['schemas']['PlaceCreateRequest']
export type PlacePhoto = components['schemas']['PlacePhotoResponse']
export type PlacePhotoListResponse = components['schemas']['PlacePhotoListResponse']

export interface GooglePlaceCandidate {
  place_id: string
  label: string
  name: string
  address_text: string | null
  category: string | null
  country: string | null
  region: string | null
  lat: number | null
  lon: number | null
  timezone: string | null
  metadata: Record<string, unknown>
}

export interface GooglePlaceSearchResponse {
  total: number
  limit: number
  offset: number
  items: GooglePlaceCandidate[]
}

export type RouteTravelMode = 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT'

export interface RoutePoint {
  lat: number
  lng: number
}

export interface RoutePreviewInput {
  origin: RoutePoint
  destination: RoutePoint
  waypoints?: RoutePoint[]
  travel_mode?: RouteTravelMode
  compute_alternatives?: boolean
}

export interface RoutePreviewRoute {
  summary: string | null
  distance_m: number | null
  duration_min: number | null
  static_duration_min: number | null
  path: RoutePoint[]
}

export interface RoutePreviewResponse {
  routes: RoutePreviewRoute[]
}

export interface RouteLegEstimateRequestItem {
  from_activity_id: string
  to_activity_id: string
  origin: RoutePoint
  destination: RoutePoint
}

export interface RouteLegEstimateInput {
  legs: RouteLegEstimateRequestItem[]
  travel_mode?: RouteTravelMode
}

export interface RouteLegEstimateItem {
  from_activity_id: string
  to_activity_id: string
  distance_km: number | null
  duration_min: number | null
}

export interface RouteLegEstimateResponse {
  items: RouteLegEstimateItem[]
}

export type OfferKind = components['schemas']['OfferKind']
export type OfferAttachDayInput = components['schemas']['OfferAttachDayRequest']
export type OfferRefreshInput = components['schemas']['OfferRefreshRequest']
export type TripOffersRefreshInput = components['schemas']['TripOffersRefreshRequest']
export type TransportOfferSearchInput = components['schemas']['TransportOfferSearchRequest']
export type LodgingOfferSearchInput = components['schemas']['LodgingOfferSearchRequest']
export type TransportMode = components['schemas']['TransportMode']
export type LodgingType = components['schemas']['LodgingType']

export interface PlacePhotoSummary {
  id: string
  source: string
  image_url: string
  thumbnail_url: string | null
  display_url?: string | null
  display_thumbnail_url?: string | null
  license_code: string | null
  license_url: string | null
  attribution_text: string | null
}

export interface OfferGeoPoint {
  latitude: number
  longitude: number
}

export interface TransportSegmentDetail {
  itinerary_index: number
  sequence: number
  airline_code: string | null
  airline_name: string | null
  operating_airline_code: string | null
  operating_airline_name: string | null
  flight_number: string | null
  departure_iata: string | null
  departure_at: string | null
  departure_terminal: string | null
  arrival_iata: string | null
  arrival_at: string | null
  arrival_terminal: string | null
  duration_min: number | null
  cabin: string | null
  fare_basis: string | null
  branded_fare: string | null
  baggage_summary: string | null
}

export interface TransportLayoverDetail {
  itinerary_index: number
  airport_code: string | null
  duration_min: number | null
}

export interface TransportOfferDetails {
  segments: TransportSegmentDetail[]
  layovers: TransportLayoverDetail[]
  stops_count: number | null
  total_duration_min: number | null
  cabin: string | null
  baggage_summary: string | null
  validating_airline_codes: string[]
  bookable_seats: number | null
  additional_baggage_price: string | null
  additional_baggage_currency: string | null
  emissions_kg: string | null
  emissions_description: string | null
  origin_geo: OfferGeoPoint | null
  destination_geo: OfferGeoPoint | null
}

export interface LodgingOfferDetails {
  hotel_id: string | null
  hotel_name: string | null
  chain_code: string | null
  brand: string | null
  star_rating: number | null
  sentiment_rating: number | null
  amenities: string[]
  address_text: string | null
  latitude: number | null
  longitude: number | null
  distance_km: number | null
  room_description: string | null
  payment_type: string | null
  cancellation_summary: string | null
  nightly_rate_amount: string | null
  taxes_amount: string | null
  place_id: string | null
  photo_count: number
  primary_photo: PlacePhotoSummary | null
}

type OfferBase = components['schemas']['OfferResponse']

export type Offer = OfferBase & {
  transport_details?: TransportOfferDetails | null
  lodging_details?: LodgingOfferDetails | null
}

export interface OfferListResponse {
  total: number
  limit: number
  offset: number
  items: Offer[]
}

export type ExportFormat = components['schemas']['ExportFormat']
export type ExportResponse = components['schemas']['ExportResponse']
export type TripExportCreateInput = components['schemas']['TripExportCreateRequest']

export type ActivityEntityType = 'attraction' | 'restaurant' | 'hotel' | 'cruise'

export interface ActivityDiscoveryItem {
  id: string
  snapshot_id: string | null
  trip_id: string | null
  trip_day_id: string | null
  place_id: string | null
  entity_type: ActivityEntityType
  provider: string
  provider_ref: string
  title: string
  summary: string | null
  rating: number | null
  review_count: number | null
  price_label: string | null
  image_url: string | null
  detail_url: string | null
  address_text: string | null
  lat: number | null
  lon: number | null
  status_text: string | null
  is_attachable: boolean
  created_at: string | null
  updated_at: string | null
}

export interface ActivityDiscoveryPhoto {
  image_url: string
  thumbnail_url: string | null
  width: number | null
  height: number | null
  caption: string | null
}

export interface ActivityDiscoveryReview {
  review_id: string
  title: string | null
  text: string | null
  rating: number | null
  published_at: string | null
  reviewer_name: string | null
  reviewer_username: string | null
  review_url: string | null
}

export interface ActivityDiscoveryHoursWindow {
  open: string | null
  close: string | null
}

export interface ActivityDiscoveryHoursDay {
  day: string
  times: ActivityDiscoveryHoursWindow[]
}

export interface ActivityDiscoveryBookingLink {
  label: string
  url: string
}

export interface ActivityDiscoveryDetail extends ActivityDiscoveryItem {
  photos: ActivityDiscoveryPhoto[]
  reviews: ActivityDiscoveryReview[]
  hours: ActivityDiscoveryHoursDay[]
  booking_links: ActivityDiscoveryBookingLink[]
  provider_payload: Record<string, unknown>
}

export interface ActivityDiscoveryListResponse {
  total: number
  limit: number
  offset: number
  page: number
  entity_type: ActivityEntityType
  items: ActivityDiscoveryItem[]
}

export interface ActivityDiscoverInput {
  entity_type: ActivityEntityType
  query?: string
  page?: number
  limit?: number
  locale?: string
  currency?: string
  min_rating?: number
  good_for?: string
  establishment_type?: string
  meal_type?: string
  departure_date?: string
  cruise_length?: string
}

export interface ActivityShortlistSaveInput {
  entity_type: ActivityEntityType
  provider: string
  provider_ref: string
  title: string
  summary?: string | null
  rating?: number | null
  review_count?: number | null
  price_label?: string | null
  image_url?: string | null
  detail_url?: string | null
  address_text?: string | null
  lat?: number | null
  lon?: number | null
  status_text?: string | null
  start_at?: string | null
  end_at?: string | null
  timezone?: string | null
  min_price?: string | null
  max_price?: string | null
  currency?: string | null
  raw_payload?: Record<string, unknown>
}

export interface ActivityShortlistListResponse {
  total: number
  limit: number
  offset: number
  items: ActivityDiscoveryItem[]
}

export interface ActivityAttachDayInput {
  trip_day_id: string
}

export interface ActivityRecommendationInput {
  day_ids?: string[]
  snapshot_ids?: string[]
  limit?: number
  use_llm_rationale?: boolean
}

export interface ActivityRecommendationItem {
  snapshot_id: string
  trip_day_id: string
  score: number
  rationale: string
  item: ActivityDiscoveryItem
}

export interface ActivityRecommendationResponse {
  total: number
  items: ActivityRecommendationItem[]
}

export interface PlannerActivityFromOfferInput {
  offer_kind: OfferKind
  offer_id: string
  trip_day_id?: string | null
}

export type OptimizeObjective = components['schemas']['OptimizeObjective']
export interface TripOptimizeInput {
  day_ids?: string[]
  activity_snapshot_ids?: string[]
  objective?: OptimizeObjective
  include_event_candidates?: boolean
  max_event_candidates_per_day?: number
  constraints?: Record<string, unknown>
}

export interface ProposalActivityResponse {
  id: string
  proposal_id: string
  trip_day_id: string
  source_activity_id: string | null
  event_snapshot_id: string | null
  place_id: string | null
  order_index: number
  title: string
  description: string | null
  category: ActivityCategory
  start_time: string | null
  duration_min: number | null
  estimated_cost_amount: string | null
  estimated_cost_currency: string | null
  rationale: Record<string, unknown>
  score: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ProposalResponse {
  id: string
  trip_id: string
  user_id: string
  job_id: string
  based_on_trip_version: number
  objective: string
  scope_day_ids: string[]
  status: string
  summary: Record<string, unknown>
  score: Record<string, unknown>
  items: ProposalActivityResponse[]
  created_at: string
  updated_at: string
}

export interface ProposalListResponse {
  total: number
  limit: number
  offset: number
  items: ProposalResponse[]
}

export type ProposalApplyResponse = components['schemas']['ProposalApplyResponse']

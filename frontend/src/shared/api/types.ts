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

export type Activity = components['schemas']['ActivityResponse']
export type ActivityListResponse = components['schemas']['ActivityListResponse']
export type ActivityCreateInput = components['schemas']['ActivityCreateRequest']
export type ActivityUpdateInput = components['schemas']['ActivityPatchRequest']
export type ActivityReorderInput = components['schemas']['ActivityReorderRequest']
export type ActivityMoveInput = components['schemas']['ActivityMoveRequest']

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

export type PlannerActivity = {
  id: string
  trip_day_id: string
  order_index: number
  title: string
  description: string | null
  start_time: string | null
  end_time: string | null
  duration_min: number | null
  tags: string[]
  estimated_cost_amount: string | null
  estimated_cost_currency: string | null
  place_id: string | null
  place: PlannerPlaceSummary | null
  event_snapshot_id: string | null
  notes: string | null
  is_favorite: boolean
  source: string
  created_at: string
  updated_at: string
}

export type PlannerDay = Day & {
  activities: PlannerActivity[]
}

export type PlannerResponse = {
  trip: Trip
  days: PlannerDay[]
}

export type PlannerGenerationReport = {
  jobId: string
  status: string
  result: Record<string, unknown> | null
  error: Record<string, unknown> | null
}

export type Job = components['schemas']['JobResponse']
export type JobListResponse = components['schemas']['JobListResponse']
export type JobAcceptedResponse = components['schemas']['JobAcceptedResponse']

export type Place = components['schemas']['PlaceResponse']
export type PlaceListResponse = components['schemas']['PlaceListResponse']
export type PlaceCreateInput = components['schemas']['PlaceCreateRequest']
export type PlacePhoto = components['schemas']['PlacePhotoResponse']
export type PlacePhotoListResponse = components['schemas']['PlacePhotoListResponse']

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

export type AuditLogEntry = components['schemas']['AuditLogEntry']
export type AuditLogListResponse = components['schemas']['AuditLogListResponse']

export type EventResponse = components['schemas']['EventResponse']
export type EventListResponse = components['schemas']['EventListResponse']
export type EventSearchInput = components['schemas']['EventSearchRequest']
export type EventAttachDayInput = components['schemas']['EventAttachDayRequest']

export type OptimizeObjective = components['schemas']['OptimizeObjective']
export type TripOptimizeInput = components['schemas']['TripOptimizeRequest']
export type ProposalResponse = components['schemas']['ProposalResponse']
export type ProposalListResponse = components['schemas']['ProposalListResponse']
export type ProposalActivityResponse = components['schemas']['ProposalActivityResponse']
export type ProposalApplyResponse = components['schemas']['ProposalApplyResponse']

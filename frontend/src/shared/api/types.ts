import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type { components } from './generated/schema'

export type UserProfile = components['schemas']['UserProfileResponse']
export type UserProfilePatchInput = components['schemas']['UserProfilePatchRequest']

export type TripAccessRole = 'owner' | 'editor'

export interface Trip {
  id: string
  user_id: string
  title: string
  destination_text: string
  start_date: string
  end_date: string
  budget_amount: string | null
  budget_currency: string | null
  trip_type: string | null
  route_travel_mode: RouteTravelMode
  current_user_role: TripAccessRole
  collaborator_count: number
  version: number
  created_at: string
  updated_at: string
}

export interface TripListResponse {
  total: number
  limit: number
  offset: number
  items: Trip[]
}

export type TripCreateInput = components['schemas']['TripCreateRequest'] & {
  editorial_route_id?: string | null
}
export type TripUpdateInput = components['schemas']['TripPatchRequest']
export type GenerationMode = components['schemas']['GenerationMode']
export type TripGenerateInput = components['schemas']['TripGenerateRequest']
export type TripRegenerateInput = components['schemas']['TripRegenerateRequest']
export type TripResetInput = components['schemas']['TripResetItineraryRequest']

export interface TripCollaborator {
  id: string | null
  trip_id: string
  user_id: string
  role: TripAccessRole
  email: string | null
  display_name: string
  avatar_url?: string | null
  avatar_thumbnail_url?: string | null
  invited_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface TripInvitation {
  id: string
  trip_id: string
  created_by_user_id: string
  role: TripAccessRole
  invite_path: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface TripInvitationCreateInput {
  role?: Extract<TripAccessRole, 'editor'>
}

export interface TripInvitationCreateResponse {
  invitation: TripInvitation
}

export interface TripInvitationPreview {
  invitation_id: string
  trip_id: string
  trip_title: string
  destination_text: string
  inviter_display_name: string
  inviter_email: string | null
  role: TripAccessRole
  created_at: string
}

export interface TripSharingResponse {
  trip_id: string
  current_user_role: TripAccessRole
  collaborators: TripCollaborator[]
  pending_invitations: TripInvitation[]
}

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
  visited_at: string | null
  source: string
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
  event_snapshot_id?: string | null
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
  visited_at?: string | null
  source?: string | null
}

export interface PlannerActivity extends Activity {
  place: PlannerPlaceSummary | null
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

export type AssistantTextPart = {
  type: 'text'
  text: string
}

export type AssistantToolCallPart = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  argsText?: string
  result?: Record<string, unknown>
  isError?: boolean
  interrupt?: {
    type: 'human'
    payload: Record<string, unknown>
  }
}

export type AssistantDataPart = {
  type: 'data'
  name: string
  data: Record<string, unknown>
}

export type AssistantMessagePart =
  | AssistantTextPart
  | AssistantToolCallPart
  | AssistantDataPart
  | Record<string, unknown>

export type AssistantMessage = {
  id: string
  thread_id: string
  role: 'assistant' | 'user' | 'system'
  status: 'running' | 'requires_action' | 'complete' | 'incomplete'
  parts: AssistantMessagePart[]
  metadata: Record<string, unknown>
  source_job_id: string | null
  created_at: string
  updated_at: string
}

export type AssistantThread = {
  id: string
  trip_id: string
  user_id: string
  messages: AssistantMessage[]
}

export type AssistantConfirmationInput = {
  message_id: string
  tool_call_id: string
  confirmed: boolean
}

export type AssistantMessageStreamInput = {
  client_message_id?: string | null
  text?: string | null
  confirmation?: AssistantConfirmationInput | null
}

export type AssistantMirrorJobInput = {
  job_id: string
  request_text: string
  action: string
}

export type AssistantStreamEvent =
  | { type: 'message_upsert'; message: AssistantMessage }
  | { type: 'done' }
  | {
      type: 'error'
      error: {
        message: string
        code?: string
      }
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

export interface GooglePlaceDetailLink {
  label: string
  url: string | null
}

export interface GooglePlaceDetail {
  place: GooglePlaceCandidate
  summary: string | null
  rating: number | null
  review_count: number | null
  status_text: string | null
  price_label: string | null
  photos: ActivityDiscoveryPhoto[]
  reviews: ActivityDiscoveryReview[]
  hours: ActivityDiscoveryHoursDay[]
  booking_links: ActivityDiscoveryBookingLink[]
  tags: string[]
  mentions: GooglePlaceDetailLink[]
}

export interface PlannerMapPlaceDetailRelatedActivity {
  activity_id: string
  trip_day_id: string | null
  order_index: number
  title: string
  category: ActivityCategory
  visited_at: string | null
}

export interface PlannerMapMentionLink {
  label: string
  url: string | null
}

export interface PlannerMapPlaceDetail {
  place: Place
  summary: string | null
  rating: number | null
  review_count: number | null
  status_text: string | null
  price_label: string | null
  photos: ActivityDiscoveryPhoto[]
  reviews: ActivityDiscoveryReview[]
  hours: ActivityDiscoveryHoursDay[]
  booking_links: ActivityDiscoveryBookingLink[]
  tags: string[]
  mentions: PlannerMapMentionLink[]
  related_activities: PlannerMapPlaceDetailRelatedActivity[]
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

export type ExportFormat = components['schemas']['ExportFormat']
export type ExportResponse = components['schemas']['ExportResponse']
export type TripExportCreateInput = components['schemas']['TripExportCreateRequest']
export type TripAssetKind = 'photo' | 'file'

export interface TripAssetResponse {
  id: string
  user_id: string
  trip_id: string
  activity_id: string | null
  kind: TripAssetKind
  original_filename: string
  content_type: string
  size_bytes: number
  sha256: string
  image_width: number | null
  image_height: number | null
  preview_url: string | null
  download_url: string
  created_at: string
  updated_at: string
}

export interface TripAssetListResponse {
  total: number
  items: TripAssetResponse[]
}

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

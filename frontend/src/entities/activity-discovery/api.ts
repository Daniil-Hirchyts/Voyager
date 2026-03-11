import { requestJson } from '@/shared/api/client'
import type {
  Activity,
  ActivityAttachDayInput,
  ActivityDiscoveryDetail,
  ActivityDiscoveryItem,
  ActivityDiscoveryListResponse,
  ActivityDiscoverInput,
  ActivityEntityType,
  ActivityRecommendationInput,
  ActivityRecommendationResponse,
  ActivityShortlistListResponse,
  ActivityShortlistSaveInput,
} from '@/shared/api/types'

function withQuery(
  params: Record<string, string | number | undefined | null> | ActivityDiscoverInput,
) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    searchParams.set(key, String(value))
  }
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

export async function discoverActivities(
  tripId: string,
  params: ActivityDiscoverInput,
): Promise<ActivityDiscoveryListResponse> {
  return requestJson<ActivityDiscoveryListResponse>(
    `/trips/${tripId}/activities/discover${withQuery(params)}`,
  )
}

export async function saveActivityToShortlist(
  tripId: string,
  data: ActivityShortlistSaveInput,
  idempotencyKey: string,
): Promise<ActivityDiscoveryItem> {
  return requestJson<ActivityDiscoveryItem>(`/trips/${tripId}/activities/save`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function listSavedActivities(
  tripId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<ActivityShortlistListResponse> {
  return requestJson<ActivityShortlistListResponse>(
    `/trips/${tripId}/activities${withQuery(params)}`,
  )
}

export async function getSavedActivityDetail(
  snapshotId: string,
  params: { locale?: string } = {},
): Promise<ActivityDiscoveryDetail> {
  return requestJson<ActivityDiscoveryDetail>(
    `/activities/${snapshotId}${withQuery(params)}`,
  )
}

export async function getDiscoveredActivityDetail(
  tripId: string,
  params: {
    entity_type: ActivityEntityType
    provider: string
    provider_ref: string
    locale?: string
  },
): Promise<ActivityDiscoveryDetail> {
  return requestJson<ActivityDiscoveryDetail>(
    `/trips/${tripId}/activities/discover/detail${withQuery(params)}`,
  )
}

export async function attachSavedActivityToDay(
  tripId: string,
  snapshotId: string,
  data: ActivityAttachDayInput,
  tripVersion: number,
  idempotencyKey: string,
): Promise<Activity> {
  return requestJson<Activity>(
    `/trips/${tripId}/activities/${snapshotId}/attach-day`,
    {
      method: 'POST',
      headers: {
        'If-Match': String(tripVersion),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(data),
    },
  )
}

export async function getActivityRecommendations(
  tripId: string,
  data: ActivityRecommendationInput,
): Promise<ActivityRecommendationResponse> {
  return requestJson<ActivityRecommendationResponse>(
    `/trips/${tripId}/activities/recommendations`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
}

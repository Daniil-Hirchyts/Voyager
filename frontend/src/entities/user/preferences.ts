import type { UserProfile } from '@/shared/api/types'

export type PlannerViewPreference = 'kanban' | 'map'
export type RecommendationAudiencePreference =
  | 'any'
  | 'families'
  | 'couples'
  | 'friends'
  | 'solo_travelers'

export interface VoyagerRecommendationPreferences {
  resultLimit: number
  minRating: number | null
  audience: RecommendationAudiencePreference
  useLlmRationale: boolean
}

export interface VoyagerMapPreferences {
  defaultPlannerView: PlannerViewPreference
  showRoutesByDefault: boolean
  showCustomLayersByDefault: boolean
}

export interface VoyagerRegionalPreferences {
  locale: string
  region: string
  currency: string
}

export interface VoyagerPreferences {
  recommendations: VoyagerRecommendationPreferences
  map: VoyagerMapPreferences
  regional: VoyagerRegionalPreferences
}

export const DEFAULT_VOYAGER_PREFERENCES: VoyagerPreferences = {
  recommendations: {
    resultLimit: 6,
    minRating: 4,
    audience: 'any',
    useLlmRationale: true,
  },
  map: {
    defaultPlannerView: 'kanban',
    showRoutesByDefault: true,
    showCustomLayersByDefault: true,
  },
  regional: {
    locale: 'en-US',
    region: 'US',
    currency: 'USD',
  },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function coerceBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

function coerceNullableRating(value: unknown, fallback: number | null) {
  if (value == null || value === '') {
    return null
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(5, Math.max(1, Math.round(value)))
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function coerceAudience(
  value: unknown,
  fallback: RecommendationAudiencePreference,
): RecommendationAudiencePreference {
  const normalized = typeof value === 'string' ? value.trim() : ''
  switch (normalized) {
    case 'families':
    case 'couples':
    case 'friends':
    case 'solo_travelers':
      return normalized
    default:
      return fallback
  }
}

export function readVoyagerPreferences(
  source: Pick<UserProfile, 'preferences'> | Record<string, unknown> | null | undefined,
): VoyagerPreferences {
  const root = asRecord(source && 'preferences' in source ? source.preferences : source)
  const voyager = asRecord(root.voyager)
  const recommendations = asRecord(voyager.recommendations)
  const map = asRecord(voyager.map)
  const regional = asRecord(voyager.regional)

  return {
    recommendations: {
      resultLimit: coerceNumber(
        recommendations.resultLimit,
        DEFAULT_VOYAGER_PREFERENCES.recommendations.resultLimit,
        3,
        12,
      ),
      minRating: coerceNullableRating(
        recommendations.minRating,
        DEFAULT_VOYAGER_PREFERENCES.recommendations.minRating,
      ),
      audience: coerceAudience(
        recommendations.audience,
        DEFAULT_VOYAGER_PREFERENCES.recommendations.audience,
      ),
      useLlmRationale: coerceBoolean(
        recommendations.useLlmRationale,
        DEFAULT_VOYAGER_PREFERENCES.recommendations.useLlmRationale,
      ),
    },
    map: {
      defaultPlannerView:
        map.defaultPlannerView === 'map'
          ? 'map'
          : DEFAULT_VOYAGER_PREFERENCES.map.defaultPlannerView,
      showRoutesByDefault: coerceBoolean(
        map.showRoutesByDefault,
        DEFAULT_VOYAGER_PREFERENCES.map.showRoutesByDefault,
      ),
      showCustomLayersByDefault: coerceBoolean(
        map.showCustomLayersByDefault,
        DEFAULT_VOYAGER_PREFERENCES.map.showCustomLayersByDefault,
      ),
    },
    regional: {
      locale: coerceString(regional.locale, DEFAULT_VOYAGER_PREFERENCES.regional.locale),
      region: coerceString(regional.region, DEFAULT_VOYAGER_PREFERENCES.regional.region),
      currency: coerceString(
        regional.currency,
        DEFAULT_VOYAGER_PREFERENCES.regional.currency,
      ).toUpperCase(),
    },
  }
}

export function mergeVoyagerPreferences(
  currentPreferences: Record<string, unknown> | null | undefined,
  patch: Partial<VoyagerPreferences>,
) {
  const root = asRecord(currentPreferences)
  const current = readVoyagerPreferences(root)
  const next: VoyagerPreferences = {
    recommendations: {
      ...current.recommendations,
      ...patch.recommendations,
    },
    map: {
      ...current.map,
      ...patch.map,
    },
    regional: {
      ...current.regional,
      ...patch.regional,
    },
  }

  return {
    ...root,
    voyager: next,
  }
}

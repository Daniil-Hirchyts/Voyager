import type { UserProfile } from '@/shared/api/types';

export type RecommendationAudiencePreference =
  | 'any'
  | 'families'
  | 'couples'
  | 'friends'
  | 'solo_travelers';

export interface VoyagerRecommendationPreferences {
  resultLimit: number;
  minRating: number | null;
  audience: RecommendationAudiencePreference;
}

export interface VoyagerMapPreferences {
  showRoutesByDefault: boolean;
  showCustomLayersByDefault: boolean;
}

export interface VoyagerPreferences {
  recommendations: VoyagerRecommendationPreferences;
  map: VoyagerMapPreferences;
}

export const DEFAULT_VOYAGER_PREFERENCES: VoyagerPreferences = {
  recommendations: {
    resultLimit: 6,
    minRating: 4,
    audience: 'any',
  },
  map: {
    showRoutesByDefault: true,
    showCustomLayersByDefault: true,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function coerceBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function coerceNullableRating(value: unknown, fallback: number | null) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(5, Math.max(1, Math.round(value)));
}

function coerceAudience(
  value: unknown,
  fallback: RecommendationAudiencePreference,
): RecommendationAudiencePreference {
  const normalized = typeof value === 'string' ? value.trim() : '';
  switch (normalized) {
    case 'families':
    case 'couples':
    case 'friends':
    case 'solo_travelers':
      return normalized;
    default:
      return fallback;
  }
}

export function readVoyagerPreferences(
  source: Pick<UserProfile, 'preferences'> | Record<string, unknown> | null | undefined,
): VoyagerPreferences {
  const root = asRecord(source && 'preferences' in source ? source.preferences : source);
  const voyager = asRecord(root.voyager);
  const recommendations = asRecord(voyager.recommendations);
  const map = asRecord(voyager.map);

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
    },
    map: {
      showRoutesByDefault: coerceBoolean(
        map.showRoutesByDefault,
        DEFAULT_VOYAGER_PREFERENCES.map.showRoutesByDefault,
      ),
      showCustomLayersByDefault: coerceBoolean(
        map.showCustomLayersByDefault,
        DEFAULT_VOYAGER_PREFERENCES.map.showCustomLayersByDefault,
      ),
    },
  };
}

export function mergeVoyagerPreferences(
  currentPreferences: Record<string, unknown> | null | undefined,
  patch: Partial<VoyagerPreferences>,
) {
  const root = asRecord(currentPreferences);
  const current = readVoyagerPreferences(root);
  const next: VoyagerPreferences = {
    recommendations: {
      ...current.recommendations,
      ...patch.recommendations,
    },
    map: {
      ...current.map,
      ...patch.map,
    },
  };

  return {
    ...root,
    voyager: next,
  };
}

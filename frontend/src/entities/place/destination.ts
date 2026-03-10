import type { DestinationAutocompleteItem } from './api'
import type { PlaceCreateInput } from '@/shared/api/types'

export function isBackendPlaceId(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

export function buildPlaceCreateInputFromDestinationSuggestion(
  suggestion: DestinationAutocompleteItem,
): PlaceCreateInput {
  const name = suggestion.name?.trim() || suggestion.label.split(',')[0]?.trim() || suggestion.label

  return {
    source: 'google_places',
    external_id: suggestion.id,
    name,
    category: suggestion.category ?? (suggestion.country ? 'city' : 'destination'),
    address_text: suggestion.address_text ?? suggestion.label,
    lat: suggestion.lat ?? null,
    lon: suggestion.lon ?? null,
    metadata: {
      ...(suggestion.metadata ?? {}),
      country: suggestion.country ?? null,
      region: suggestion.region ?? null,
      autocomplete_id: suggestion.id,
      google_place_id: suggestion.id,
      time_zone_id: suggestion.timezone ?? null,
    },
  }
}
